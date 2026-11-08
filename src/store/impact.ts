/**
 * What removing something would do, in plain words, and the mutations that do it. One scan serves both the
 * dialog's text and the write, so what is said and what happens agree (DESIGN.md §8).
 *
 * The rule: a reference the engine needs for correct sums with no safe rewrite is a blocker (a typed row's
 * account, the account a pool account is held in); a nullable or safely rewritable one is a consequence applied
 * in the same commit. Anything with amounts in a closed month cannot be deleted, only archived from a later month.
 */
import { computeEngine, cellKey, type CellResult, type EngineOutput } from '@/engine'
import {
  AccountSchema, CategorySchema, CellSchema, EntitySchema, GoalSchema, HouseholdSchema, PoolSchema, RecurringItemSchema, RowSchema,
  ENTITY_KIND_LABEL, addMonths, compareMonths, monthOfDate, monthRange, parseMonth, poolRef,
  type Account, type Category, type Cell, type CellInput, type Entity, type Goal, type Household, type MonthKey, type Pool, type RecurringItem, type Row,
  type TableName, type Tables,
} from '@/model'
import type { Mutation } from './store'
import { primaryKeyOf, type PrimaryKey } from './keys'
import { accountTypeForRow, planRowFundedBy } from './actions'
import { planChangeRecurringFrom, planRecurringPosts } from './recurring'
import { defaultMonths } from './months'

export type RemovalKind = 'row' | 'account' | 'pool' | 'entity' | 'schedule' | 'goal' | 'category'

export interface RemovalTarget {
  kind: RemovalKind
  id: string
}

export interface Blocker {
  /** What stands in the way, e.g. `"To savings" sends money to it`. */
  text: string
  /** Where to fix it. */
  where: string
}

export interface ImpactOptions {
  /** The current month; defaults to today's. */
  today?: MonthKey
  locale?: string
  /** The archive month the texts should describe; defaults to the first sensible one. */
  archiveFrom?: MonthKey
}

export interface Impact {
  kind: RemovalKind
  /** `Row`, `Account`, `Pool account`, `Adult`, `Schedule`, `Goal`, `Category`. */
  kindLabel: string
  subject: string
  /** What deleting removes. */
  loses: string[]
  /** What else changes when it is deleted. */
  changes: string[]
  blockers: Blocker[]
  /** One more line under the delete list, or null. */
  note: string | null
  /** The closed months it has amounts in, e.g. `Sept–Oct 2026`, or null. Non-null means archive only. */
  closedHistory: string | null
  /** The last closed month with amounts, or null. */
  closedUntil: MonthKey | null
  /** Archiving earlier than this would change a closed month. */
  archiveNotBefore: MonthKey
  /** The month the archive texts describe. */
  archiveFrom: MonthKey
  /** What archiving from `archiveFrom` does. */
  archiveChanges: string[]
  canArchive: boolean
  canDelete: boolean
}

// ---------- words ----------

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`
const pick = (n: number, one: string, many: string) => (n === 1 ? one : many)

/** `"A"`, `"A" and "B"`, `"A", "B", "C" and "D"`, `"A", "B", "C", "D" and 2 more`. */
export function quoteNames(names: string[], max = 4): string {
  const q = names.map((n) => `"${n}"`)
  if (q.length <= 1) return q[0] ?? ''
  if (q.length <= max) return `${q.slice(0, -1).join(', ')} and ${q[q.length - 1]}`
  return `${q.slice(0, max).join(', ')} and ${q.length - max} more`
}

function monthLabel(m: MonthKey, locale: string, withYear = true): string {
  const { year, month } = parseMonth(m)
  return new Intl.DateTimeFormat(locale, withYear ? { month: 'short', year: 'numeric' } : { month: 'short' }).format(new Date(year, month - 1, 1))
}

/** `Sept 2026`, `Sept–Oct 2026`, `Nov 2026 – Mar 2027`. */
export function monthSpan(months: MonthKey[], locale: string): string {
  const sorted = [...new Set(months)].sort()
  if (sorted.length === 0) return ''
  const a = sorted[0]
  const b = sorted[sorted.length - 1]
  if (a === b) return monthLabel(a, locale)
  if (parseMonth(a).year === parseMonth(b).year) return `${monthLabel(a, locale, false)}–${monthLabel(b, locale)}`
  return `${monthLabel(a, locale)} – ${monthLabel(b, locale)}`
}

// ---------- the scan ----------

interface Ctx {
  tables: Tables
  household: Household
  locale: string
  today: MonthKey
  months: MonthKey[]
  engine: EngineOutput
  closed: Set<MonthKey>
  rows: Row[]
  accounts: Account[]
  pools: Pool[]
  entities: Entity[]
  schedules: RecurringItem[]
  goals: Goal[]
}

function context(tables: Tables, opts: ImpactOptions): Ctx {
  const household = tables.household.find((h) => !h.deletedAt)
  if (!household) throw new Error('No household yet')
  const today = opts.today ?? monthOfDate()
  const months = defaultMonths(household, tables, today)
  const live = <T extends { deletedAt: number | null }>(list: T[]) => list.filter((x) => !x.deletedAt)
  return {
    tables, household, locale: opts.locale ?? household.locale, today, months,
    engine: computeEngine({ tables, months }),
    closed: new Set(tables.monthStates.filter((s) => s.closed).map((s) => s.month)),
    rows: live(tables.rows), accounts: live(tables.accounts), pools: live(tables.pools), entities: live(tables.entities),
    schedules: live(tables.recurringItems), goals: live(tables.goals),
  }
}

const hasAmount = (c: CellResult | undefined): c is CellResult =>
  !!c && c.source !== 'empty' && c.source !== 'archived' && (c.value !== 0 || (c.source === 'items' && c.items.some((i) => !i.skipped)))

/** The months a row shows an amount in, whatever its source. */
const amountMonths = (ctx: Ctx, rowId: string): MonthKey[] => ctx.months.filter((m) => hasAmount(ctx.engine.cells[cellKey(rowId, m)]))

interface Described {
  kindLabel: string
  subject: string
  loses: string[]
  changes: string[]
  blockers: Blocker[]
  note: string | null
  /** Months the thing has amounts or a balance in; the closed ones among them make it archive-only. */
  activity: MonthKey[]
  canArchive: boolean
  archive: (from: MonthKey) => string[]
}

const TYPED_VERB: Partial<Record<Row['kind'], string>> = {
  'to-savings': 'sends money to it', 'to-investment': 'sends money to it', 'from-investment': 'takes money from it',
  'debt-payment': 'pays it off', 'card-payment': 'pays it off',
}

function describeRow(ctx: Ctx, row: Row): Described {
  const { locale } = ctx
  const months = amountMonths(ctx, row.id)
  const schedules = ctx.schedules.filter((s) => s.rowId === row.id)
  const followers = ctx.rows.filter((r) => r.followsRowId === row.id)
  const pool = ctx.pools.find((p) => p.allocationRowId === row.id)
  const savingsAcc = row.kind === 'to-savings' && ctx.household.closingRule === 'savings-plug' && row.accountId ? ctx.accounts.find((a) => a.id === row.accountId) : undefined
  const scheduleWords = `Its ${pick(schedules.length, 'schedule', `${schedules.length} schedules`)} ${quoteNames(schedules.map((s) => s.name))}`
  const loses: string[] = []
  if (months.length) loses.push(`Its amounts in ${plural(months.length, 'month')} (${monthSpan(months, locale)})`)
  if (schedules.length) loses.push(scheduleWords)
  const changes: string[] = []
  if (followers.length) changes.push(`${quoteNames(followers.map((f) => f.name))} ${pick(followers.length, 'stops following it and keeps its', 'stop following it and keep their')} own amounts`)
  if (pool) changes.push(`The pool account "${pool.name}" is no longer filled each month`)
  if (savingsAcc) changes.push(`"${savingsAcc.name}" no longer receives the month's leftover`)
  return {
    kindLabel: 'Row', subject: row.name, loses, changes, blockers: [], note: null, activity: months, canArchive: true,
    archive: (from) => {
      const at = monthLabel(from, locale)
      const later = months.filter((m) => compareMonths(m, from) >= 0)
      const out = [later.length ? `Hidden from ${at} on; its amounts in ${plural(later.length, 'later month')} no longer count` : `Hidden from ${at} on`]
      if (schedules.length) out.push(`${scheduleWords} ${pick(schedules.length, 'stops', 'stop')} after ${monthLabel(addMonths(from, -1), locale)}`)
      if (followers.length) out.push(`${quoteNames(followers.map((f) => f.name))} ${pick(followers.length, 'stops following it and keeps', 'stop following it and keep')} the last amount as ${pick(followers.length, 'its', 'their')} own from ${at}`)
      if (pool) out.push(`The pool account "${pool.name}" is no longer filled from ${at}`)
      if (savingsAcc) out.push(`"${savingsAcc.name}" no longer receives the month's leftover from ${at}`)
      return out
    },
  }
}

function describeAccount(ctx: Ctx, acc: Account): Described {
  const { locale } = ctx
  const typed = ctx.rows.filter((r) => r.accountId === acc.id && accountTypeForRow(r))
  const plain = ctx.rows.filter((r) => r.accountId === acc.id && !accountTypeForRow(r))
  const pools = ctx.pools.filter((p) => p.accountId === acc.id)
  const schedules = ctx.schedules.filter((s) => s.accountId === acc.id)
  const goals = ctx.goals.filter((g) => g.accountId === acc.id)
  const actuals = ctx.tables.accountMonths.filter((a) => a.accountId === acc.id && (a.actualBalance != null || a.actualDeposit != null || a.actualSpend != null))
  /** A tracked balance is part of every month from its opening: history. An untracked account is only a name. */
  const activity = acc.tracked ? ctx.months.filter((m) => compareMonths(m, acc.openingMonth) >= 0 && !(acc.archivedMonth && compareMonths(m, acc.archivedMonth) >= 0)) : []
  const goalWords = `The ${pick(goals.length, 'goal', 'goals')} ${quoteNames(goals.map((g) => g.name))}`
  const loses: string[] = []
  if (actuals.length) loses.push(`${plural(actuals.length, 'real balance')} you entered (${monthSpan(actuals.map((a) => a.month), locale)})`)
  if (goals.length) loses.push(`${goalWords}, which ${pick(goals.length, 'watches', 'watch')} it`)
  const blockers: Blocker[] = [
    ...typed.map((r) => ({ text: `"${r.name}" ${TYPED_VERB[r.kind] ?? 'uses it'}`, where: 'Point the row at another account from its row menu on the grid, or archive the row.' })),
    ...pools.map((p) => ({ text: `The pool account "${p.name}" is held in it`, where: 'Move it to another savings account under Household → Pool accounts → Edit, or archive it.' })),
  ]
  const changes: string[] = []
  // an expense names its paying account; a transfer or income names where the money goes
  if (plain.length) changes.push(`${quoteNames(plain.map((r) => r.name))} no longer ${pick(plain.length, 'names', 'name')} it${plain.every((r) => r.section === 'expense') ? ' as the paying account' : ''}`)
  if (schedules.length) changes.push(`${plural(schedules.length, 'schedule')} no longer ${pick(schedules.length, 'names', 'name')} it`)
  return {
    kindLabel: 'Account', subject: acc.name, loses, changes, blockers, note: null, activity, canArchive: true,
    archive: (from) => {
      const at = monthLabel(from, locale)
      const out = [acc.tracked ? `Its balance stops at ${monthLabel(addMonths(from, -1), locale)}; from ${at} it is hidden and no longer counts towards net worth` : `Hidden from ${at} on; rows that name it keep working`]
      if (typed.length) out.push(`${quoteNames(typed.map((r) => r.name))} ${pick(typed.length, 'keeps', 'keep')} moving money, but the balance is no longer tracked from ${at}`)
      if (pools.length) out.push(`Its pool ${pick(pools.length, 'account', 'accounts')} ${quoteNames(pools.map((p) => p.name))} ${pick(pools.length, 'is', 'are')} archived with it from ${at}`)
      if (goals.length) out.push(`${goalWords} can no longer be measured`)
      return out
    },
  }
}

function describePool(ctx: Ctx, pool: Pool): Described {
  const { locale } = ctx
  const ref = poolRef(pool.id)
  const alloc = pool.allocationRowId ? ctx.rows.find((r) => r.id === pool.allocationRowId) : undefined
  const allocMonths = alloc ? amountMonths(ctx, alloc.id) : []
  const funded = ctx.rows.filter((r) => r.defaultFundedBy === ref)
  const cellsFunded = ctx.tables.cells.filter((c) => c.items.some((i) => i.fundedBy === ref))
  const schedules = ctx.schedules.filter((s) => s.fundedBy === ref)
  const goals = ctx.goals.filter((g) => g.poolId === pool.id)
  const series = ctx.engine.pools[pool.id]
  const activity = ctx.months.filter((m) => {
    const r = series?.months[m]
    return !!r && (r.allocation !== 0 || r.spend !== 0)
  })
  const goalWords = `The ${pick(goals.length, 'goal', 'goals')} ${quoteNames(goals.map((g) => g.name))}`
  const loses: string[] = [`Its balance${activity.length ? ` (${monthSpan(activity, locale)})` : ''}`]
  if (alloc) loses.push(`The row "${alloc.name}" that fills it${allocMonths.length ? `, with its amounts in ${plural(allocMonths.length, 'month')}` : ''}`)
  if (goals.length) loses.push(`${goalWords}, which ${pick(goals.length, 'watches', 'watch')} it`)
  const changes: string[] = []
  if (funded.length) changes.push(`${quoteNames(funded.map((r) => r.name))} ${pick(funded.length, 'comes', 'come')} out of the savings balance instead`)
  if (cellsFunded.length) changes.push(`Spending that came out of it in ${plural(cellsFunded.length, 'month')} counts as spent from the savings balance`)
  if (schedules.length) changes.push(`${plural(schedules.length, 'schedule')} ${pick(schedules.length, 'comes', 'come')} out of the savings balance instead`)
  return {
    kindLabel: 'Pool account', subject: pool.name, loses, changes, blockers: [], note: null, activity, canArchive: true,
    archive: (from) => {
      const at = monthLabel(from, locale)
      const out = [`Its balance stops at ${monthLabel(addMonths(from, -1), locale)}`]
      if (alloc) out.push(`"${alloc.name}" is archived from ${at}; nothing more is set aside`)
      const movers = [...funded.map((r) => r.name), ...schedules.map((s) => s.name)]
      if (movers.length) out.push(`From ${at}, ${quoteNames(movers)} ${pick(movers.length, 'comes', 'come')} out of the savings balance; earlier months keep the pool account as their source`)
      if (goals.length) out.push(`${goalWords} can no longer be measured`)
      return out
    },
  }
}

function describeEntity(ctx: Ctx, e: Entity): Described {
  const { locale } = ctx
  const own = ctx.rows.filter((r) => r.scope === e.id)
  const tagged = ctx.rows.filter((r) => r.scope !== e.id && r.entityTags.includes(e.id))
  const dependents = ctx.entities.filter((x) => x.paidBy === e.id)
  const owned = ctx.accounts.filter((a) => a.ownerEntityId === e.id)
  const schedules = ctx.schedules.filter((s) => s.scope === e.id)
  const manual = e.id in ctx.household.manualShares
  const activity = [...new Set([...own, ...tagged].flatMap((r) => amountMonths(ctx, r.id)))].sort()
  const changes: string[] = []
  if (own.length) changes.push(`${quoteNames(own.map((r) => r.name))} ${pick(own.length, 'becomes', 'become')} shared`)
  if (tagged.length) changes.push(`${quoteNames(tagged.map((r) => r.name))} ${pick(tagged.length, 'loses its tag', 'lose their tag')}`)
  if (dependents.length) changes.push(`The costs of ${quoteNames(dependents.map((d) => d.name))} become shared`)
  if (owned.length) changes.push(`${quoteNames(owned.map((a) => a.name))} ${pick(owned.length, 'becomes', 'become')} a household account`)
  if (schedules.length) changes.push(`${plural(schedules.length, 'schedule')} ${pick(schedules.length, 'becomes', 'become')} shared`)
  if (manual) changes.push('Its share of the manual split is dropped')
  return {
    kindLabel: ENTITY_KIND_LABEL[e.kind], subject: e.name, loses: [], changes, blockers: [], note: null, activity, canArchive: true,
    archive: (from) => {
      const at = monthLabel(from, locale)
      const out = [`Hidden from People & things from ${at}; its rows and earlier months stay as they are`]
      if (e.kind === 'adult' && ctx.household.moneyMode === 'proportional') out.push(`No longer part of the split from ${at}`)
      return out
    },
  }
}

function describeSchedule(ctx: Ctx, item: RecurringItem): Described {
  const posted = ctx.tables.cells.filter((c) => !ctx.closed.has(c.month) && c.items.some((i) => i.recurringItemId === item.id && i.status !== 'done' && !i.skipped))
  const loses = posted.length ? [`Its posted amount in ${plural(posted.length, 'open month')} (${monthSpan(posted.map((c) => c.month), ctx.locale)}); what was already paid stays`] : []
  return {
    kindLabel: 'Schedule', subject: item.name, loses, changes: [], blockers: [],
    note: `${posted.length ? 'Nothing more is posted.' : 'Nothing more is posted; what was already paid stays.'} To stop it from a month on instead, use "End after" in the schedules list.`,
    activity: [], canArchive: false, archive: () => [],
  }
}

const describeGoal = (g: Goal): Described => ({
  kindLabel: 'Goal', subject: g.name, loses: [], changes: [], blockers: [], note: 'What it watched is not touched.', activity: [], canArchive: false, archive: () => [],
})

function describeCategory(ctx: Ctx, c: Category): Described {
  const rows = ctx.rows.filter((r) => r.categoryId === c.id)
  return {
    kindLabel: 'Category', subject: c.name, loses: [], blockers: [], note: null, activity: [], canArchive: false, archive: () => [],
    changes: rows.length ? [`${quoteNames(rows.map((r) => r.name))} ${pick(rows.length, 'keeps its', 'keep their')} place without a category`] : [],
  }
}

function find<T extends { id: string }>(list: T[], id: string, what: string): T {
  const x = list.find((r) => r.id === id)
  if (!x) throw new Error(`That ${what} no longer exists.`)
  return x
}

function describe(ctx: Ctx, target: RemovalTarget): Described {
  switch (target.kind) {
    case 'row': return describeRow(ctx, find(ctx.rows, target.id, 'row'))
    case 'account': return describeAccount(ctx, find(ctx.accounts, target.id, 'account'))
    case 'pool': return describePool(ctx, find(ctx.pools, target.id, 'pool account'))
    case 'entity': return describeEntity(ctx, find(ctx.entities, target.id, 'person or thing'))
    case 'schedule': return describeSchedule(ctx, find(ctx.schedules, target.id, 'schedule'))
    case 'goal': return describeGoal(find(ctx.goals, target.id, 'goal'))
    case 'category': return describeCategory(ctx, find(ctx.tables.categories.filter((c) => !c.deletedAt), target.id, 'category'))
  }
}

function impactOf(ctx: Ctx, target: RemovalTarget, opts: ImpactOptions): Impact {
  const d = describe(ctx, target)
  const closedActivity = d.activity.filter((m) => ctx.closed.has(m)).sort()
  const closedUntil = closedActivity.length ? closedActivity[closedActivity.length - 1] : null
  const notBefore = closedUntil ? addMonths(closedUntil, 1) : ctx.household.startMonth
  const archiveNotBefore = compareMonths(notBefore, ctx.household.startMonth) < 0 ? ctx.household.startMonth : notBefore
  const archiveFrom = opts.archiveFrom ?? (compareMonths(ctx.today, archiveNotBefore) > 0 ? ctx.today : archiveNotBefore)
  return {
    kind: target.kind, kindLabel: d.kindLabel, subject: d.subject, loses: d.loses, changes: d.changes, blockers: d.blockers, note: d.note,
    closedHistory: closedActivity.length ? monthSpan(closedActivity, ctx.locale) : null, closedUntil, archiveNotBefore, archiveFrom,
    archiveChanges: d.canArchive ? d.archive(archiveFrom) : [], canArchive: d.canArchive,
    canDelete: closedActivity.length === 0 && d.blockers.length === 0,
  }
}

/** What deleting or archiving `target` would do, for the dialog. Throws when the thing no longer exists. */
export function describeRemoval(tables: Tables, target: RemovalTarget, opts: ImpactOptions = {}): Impact {
  return impactOf(context(tables, opts), target, opts)
}

/** Why `month` is too early to archive from, or null when it is fine. */
export function archiveMonthProblem(impact: Impact, month: MonthKey, locale: string): string | null {
  if (compareMonths(month, impact.archiveNotBefore) >= 0) return null
  return impact.closedUntil
    ? `${monthLabel(impact.closedUntil, locale)} is closed and has amounts in it. Archive from ${monthLabel(impact.archiveNotBefore, locale)} or later.`
    : `Archive from ${monthLabel(impact.archiveNotBefore, locale)} or later, the household's first month.`
}

// ---------- mutations ----------

type Parser<T> = { parse: (x: unknown) => T }
function put<T extends TableName>(table: T, schema: Parser<Tables[T][number]>, record: Tables[T][number], patch: Partial<Tables[T][number]>, ts: number): Mutation {
  return { op: 'put', table, record: schema.parse({ ...record, ...patch, updatedAt: ts }) } as Mutation
}
const putCell = (cell: CellInput, ts: number): Mutation => ({ op: 'put', table: 'cells', record: CellSchema.parse({ ...cell, updatedAt: ts }) })
const cellOf = (tables: Tables, rowId: string, month: MonthKey): Cell | undefined => tables.cells.find((c) => c.rowId === rowId && c.month === month)

/** The tables as they would be after `mutations`, so a plan can build on its own earlier steps. */
export function applyMutations(tables: Tables, mutations: Mutation[]): Tables {
  const out = { ...tables } as unknown as Record<TableName, unknown[]>
  const keyOf = (table: TableName, r: unknown) => JSON.stringify((primaryKeyOf as (t: TableName, r: unknown) => PrimaryKey)(table, r))
  for (const m of mutations) {
    const list = [...out[m.table]]
    if (m.op === 'put') {
      const k = keyOf(m.table, m.record)
      const i = list.findIndex((r) => keyOf(m.table, r) === k)
      if (i >= 0) list[i] = m.record
      else list.push(m.record)
    } else {
      const k = JSON.stringify(m.key)
      const i = list.findIndex((r) => keyOf(m.table, r) === k)
      if (i >= 0) list.splice(i, 1)
    }
    out[m.table] = list
  }
  return out as unknown as Tables
}

function rowRemoval(ctx: Ctx, row: Row, ts: number): Mutation[] {
  const muts: Mutation[] = [put('rows', RowSchema, row, { deletedAt: ts }, ts)]
  for (const c of ctx.tables.cells) if (c.rowId === row.id) muts.push({ op: 'delete', table: 'cells', key: [c.rowId, c.month] })
  for (const s of ctx.schedules) if (s.rowId === row.id) muts.push(put('recurringItems', RecurringItemSchema, s, { deletedAt: ts }, ts))
  for (const f of ctx.rows) if (f.followsRowId === row.id) muts.push(put('rows', RowSchema, f, { followsRowId: null }, ts))
  for (const p of ctx.pools) if (p.allocationRowId === row.id) muts.push(put('pools', PoolSchema, p, { allocationRowId: null }, ts))
  return muts
}

/** Followers keep what they mirrored before `from` as their own values, then stop following. */
function pinFollowers(ctx: Ctx, row: Row, from: MonthKey, ts: number): Mutation[] {
  const followers = ctx.rows.filter((r) => r.followsRowId === row.id)
  if (followers.length === 0) return []
  const muts: Mutation[] = []
  if (compareMonths(ctx.household.startMonth, from) < 0) {
    // closed flags lifted, so the value we store is the real one
    const open: Tables = { ...ctx.tables, monthStates: ctx.tables.monthStates.map((s) => ({ ...s, closed: false })) }
    const months = monthRange(ctx.household.startMonth, addMonths(from, -1))
    const eng = computeEngine({ tables: open, months })
    for (const f of followers) {
      for (const m of months) {
        const c = eng.cells[cellKey(f.id, m)]
        if (!c || c.value === 0) continue
        const existing = cellOf(ctx.tables, f.id, m)
        const own = f.currency ?? ctx.household.baseCurrency
        muts.push(putCell({
          rowId: f.id, month: m, mode: 'value', value: c.value, items: [], note: existing?.note ?? null,
          currencyOverride: c.currency !== own ? c.currency : existing?.currencyOverride ?? null, markedDone: existing?.markedDone ?? false, updatedAt: ts,
        }, ts))
      }
    }
  }
  for (const f of followers) muts.push(put('rows', RowSchema, f, { followsRowId: null }, ts))
  return muts
}

function rowArchive(ctx: Ctx, row: Row, from: MonthKey, ts: number): Mutation[] {
  const muts: Mutation[] = [put('rows', RowSchema, row, { archivedMonth: from }, ts), ...pinFollowers(ctx, row, from, ts)]
  const schedules = ctx.schedules.filter((s) => s.rowId === row.id)
  for (const s of schedules) {
    if (compareMonths(s.startMonth, from) >= 0) muts.push(put('recurringItems', RecurringItemSchema, s, { deletedAt: ts }, ts))
    else if (s.endMonth == null || compareMonths(s.endMonth, from) >= 0) muts.push(put('recurringItems', RecurringItemSchema, s, { endMonth: addMonths(from, -1) }, ts))
  }
  // the ended schedules' open postings go, so the next system pass finds nothing to do
  if (schedules.length) {
    const later = ctx.months.filter((m) => compareMonths(m, from) >= 0)
    if (later.length) muts.push(...planRecurringPosts(applyMutations(ctx.tables, muts), later))
  }
  return muts
}

function accountRemoval(ctx: Ctx, acc: Account, ts: number): Mutation[] {
  const muts: Mutation[] = [put('accounts', AccountSchema, acc, { deletedAt: ts }, ts)]
  for (const a of ctx.tables.accountMonths) if (a.accountId === acc.id) muts.push({ op: 'delete', table: 'accountMonths', key: [a.accountId, a.month] })
  for (const r of ctx.rows) if (r.accountId === acc.id && !accountTypeForRow(r)) muts.push(put('rows', RowSchema, r, { accountId: null }, ts))
  for (const s of ctx.schedules) if (s.accountId === acc.id) muts.push(put('recurringItems', RecurringItemSchema, s, { accountId: null }, ts))
  for (const g of ctx.goals) if (g.accountId === acc.id) muts.push(put('goals', GoalSchema, g, { deletedAt: ts }, ts))
  return muts
}

function accountArchive(ctx: Ctx, acc: Account, from: MonthKey, ts: number): Mutation[] {
  const muts: Mutation[] = [put('accounts', AccountSchema, acc, { archivedMonth: from }, ts)]
  for (const p of ctx.pools) if (p.accountId === acc.id && !(p.archivedMonth && compareMonths(p.archivedMonth, from) <= 0)) muts.push(...poolArchive(ctx, p, from, ts))
  return muts
}

function poolRemoval(ctx: Ctx, pool: Pool, ts: number): Mutation[] {
  const ref = poolRef(pool.id)
  const muts: Mutation[] = [put('pools', PoolSchema, pool, { deletedAt: ts }, ts)]
  const alloc = pool.allocationRowId ? ctx.rows.find((r) => r.id === pool.allocationRowId) : undefined
  if (alloc) muts.push(...rowRemoval(ctx, alloc, ts).filter((m) => !(m.op === 'put' && m.table === 'pools')))
  for (const r of ctx.rows) if (r.defaultFundedBy === ref) muts.push(put('rows', RowSchema, r, { defaultFundedBy: 'savings' }, ts))
  for (const c of ctx.tables.cells) {
    if (c.rowId === alloc?.id || !c.items.some((i) => i.fundedBy === ref)) continue
    muts.push(putCell({ ...c, items: c.items.map((i) => (i.fundedBy === ref ? { ...i, fundedBy: 'savings' } : i)) }, ts))
  }
  for (const s of ctx.schedules) if (s.fundedBy === ref) muts.push(put('recurringItems', RecurringItemSchema, s, { fundedBy: 'savings' }, ts))
  for (const g of ctx.goals) if (g.poolId === pool.id) muts.push(put('goals', GoalSchema, g, { deletedAt: ts }, ts))
  return muts
}

function poolArchive(ctx: Ctx, pool: Pool, from: MonthKey, ts: number): Mutation[] {
  const ref = poolRef(pool.id)
  const muts: Mutation[] = []
  let work = ctx.tables
  const add = (ms: Mutation[]) => {
    muts.push(...ms)
    work = applyMutations(work, ms)
  }
  add([put('pools', PoolSchema, pool, { archivedMonth: from }, ts)])
  const alloc = pool.allocationRowId ? ctx.rows.find((r) => r.id === pool.allocationRowId) : undefined
  if (alloc && !(alloc.archivedMonth && compareMonths(alloc.archivedMonth, from) <= 0)) add(rowArchive(ctx, alloc, from, ts))
  // rows: earlier months keep the pool as their source, the default becomes savings
  for (const r of ctx.rows) if (r.defaultFundedBy === ref) add(planRowFundedBy(work, r, 'savings', { from }, ts))
  // schedules: a copy from `from` on comes out of savings; the old one ends the month before
  for (const s of ctx.schedules) {
    if (s.fundedBy !== ref) continue
    if (compareMonths(s.startMonth, from) >= 0) add([put('recurringItems', RecurringItemSchema, s, { fundedBy: 'savings' }, ts)])
    else if (s.endMonth == null || compareMonths(s.endMonth, from) >= 0) add(planChangeRecurringFrom(work, s, from, { fundedBy: 'savings' }, ts).mutations)
  }
  // whatever still comes out of it in open months from `from` on
  const rewrites: Mutation[] = []
  for (const c of work.cells) {
    if (compareMonths(c.month, from) < 0 || ctx.closed.has(c.month) || !c.items.some((i) => i.fundedBy === ref)) continue
    rewrites.push(putCell({ ...c, items: c.items.map((i) => (i.fundedBy === ref ? { ...i, fundedBy: 'savings' } : i)) }, ts))
  }
  add(rewrites)
  return muts
}

function entityRemoval(ctx: Ctx, e: Entity, ts: number): Mutation[] {
  const muts: Mutation[] = [put('entities', EntitySchema, e, { deletedAt: ts }, ts)]
  for (const r of ctx.rows) {
    if (r.scope !== e.id && !r.entityTags.includes(e.id)) continue
    muts.push(put('rows', RowSchema, r, { scope: r.scope === e.id ? 'shared' : r.scope, entityTags: r.entityTags.filter((t) => t !== e.id) }, ts))
  }
  for (const x of ctx.entities) if (x.paidBy === e.id) muts.push(put('entities', EntitySchema, x, { paidBy: null }, ts))
  for (const a of ctx.accounts) if (a.ownerEntityId === e.id) muts.push(put('accounts', AccountSchema, a, { ownerEntityId: null }, ts))
  for (const s of ctx.schedules) if (s.scope === e.id) muts.push(put('recurringItems', RecurringItemSchema, s, { scope: 'shared' }, ts))
  if (e.id in ctx.household.manualShares) {
    const { [e.id]: _dropped, ...manualShares } = ctx.household.manualShares
    void _dropped
    muts.push(put('household', HouseholdSchema, ctx.household, { manualShares }, ts))
  }
  return muts
}

function scheduleRemoval(ctx: Ctx, item: RecurringItem, ts: number): Mutation[] {
  const muts: Mutation[] = [put('recurringItems', RecurringItemSchema, item, { deletedAt: ts }, ts)]
  muts.push(...planRecurringPosts(applyMutations(ctx.tables, muts), ctx.months))
  return muts
}

/** The mutations that delete `target` and settle everything that pointed at it. Throws when the impact forbids it. */
export function planRemoval(tables: Tables, target: RemovalTarget, ts: number, opts: ImpactOptions = {}): Mutation[] {
  const ctx = context(tables, opts)
  const impact = impactOf(ctx, target, opts)
  if (impact.closedHistory) throw new Error(`"${impact.subject}" has amounts in closed months (${impact.closedHistory}). Archive it instead.`)
  if (impact.blockers.length) throw new Error(`Resolve this first: ${impact.blockers.map((b) => b.text).join('; ')}.`)
  switch (target.kind) {
    case 'row': return rowRemoval(ctx, find(ctx.rows, target.id, 'row'), ts)
    case 'account': return accountRemoval(ctx, find(ctx.accounts, target.id, 'account'), ts)
    case 'pool': return poolRemoval(ctx, find(ctx.pools, target.id, 'pool account'), ts)
    case 'entity': return entityRemoval(ctx, find(ctx.entities, target.id, 'person or thing'), ts)
    case 'schedule': return scheduleRemoval(ctx, find(ctx.schedules, target.id, 'schedule'), ts)
    case 'goal': return [put('goals', GoalSchema, find(ctx.goals, target.id, 'goal'), { deletedAt: ts }, ts)]
    case 'category': {
      const c = find(ctx.tables.categories.filter((x) => !x.deletedAt), target.id, 'category')
      return [put('categories', CategorySchema, c, { deletedAt: ts }, ts), ...ctx.rows.filter((r) => r.categoryId === c.id).map((r) => put('rows', RowSchema, r, { categoryId: null }, ts))]
    }
  }
}

/** The mutations that archive `target` from `month` on. Earlier months are left exactly as they are. */
export function planArchive(tables: Tables, target: RemovalTarget, month: MonthKey, ts: number, opts: ImpactOptions = {}): Mutation[] {
  const ctx = context(tables, opts)
  const impact = impactOf(ctx, target, opts)
  if (!impact.canArchive) throw new Error(`A ${impact.kindLabel.toLowerCase()} cannot be archived. Delete it instead.`)
  const problem = archiveMonthProblem(impact, month, ctx.locale)
  if (problem) throw new Error(problem)
  switch (target.kind) {
    case 'row': return rowArchive(ctx, find(ctx.rows, target.id, 'row'), month, ts)
    case 'account': return accountArchive(ctx, find(ctx.accounts, target.id, 'account'), month, ts)
    case 'pool': return poolArchive(ctx, find(ctx.pools, target.id, 'pool account'), month, ts)
    case 'entity': return [put('entities', EntitySchema, find(ctx.entities, target.id, 'person or thing'), { archivedMonth: month }, ts)]
    default: throw new Error(`A ${impact.kindLabel.toLowerCase()} cannot be archived.`)
  }
}
