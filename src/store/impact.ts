/**
 * What removing something would do, in plain words, and the mutations that do it. One scan serves both the
 * dialog's text and the write, so what is said and what happens agree (DESIGN.md §8).
 *
 * The rule: a reference the engine needs for correct sums with no safe rewrite is a blocker (a typed row's
 * account, the account a virtual account is held in); a nullable or safely rewritable one is a consequence applied
 * in the same commit. Anything with amounts in a closed month cannot be deleted, only archived from a later month.
 */
import { computeEngine, cellKey, type CellResult, type EngineOutput } from '@/engine'
import {
  AccountSchema, CategorySchema, CellSchema, EntitySchema, GoalSchema, PoolSchema, RecurringItemSchema, RowSchema,
  ENTITY_KIND_LABEL, accountIdOf, accountRef, addMonths, compareMonths, monthOfDate, monthRange, parseMonth, paysExpenses, poolIdOf, poolRef,
  type Account, type ArchiveMemo, type Category, type Cell, type CellInput, type Entity, type FundedBy, type Goal, type Household, type MonthKey, type Pool, type RecurringItem, type Row,
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
  /** `Row`, `Account`, `Virtual account`, `Adult`, `Schedule`, `Goal`, `Category`. */
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
  'to-savings': 'sends money to it', 'to-investment': 'sends money to it', 'from-investment': 'takes money from it', 'from-savings': 'takes money from it',
  'debt-payment': 'pays it off', 'card-payment': 'pays it off',
}

function describeRow(ctx: Ctx, row: Row): Described {
  const { locale } = ctx
  const months = amountMonths(ctx, row.id)
  const schedules = ctx.schedules.filter((s) => s.rowId === row.id)
  const followers = ctx.rows.filter((r) => r.followsRowId === row.id)
  const deductions = ctx.rows.filter((r) => r.deductedFromRowId === row.id)
  /** Rows whose rule takes a share of this income line: with the line gone they get nothing, and say so. */
  const sharers = ctx.rows.filter((r) => r.rule === 'share-of-row' && r.ruleRowId === row.id)
  const pool = ctx.pools.find((p) => p.allocationRowId === row.id)
  const savingsAcc = row.kind === 'to-savings' && ctx.household.closingRule === 'savings-plug' && row.accountId ? ctx.accounts.find((a) => a.id === row.accountId) : undefined
  const scheduleWords = `Its ${pick(schedules.length, 'schedule', `${schedules.length} schedules`)} ${quoteNames(schedules.map((s) => s.name))}`
  const loses: string[] = []
  if (months.length) loses.push(`Its amounts in ${plural(months.length, 'month')} (${monthSpan(months, locale)})`)
  if (schedules.length) loses.push(scheduleWords)
  const changes: string[] = []
  if (followers.length) changes.push(`${quoteNames(followers.map((f) => f.name))} ${pick(followers.length, 'stops following it and keeps its', 'stop following it and keep their')} own amounts`)
  if (deductions.length) changes.push(`${quoteNames(deductions.map((d) => d.name))} ${pick(deductions.length, 'is', 'are')} no longer deducted from it and ${pick(deductions.length, 'counts', 'count')} as ordinary spending`)
  if (sharers.length) changes.push(`${quoteNames(sharers.map((s) => s.name))} ${pick(sharers.length, 'takes a percentage of it and gets', 'take a percentage of it and get')} nothing until another rule is picked`)
  if (pool) changes.push(`The virtual account "${pool.name}" is no longer filled each month`)
  if (savingsAcc) changes.push(`"${savingsAcc.name}" no longer receives the month's leftover`)
  return {
    kindLabel: 'Row', subject: row.name, loses, changes, blockers: [], note: null, activity: months, canArchive: true,
    archive: (from) => {
      const at = monthLabel(from, locale)
      const later = months.filter((m) => compareMonths(m, from) >= 0)
      const out = [later.length ? `Hidden from ${at} on; its amounts in ${plural(later.length, 'later month')} no longer count` : `Hidden from ${at} on`]
      if (schedules.length) out.push(`${scheduleWords} ${pick(schedules.length, 'stops', 'stop')} after ${monthLabel(addMonths(from, -1), locale)}`)
      if (followers.length) out.push(`${quoteNames(followers.map((f) => f.name))} ${pick(followers.length, 'stops following it and keeps', 'stop following it and keep')} the last amount as ${pick(followers.length, 'its', 'their')} own from ${at}`)
      if (deductions.length) out.push(`${quoteNames(deductions.map((d) => d.name))} ${pick(deductions.length, 'is', 'are')} no longer deducted from it and ${pick(deductions.length, 'counts', 'count')} as ordinary spending from ${at}`)
      if (sharers.length) out.push(`${quoteNames(sharers.map((s) => s.name))} ${pick(sharers.length, 'takes a percentage of it and gets', 'take a percentage of it and get')} nothing from ${at}, until another rule is picked`)
      if (pool) out.push(`The virtual account "${pool.name}" is no longer filled from ${at}`)
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
  // expenses that come straight out of it ("Comes out of")
  const ref = accountRef(acc.id)
  const funded = ctx.rows.filter((r) => r.defaultFundedBy === ref)
  const paid = ctx.months.filter((m) => (ctx.engine.totals[m]?.accountFundedByAccount[acc.id] ?? 0) !== 0)
  const paying = ctx.schedules.filter((s) => s.fundedBy === ref)
  /**
   * A tracked balance is part of every month from its opening: history. An untracked account is only a name, until
   * an expense comes out of it: that month's leftover depends on it.
   */
  const tracked = acc.tracked ? ctx.months.filter((m) => compareMonths(m, acc.openingMonth) >= 0 && !(acc.archivedMonth && compareMonths(m, acc.archivedMonth) >= 0)) : []
  const activity = ctx.months.filter((m) => tracked.includes(m) || paid.includes(m))
  const goalWords = `The ${pick(goals.length, 'goal', 'goals')} ${quoteNames(goals.map((g) => g.name))}`
  const loses: string[] = []
  if (actuals.length) loses.push(`${plural(actuals.length, 'real balance')} you entered (${monthSpan(actuals.map((a) => a.month), locale)})`)
  if (goals.length) loses.push(`${goalWords}, which ${pick(goals.length, 'watches', 'watch')} it`)
  const blockers: Blocker[] = [
    ...typed.map((r) => ({ text: `"${r.name}" ${TYPED_VERB[r.kind] ?? 'uses it'}`, where: 'Point the row at another account from its row menu on the grid, or archive the row.' })),
    ...pools.map((p) => ({ text: `The virtual account "${p.name}" is held in it`, where: 'Move it to another savings account under Household → Virtual accounts → Edit, or archive it.' })),
  ]
  const changes: string[] = []
  // an expense names its paying account; a transfer or income names where the money goes
  if (plain.length) changes.push(`${quoteNames(plain.map((r) => r.name))} no longer ${pick(plain.length, 'names', 'name')} it${plain.every((r) => r.section === 'expense') ? ' as the paying account' : ''}`)
  if (schedules.length) changes.push(`${plural(schedules.length, 'schedule')} no longer ${pick(schedules.length, 'names', 'name')} it`)
  if (funded.length) changes.push(`${quoteNames(funded.map((r) => r.name))} ${pick(funded.length, 'comes', 'come')} out of the month's income instead`)
  if (paid.length) changes.push(`What came out of it in ${plural(paid.length, 'month')} counts as spent from that month's income, so the leftover there falls`)
  if (paying.length) changes.push(`${plural(paying.length, 'schedule')} ${pick(paying.length, 'comes', 'come')} out of the month's income instead`)
  return {
    kindLabel: 'Account', subject: acc.name, loses, changes, blockers, note: null, activity, canArchive: true,
    archive: (from) => {
      const at = monthLabel(from, locale)
      const out = [acc.tracked ? `Its balance stops at ${monthLabel(addMonths(from, -1), locale)}; from ${at} it is hidden and no longer counts towards net worth` : `Hidden from ${at} on; rows that name it keep working`]
      if (typed.length) out.push(`${quoteNames(typed.map((r) => r.name))} ${pick(typed.length, 'keeps', 'keep')} moving money, but the balance is no longer tracked from ${at}`)
      if (pools.length) out.push(`Its virtual ${pick(pools.length, 'account', 'accounts')} ${quoteNames(pools.map((p) => p.name))} ${pick(pools.length, 'is', 'are')} archived with it from ${at}`)
      // what its virtual accounts paid goes the same way: they are archived with it
      const poolRefs = pools.map((p) => poolRef(p.id))
      const movers = [...new Set([
        ...ctx.rows.filter((r) => r.defaultFundedBy === ref || poolRefs.includes(r.defaultFundedBy)).map((r) => r.name),
        ...ctx.schedules.filter((s) => s.fundedBy === ref || poolRefs.includes(s.fundedBy)).map((s) => s.name),
      ])]
      if (movers.length) out.push(`From ${at}, ${quoteNames(movers)} ${pick(movers.length, 'comes', 'come')} out of the month's income; earlier months keep the account as their source`)
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
  // what came out of it comes out of the account it is held in: the same money, no longer set apart
  const next = poolFallback(ctx, pool)
  const holder = ctx.accounts.find((a) => a.id === pool.accountId)
  const instead = next !== 'cash' && holder ? `"${holder.name}"` : 'the month\'s income'
  const loses: string[] = [`Its balance${activity.length ? ` (${monthSpan(activity, locale)})` : ''}`]
  if (alloc) loses.push(`The row "${alloc.name}" that fills it${allocMonths.length ? `, with its amounts in ${plural(allocMonths.length, 'month')}` : ''}`)
  if (goals.length) loses.push(`${goalWords}, which ${pick(goals.length, 'watches', 'watch')} it`)
  const changes: string[] = []
  if (funded.length) changes.push(`${quoteNames(funded.map((r) => r.name))} ${pick(funded.length, 'comes', 'come')} out of ${instead} instead`)
  if (cellsFunded.length) changes.push(`Spending that came out of it in ${plural(cellsFunded.length, 'month')} counts as spent from ${instead}`)
  if (schedules.length) changes.push(`${plural(schedules.length, 'schedule')} ${pick(schedules.length, 'comes', 'come')} out of ${instead} instead`)
  return {
    kindLabel: 'Virtual account', subject: pool.name, loses, changes, blockers: [], note: null, activity, canArchive: true,
    archive: (from) => {
      const at = monthLabel(from, locale)
      const out = [`Its balance stops at ${monthLabel(addMonths(from, -1), locale)}`]
      if (alloc) out.push(`"${alloc.name}" is archived from ${at}; nothing more is set aside`)
      const movers = [...funded.map((r) => r.name), ...schedules.map((s) => s.name)]
      if (movers.length) out.push(`From ${at}, ${quoteNames(movers)} ${pick(movers.length, 'comes', 'come')} out of ${instead}; earlier months keep the virtual account as their source`)
      if (goals.length) out.push(`${goalWords} can no longer be measured`)
      return out
    },
  }
}

function describeEntity(ctx: Ctx, e: Entity): Described {
  const { locale } = ctx
  const own = ctx.rows.filter((r) => r.scope === e.id)
  const tagged = ctx.rows.filter((r) => r.scope !== e.id && r.entityTags.includes(e.id))
  const owned = ctx.accounts.filter((a) => a.ownerEntityId === e.id)
  const schedules = ctx.schedules.filter((s) => s.scope === e.id)
  const activity = [...new Set([...own, ...tagged].flatMap((r) => amountMonths(ctx, r.id)))].sort()
  const changes: string[] = []
  if (own.length) changes.push(`${quoteNames(own.map((r) => r.name))} ${pick(own.length, 'becomes', 'become')} shared`)
  if (tagged.length) changes.push(`${quoteNames(tagged.map((r) => r.name))} ${pick(tagged.length, 'loses its tag', 'lose their tag')}`)
  if (owned.length) changes.push(`${quoteNames(owned.map((a) => a.name))} ${pick(owned.length, 'becomes', 'become')} a household account`)
  if (schedules.length) changes.push(`${plural(schedules.length, 'schedule')} ${pick(schedules.length, 'becomes', 'become')} shared`)
  return {
    kindLabel: ENTITY_KIND_LABEL[e.kind], subject: e.name, loses: [], changes, blockers: [], note: null, activity, canArchive: true,
    archive: (from) => {
      const at = monthLabel(from, locale)
      return [`Hidden from People & things from ${at}; its rows and earlier months stay as they are`]
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
  const rows = ctx.rows.filter((r) => r.categoryId === c.id && r.kind !== 'category-estimate')
  const estimate = ctx.rows.some((r) => r.categoryId === c.id && r.kind === 'category-estimate')
  return {
    kindLabel: 'Category', subject: c.name, loses: estimate ? ['its estimate, in every month'] : [], blockers: [], note: null, activity: [], canArchive: false, archive: () => [],
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
    case 'pool': return describePool(ctx, find(ctx.pools, target.id, 'virtual account'))
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
  muts.push(...unlinkDeductions(ctx, row, ts))
  for (const p of ctx.pools) if (p.allocationRowId === row.id) muts.push(put('pools', PoolSchema, p, { allocationRowId: null }, ts))
  return muts
}

/** Rows deducted from this income row become ordinary spending again. */
function unlinkDeductions(ctx: Ctx, row: Row, ts: number): Mutation[] {
  return ctx.rows.filter((d) => d.deductedFromRowId === row.id).map((d) => put('rows', RowSchema, d, { deductedFromRowId: null }, ts))
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

/** A memo with nothing in it yet, for an archive from `month`. */
const emptyMemo = (month: MonthKey): ArchiveMemo => ({ month, schedules: [], followers: [], with: [], sources: [] })

/**
 * The memo an archive writes on its record. Something that is archived already and archived again (from another
 * month) keeps what its first archive remembered: that is the state from before any archive, the one to go back to.
 */
function memoFor(record: { archivedMonth: MonthKey | null; archiveMemo?: ArchiveMemo | null }, fresh: ArchiveMemo): ArchiveMemo {
  const first = record.archivedMonth ? record.archiveMemo ?? null : null
  if (!first) return fresh
  const known = <T extends { id: string }>(old: T[], now: T[]): T[] => [...old, ...now.filter((n) => !old.some((o) => o.id === n.id))]
  return {
    month: fresh.month,
    schedules: known(first.schedules, fresh.schedules),
    followers: [...new Set([...first.followers, ...fresh.followers])],
    with: known(first.with, fresh.with),
    sources: [...first.sources, ...fresh.sources],
  }
}

function rowArchive(ctx: Ctx, row: Row, from: MonthKey, ts: number): Mutation[] {
  const memo = emptyMemo(from)
  memo.followers = ctx.rows.filter((r) => r.followsRowId === row.id).map((r) => r.id)
  const schedules = ctx.schedules.filter((s) => s.rowId === row.id)
  const ended: Mutation[] = []
  for (const s of schedules) {
    if (compareMonths(s.startMonth, from) >= 0) {
      memo.schedules.push({ id: s.id, endMonth: s.endMonth, removed: true })
      ended.push(put('recurringItems', RecurringItemSchema, s, { deletedAt: ts }, ts))
    } else if (s.endMonth == null || compareMonths(s.endMonth, from) >= 0) {
      memo.schedules.push({ id: s.id, endMonth: s.endMonth, removed: false })
      ended.push(put('recurringItems', RecurringItemSchema, s, { endMonth: addMonths(from, -1) }, ts))
    }
  }
  // deductions keep their link: the engine stops taking them off the income from the archive month by itself
  const muts: Mutation[] = [put('rows', RowSchema, row, { archivedMonth: from, archiveMemo: memoFor(row, memo) }, ts), ...pinFollowers(ctx, row, from, ts), ...ended]
  // the ended schedules' open postings go, so the next system pass finds nothing to do
  if (schedules.length) {
    const later = ctx.months.filter((m) => compareMonths(m, from) >= 0)
    if (later.length) muts.push(...planRecurringPosts(applyMutations(ctx.tables, muts), later))
  }
  return muts
}

/**
 * Where spending goes that came out of a virtual account once that is gone: out of the account it was held in (the
 * same money, no longer set apart), or out of the month's income when that account cannot pay any more.
 */
function poolFallback(ctx: Ctx, pool: Pool): FundedBy {
  const holder = ctx.accounts.find((a) => a.id === pool.accountId)
  return holder && paysExpenses(holder) && !holder.archivedMonth ? accountRef(holder.id) : 'cash'
}

/** In every month, cell items that came out of `ref` come out of `to`: what a deletion does (rows and schedules are the caller's). */
function moveItemSources(ctx: Ctx, ref: FundedBy, to: FundedBy, ts: number, skipRowId?: string): Mutation[] {
  const muts: Mutation[] = []
  for (const c of ctx.tables.cells) {
    if (c.rowId === skipRowId || !c.items.some((i) => i.fundedBy === ref)) continue
    muts.push(putCell({ ...c, items: c.items.map((i) => (i.fundedBy === ref ? { ...i, fundedBy: to } : i)) }, ts))
  }
  return muts
}

/**
 * From `from` on, what came out of one of `refs` comes out of `to`; earlier months keep their source. Each step
 * builds on the ones before it (`start` is the tables as the caller left them), so several sources retired at once
 * cannot write over each other.
 */
function moveSourcesFrom(start: Tables, closed: Set<MonthKey>, refs: FundedBy[], to: FundedBy, from: MonthKey, ts: number): { mutations: Mutation[]; moved: ArchiveMemo['sources'] } {
  const muts: Mutation[] = []
  let work = start
  const add = (ms: Mutation[]) => {
    muts.push(...ms)
    work = applyMutations(work, ms)
  }
  // what is moved, per source it came out of: the archive keeps it, so that a restore can put it back
  const moved = new Map<FundedBy, ArchiveMemo['sources'][number]>()
  const of = (was: FundedBy) => {
    let entry = moved.get(was)
    if (!entry) moved.set(was, (entry = { was, to, rows: [], schedules: [], items: [] }))
    return entry
  }
  // rows: earlier months keep the old source, the default becomes the new one
  for (const { id, was } of start.rows.filter((r) => !r.deletedAt && refs.includes(r.defaultFundedBy)).map((r) => ({ id: r.id, was: r.defaultFundedBy }))) {
    const row = work.rows.find((r) => r.id === id)
    if (!row || row.deletedAt) continue
    add(planRowFundedBy(work, row, to, { from }, ts))
    of(was).rows.push(id)
  }
  // schedules: a copy from `from` on comes out of the new source; the old one ends the month before
  for (const id of start.recurringItems.filter((s) => !s.deletedAt && refs.includes(s.fundedBy)).map((s) => s.id)) {
    const s = work.recurringItems.find((x) => x.id === id)
    if (!s || s.deletedAt) continue
    if (compareMonths(s.startMonth, from) >= 0) {
      add([put('recurringItems', RecurringItemSchema, s, { fundedBy: to }, ts)])
      of(s.fundedBy).schedules.push(s.id)
    } else if (s.endMonth == null || compareMonths(s.endMonth, from) >= 0) {
      // the copy is the one that comes out of the new source from here on
      const split = planChangeRecurringFrom(work, s, from, { fundedBy: to }, ts)
      add(split.mutations)
      of(s.fundedBy).schedules.push(split.targetId)
    }
  }
  // whatever still comes out of them in open months from `from` on
  const rewrites: Mutation[] = []
  for (const c of work.cells) {
    if (compareMonths(c.month, from) < 0 || closed.has(c.month) || !c.items.some((i) => refs.includes(i.fundedBy))) continue
    rewrites.push(putCell({ ...c, items: c.items.map((i) => (refs.includes(i.fundedBy) ? { ...i, fundedBy: to } : i)) }, ts))
  }
  add(rewrites)
  // the single items that changed their source, whichever of the steps above did it
  const before = new Map(start.cells.map((c) => [`${c.rowId}|${c.month}`, c]))
  for (const c of work.cells) {
    const was = before.get(`${c.rowId}|${c.month}`)
    if (!was || compareMonths(c.month, from) < 0) continue
    for (const i of c.items) {
      const old = was.items.find((x) => x.id === i.id)
      if (old && refs.includes(old.fundedBy) && i.fundedBy === to) of(old.fundedBy).items.push({ rowId: c.rowId, month: c.month, id: i.id })
    }
  }
  return { mutations: muts, moved: [...moved.values()] }
}

function accountRemoval(ctx: Ctx, acc: Account, ts: number): Mutation[] {
  const ref = accountRef(acc.id)
  const muts: Mutation[] = [put('accounts', AccountSchema, acc, { deletedAt: ts }, ts)]
  for (const a of ctx.tables.accountMonths) if (a.accountId === acc.id) muts.push({ op: 'delete', table: 'accountMonths', key: [a.accountId, a.month] })
  // one write per row and per schedule: it may both name the account and come out of it
  for (const r of ctx.rows) {
    const patch: Partial<Row> = {}
    if (r.accountId === acc.id && !accountTypeForRow(r)) patch.accountId = null
    if (r.defaultFundedBy === ref) patch.defaultFundedBy = 'cash'
    if (Object.keys(patch).length) muts.push(put('rows', RowSchema, r, patch, ts))
  }
  for (const s of ctx.schedules) {
    const patch: Partial<RecurringItem> = {}
    if (s.accountId === acc.id) patch.accountId = null
    if (s.fundedBy === ref) patch.fundedBy = 'cash'
    if (Object.keys(patch).length) muts.push(put('recurringItems', RecurringItemSchema, s, patch, ts))
  }
  // what came out of it counts as spent from the month's income, as the engine reads a source that is gone
  muts.push(...moveItemSources(ctx, ref, 'cash', ts))
  for (const g of ctx.goals) if (g.accountId === acc.id) muts.push(put('goals', GoalSchema, g, { deletedAt: ts }, ts))
  return muts
}

function accountArchive(ctx: Ctx, acc: Account, from: MonthKey, ts: number): Mutation[] {
  const muts: Mutation[] = []
  let work = ctx.tables
  const add = (ms: Mutation[]) => {
    muts.push(...ms)
    work = applyMutations(work, ms)
  }
  add([put('accounts', AccountSchema, acc, { archivedMonth: from }, ts)])
  // its virtual accounts go with it, and what they and the account paid comes out of the month's income from then on
  const pools = ctx.pools.filter((p) => p.accountId === acc.id && !(p.archivedMonth && compareMonths(p.archivedMonth, from) <= 0))
  for (const p of pools) add(poolShelve(ctx, p, from, ts))
  const sources = moveSourcesFrom(work, ctx.closed, [accountRef(acc.id), ...pools.map((p) => poolRef(p.id))], 'cash', from, ts)
  add(sources.mutations)
  // what the archive changed with the account, kept on the account for the day it is restored
  const memo: ArchiveMemo = { ...emptyMemo(from), with: pools.map((p) => ({ table: 'pools' as const, id: p.id, was: p.archivedMonth })), sources: sources.moved }
  add([put('accounts', AccountSchema, acc, { archivedMonth: from, archiveMemo: memoFor(acc, memo) }, ts)])
  return muts
}

function poolRemoval(ctx: Ctx, pool: Pool, ts: number): Mutation[] {
  const ref = poolRef(pool.id)
  const to = poolFallback(ctx, pool)
  const muts: Mutation[] = [put('pools', PoolSchema, pool, { deletedAt: ts }, ts)]
  const alloc = pool.allocationRowId ? ctx.rows.find((r) => r.id === pool.allocationRowId) : undefined
  if (alloc) muts.push(...rowRemoval(ctx, alloc, ts).filter((m) => !(m.op === 'put' && m.table === 'pools')))
  for (const r of ctx.rows) if (r.defaultFundedBy === ref) muts.push(put('rows', RowSchema, r, { defaultFundedBy: to }, ts))
  muts.push(...moveItemSources(ctx, ref, to, ts, alloc?.id))
  for (const s of ctx.schedules) if (s.fundedBy === ref) muts.push(put('recurringItems', RecurringItemSchema, s, { fundedBy: to }, ts))
  for (const g of ctx.goals) if (g.poolId === pool.id) muts.push(put('goals', GoalSchema, g, { deletedAt: ts }, ts))
  return muts
}

/** The virtual account itself from `from` on: hidden, and the row that fills it archived. What it paid is the caller's. */
function poolShelve(ctx: Ctx, pool: Pool, from: MonthKey, ts: number, sources: ArchiveMemo['sources'] = []): Mutation[] {
  const alloc = pool.allocationRowId ? ctx.rows.find((r) => r.id === pool.allocationRowId) : undefined
  const takesRow = !!alloc && !(alloc.archivedMonth && compareMonths(alloc.archivedMonth, from) <= 0)
  // the row that was archived with it, and where what it paid went: kept on the virtual account for its restore
  const memo: ArchiveMemo = { ...emptyMemo(from), with: takesRow ? [{ table: 'rows' as const, id: alloc!.id, was: alloc!.archivedMonth }] : [], sources }
  const muts: Mutation[] = [put('pools', PoolSchema, pool, { archivedMonth: from, archiveMemo: memoFor(pool, memo) }, ts)]
  if (takesRow) muts.push(...rowArchive(ctx, alloc!, from, ts))
  return muts
}

function poolArchive(ctx: Ctx, pool: Pool, from: MonthKey, ts: number): Mutation[] {
  const shelved = poolShelve(ctx, pool, from, ts)
  const sources = moveSourcesFrom(applyMutations(ctx.tables, shelved), ctx.closed, [poolRef(pool.id)], poolFallback(ctx, pool), from, ts)
  // the same record once more, now that what it paid has been moved and can be remembered
  return [...shelved, ...sources.mutations, poolShelve(ctx, pool, from, ts, sources.moved)[0]]
}

function entityRemoval(ctx: Ctx, e: Entity, ts: number): Mutation[] {
  const muts: Mutation[] = [put('entities', EntitySchema, e, { deletedAt: ts }, ts)]
  for (const r of ctx.rows) {
    if (r.scope !== e.id && !r.entityTags.includes(e.id)) continue
    muts.push(put('rows', RowSchema, r, { scope: r.scope === e.id ? 'shared' : r.scope, entityTags: r.entityTags.filter((t) => t !== e.id) }, ts))
  }
  for (const a of ctx.accounts) if (a.ownerEntityId === e.id) muts.push(put('accounts', AccountSchema, a, { ownerEntityId: null }, ts))
  for (const s of ctx.schedules) if (s.scope === e.id) muts.push(put('recurringItems', RecurringItemSchema, s, { scope: 'shared' }, ts))
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
    case 'pool': return poolRemoval(ctx, find(ctx.pools, target.id, 'virtual account'), ts)
    case 'entity': return entityRemoval(ctx, find(ctx.entities, target.id, 'person or thing'), ts)
    case 'schedule': return scheduleRemoval(ctx, find(ctx.schedules, target.id, 'schedule'), ts)
    case 'goal': return [put('goals', GoalSchema, find(ctx.goals, target.id, 'goal'), { deletedAt: ts }, ts)]
    case 'category': {
      const c = find(ctx.tables.categories.filter((x) => !x.deletedAt), target.id, 'category')
      // the rows stay, without a category; the estimate belonged to the category and goes with it
      return [put('categories', CategorySchema, c, { deletedAt: ts }, ts), ...ctx.rows.filter((r) => r.categoryId === c.id).map((r) => put('rows', RowSchema, r, r.kind === 'category-estimate' ? { deletedAt: ts } : { categoryId: null }, ts))]
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
    case 'pool': return poolArchive(ctx, find(ctx.pools, target.id, 'virtual account'), month, ts)
    case 'entity': return [put('entities', EntitySchema, find(ctx.entities, target.id, 'person or thing'), { archivedMonth: month }, ts)]
    default: throw new Error(`A ${impact.kindLabel.toLowerCase()} cannot be archived.`)
  }
}

// ---------- restore ----------

/** What a restore did, for the message that follows it. */
export interface Restored {
  /** The name of what was restored. */
  subject: string
  /** What came back with it, as short clauses: `its schedule "Rent" runs again`. */
  back: string[]
  /** What was left as it is, as whole sentences. */
  kept: string[]
}

/** The sentence a screen shows after a restore: what came back, and what stayed. */
export function restoredText(r: Restored): string {
  return [`Restored "${r.subject}"${r.back.length ? `: ${r.back.join('; ')}` : ''}.`, ...r.kept].join(' ')
}

/**
 * The mutations that bring an archived thing back, with what its archive changed (`ArchiveMemo`): a row's schedules
 * and followers, a virtual account's "To …" row, an account's virtual accounts, and what came out of them. One step,
 * so one undo archives it again.
 *
 * Only what still shows what archiving left is put back: a schedule that still ends where the archive ended it, a
 * row or an item that still comes out of the fallback the archive gave it. Whatever was changed in between stays, and
 * so does every month that was closed since.
 */
export function planRestore(tables: Tables, target: RemovalTarget, ts: number, opts: ImpactOptions = {}): { mutations: Mutation[] } & Restored {
  const household = tables.household.find((h) => !h.deletedAt)
  if (!household) throw new Error('No household yet')
  const months = defaultMonths(household, tables, opts.today ?? monthOfDate())
  const closed = new Set(tables.monthStates.filter((s) => s.closed).map((s) => s.month))
  const muts: Mutation[] = []
  let work = tables
  const add = (ms: Mutation[]) => {
    muts.push(...ms)
    work = applyMutations(work, ms)
  }
  const back: string[] = []
  const kept: string[] = []
  /** Amounts and settings that were changed between the archive and now, and so stay as they are. */
  let changed = 0
  /** The earliest month a restore reaches back to: from there the schedules land again. */
  let since: MonthKey | null = null
  const reach = (m: MonthKey) => { if (!since || compareMonths(m, since) < 0) since = m }
  const liveRow = (id: string) => work.rows.find((r) => r.id === id && !r.deletedAt)
  const noMemo = (name: string) => kept.push(`"${name}" was archived before the app kept track of what archiving changes, so only "${name}" itself is back.`)

  /**
   * What came out of the thing and was moved to a fallback goes back, where it still comes out of that fallback.
   * `own` is the source that is the restored thing itself ("it" in the sentence); any other is named.
   */
  const sourcesBack = (memo: ArchiveMemo, own: FundedBy | null) => {
    // the first month that is still open: months closed since keep the source they were closed with
    let from = memo.month
    while (closed.has(from)) from = addMonths(from, 1)
    for (const entry of memo.sources) {
      const rowNames: string[] = []
      let other = 0
      const poolId = poolIdOf(entry.was)
      const accountId = accountIdOf(entry.was)
      const pool = poolId ? work.pools.find((p) => p.id === poolId) : undefined
      const account = accountId ? work.accounts.find((a) => a.id === accountId) : undefined
      const gone = (poolId && (!pool || pool.deletedAt)) || (accountId && (!account || account.deletedAt))
      const shut = (pool && pool.archivedMonth) || (account && account.archivedMonth)
      const count = entry.rows.length + entry.schedules.length + entry.items.length
      if (gone || shut) {
        if (count) kept.push(`What came out of ${pool ? `"${pool.name}"` : account ? `"${account.name}"` : 'it'} stays where the archive moved it: ${gone ? 'that no longer exists' : 'that is still archived'}.`)
        continue
      }
      for (const id of entry.rows) {
        const row = liveRow(id)
        if (!row) continue
        if (row.defaultFundedBy !== entry.to) { changed += 1; continue }
        add(planRowFundedBy(work, row, entry.was, { from }, ts))
        rowNames.push(row.name)
      }
      for (const id of entry.schedules) {
        const s = work.recurringItems.find((x) => x.id === id && !x.deletedAt)
        if (!s) continue
        if (s.fundedBy !== entry.to) { changed += 1; continue }
        add([put('recurringItems', RecurringItemSchema, s, { fundedBy: entry.was }, ts)])
        other += 1
      }
      // single items, one write per month they are in
      const byCell = new Map<string, string[]>()
      for (const it of entry.items) byCell.set(`${it.rowId}|${it.month}`, [...(byCell.get(`${it.rowId}|${it.month}`) ?? []), it.id])
      for (const [key, ids] of byCell) {
        const [rowId, month] = key.split('|')
        const cell = cellOf(work, rowId, month)
        if (!cell || closed.has(month)) continue
        const mine = cell.items.filter((i) => ids.includes(i.id))
        const still = mine.filter((i) => i.fundedBy === entry.to)
        changed += mine.length - still.length
        if (!still.length) continue
        add([putCell({ ...cell, items: cell.items.map((i) => (still.includes(i) ? { ...i, fundedBy: entry.was } : i)) }, ts)])
        other += still.length
      }
      const ofWhat = entry.was === own ? 'it' : `"${(pool ?? account)?.name ?? ''}"`
      if (rowNames.length) back.push(`${quoteNames(rowNames)} ${pick(rowNames.length, 'comes', 'come')} out of ${ofWhat} again`)
      else if (other) back.push(`what came out of ${ofWhat} comes out of it again`)
    }
  }

  const rowBack = (row: Row, to: MonthKey | null, top: boolean) => {
    const memo = row.archiveMemo ?? null
    add([put('rows', RowSchema, row, { archivedMonth: to, archiveMemo: null }, ts)])
    if (!memo) return top ? void noMemo(row.name) : undefined
    reach(memo.month)
    const names: string[] = []
    for (const entry of memo.schedules) {
      const s = work.recurringItems.find((x) => x.id === entry.id)
      if (!s) continue
      if (entry.removed) {
        // removed by the archive, and still removed
        if (s.deletedAt == null) continue
        add([put('recurringItems', RecurringItemSchema, s, { deletedAt: null }, ts)])
      } else {
        // ended by the archive: only when it still ends there
        if (s.deletedAt != null || s.endMonth !== addMonths(memo.month, -1)) { changed += 1; continue }
        add([put('recurringItems', RecurringItemSchema, s, { endMonth: entry.endMonth }, ts)])
      }
      names.push(s.name)
    }
    if (names.length) back.push(`${top ? 'its' : `"${row.name}" has its`} ${pick(names.length, 'schedule', 'schedules')} ${quoteNames(names)} ${top ? pick(names.length, 'runs', 'run') : 'running'} again`)
    const following: string[] = []
    for (const id of memo.followers) {
      const f = liveRow(id)
      // it follows again only while it follows nothing else, and while the row it followed follows nothing itself
      if (!f || f.followsRowId != null || row.followsRowId != null) { if (f) changed += 1; continue }
      add([put('rows', RowSchema, f, { followsRowId: row.id }, ts)])
      following.push(f.name)
    }
    if (following.length) back.push(`${quoteNames(following)} ${pick(following.length, 'follows', 'follow')} ${top ? 'it' : `"${row.name}"`} again`)
  }

  /** Brings a virtual account back, and says which rows fill it again. */
  const poolBack = (pool: Pool, to: MonthKey | null, top: boolean): string[] => {
    const memo = pool.archiveMemo ?? null
    add([put('pools', PoolSchema, pool, { archivedMonth: to, archiveMemo: null }, ts)])
    if (!memo) {
      if (top) noMemo(pool.name)
      return []
    }
    reach(memo.month)
    const fills: string[] = []
    for (const entry of memo.with) {
      const row = entry.table === 'rows' ? liveRow(entry.id) : undefined
      // its "To …" row comes back with it, when it is still archived from the same month
      if (!row || row.archivedMonth !== memo.month) continue
      rowBack(row, entry.was, false)
      fills.push(row.name)
    }
    if (top && fills.length) back.push(`${quoteNames(fills)} ${pick(fills.length, 'fills', 'fill')} it again`)
    sourcesBack(memo, top ? poolRef(pool.id) : null)
    return fills
  }

  let subject: string
  switch (target.kind) {
    case 'row': {
      const row = find(tables.rows.filter((r) => !r.deletedAt), target.id, 'row')
      subject = row.name
      const fills = tables.pools.find((p) => !p.deletedAt && p.allocationRowId === row.id && p.archivedMonth)
      if (fills) throw new Error(`"${row.name}" fills the virtual account "${fills.name}", which is archived. Restore the virtual account: its row comes back with it.`)
      rowBack(row, null, true)
      break
    }
    case 'pool': {
      const pool = find(tables.pools.filter((p) => !p.deletedAt), target.id, 'virtual account')
      subject = pool.name
      const holder = tables.accounts.find((a) => a.id === pool.accountId && !a.deletedAt)
      if (holder?.archivedMonth) throw new Error(`"${pool.name}" is held in "${holder.name}", which is archived. Restore the account first.`)
      poolBack(pool, null, true)
      break
    }
    case 'account': {
      const acc = find(tables.accounts.filter((a) => !a.deletedAt), target.id, 'account')
      subject = acc.name
      const memo = acc.archiveMemo ?? null
      add([put('accounts', AccountSchema, acc, { archivedMonth: null, archiveMemo: null }, ts)])
      if (!memo) { noMemo(acc.name); break }
      reach(memo.month)
      const pools: string[] = []
      const fills: string[] = []
      for (const entry of memo.with) {
        const pool = entry.table === 'pools' ? work.pools.find((p) => p.id === entry.id && !p.deletedAt) : undefined
        // its virtual accounts come back with it, when they are still archived from the same month
        if (!pool || pool.archivedMonth !== memo.month) continue
        pools.push(pool.name)
        fills.push(...poolBack(pool, entry.was, false))
      }
      if (pools.length) back.unshift(`its virtual ${pick(pools.length, 'account', 'accounts')} ${quoteNames(pools)} ${pick(pools.length, 'is', 'are')} back${fills.length ? `, filled by ${quoteNames(fills)} again` : ''}`)
      sourcesBack(memo, accountRef(acc.id))
      break
    }
    case 'entity': {
      const e = find(tables.entities.filter((x) => !x.deletedAt), target.id, 'person or thing')
      subject = e.name
      add([put('entities', EntitySchema, e, { archivedMonth: null }, ts)])
      break
    }
    default: throw new Error(`A ${target.kind} is never archived; there is nothing to restore.`)
  }
  // what the schedules land in the months that count again, in the same step: one undo takes all of it back
  if (since) {
    const from: MonthKey = since
    const later = months.filter((m) => compareMonths(m, from) >= 0)
    if (later.length) add(planRecurringPosts(work, later))
  }
  if (changed) kept.push(`${plural(changed, 'thing')} you changed since ${pick(changed, 'stays as it is', 'stay as they are')}.`)
  return { mutations: muts, subject, back, kept }
}
