import { txt } from '@/i18n'
import { generateKeyBetween, generateNKeysBetween } from 'fractional-indexing'
import { computeEngine, cellKey, sortRows, typedAmount, type EngineOutput } from '@/engine'
import {
  ACCOUNT_TYPE_INFO, AccountSchema, HouseholdSchema, MonthStateSchema, PoolSchema, RecurringItemSchema, RowSchema, accountIdOf, addMonths, canCarryRule, canTakeRest, compareMonths, currencyExponent, fromMinor, holdsBalance, isOldPocketShare, isOutsideNetWorth, isPayOffRow, isShareRule, monthKey, monthOfDate, monthRange, newId, ownBalance, parseMonth, paysExpenses, poolIdOf, resolveRules, sharePercent, toMinor,
  type Account, type Category, type Cell, type CellItem, type FundedBy, type Household, type ItemStatus, type Money, type MonthKey, type Pool, type Row, type RowKind, type Tables,
} from '@/model'
import { NO_QUESTION, type Mutation, type Store } from './store'
import { cellPut, cellRecord } from './cells'
import { refuseThirdCurrency } from './currencies'
import { monthSpan } from './impact'
import { withUsualPayment, type UsualPayment } from './paymentActions'
import { primaryKeyOf } from './keys'
import { planEnd } from './months'

export type EditScope = 'this-month' | 'from-now-on'

const now = () => Date.now()

/** Read every data table once. Cheap at household scale. */
export async function loadTables(store: Store): Promise<Tables> {
  const out: Record<string, unknown[]> = {}
  for (const t of store.db.dataTables) out[t] = await store.db.table(t).toArray()
  return out as unknown as Tables
}

export async function engineUpTo(store: Store, month: MonthKey): Promise<{ tables: Tables; engine: EngineOutput; household: Household }> {
  const tables = await loadTables(store)
  const household = tables.household.find((h) => !h.deletedAt)
  if (!household) throw new Error(txt.errors.noHouseholdYet)
  return { tables, engine: engineFor(tables, household, month), household }
}

/** The engine from the household's first month up to the month after `month`: far enough for every balance of `month`. */
export function engineFor(tables: Tables, household: Household, month: MonthKey): EngineOutput {
  const start = compareMonths(household.startMonth, month) < 0 ? household.startMonth : month
  return computeEngine({ tables, months: monthRange(start, addMonths(month, 1)) })
}

function cellOf(tables: Tables, rowId: string, month: MonthKey): Cell | undefined {
  return tables.cells.find((c) => c.rowId === rowId && c.month === month)
}

// ---------- cells ----------

/**
 * Whether a row's months carry their amount forward: a typed row that is not on a schedule, that no rule works out
 * and that follows no other row. Only such a row can hold an exception (`Cell.once`): on the others a typed amount
 * is its month's alone by itself, since a schedule lands only in its months and a rule fills every month it is not
 * typed over. `tables` says whether the row is on a schedule, so a caller that just made one is believed.
 */
export function carriesForward(tables: Tables, engine: EngineOutput, rowId: string): boolean {
  if (tables.recurringItems.some((r) => !r.deletedAt && r.rowId === rowId)) return false
  const row = tables.rows.find((r) => r.id === rowId && !r.deletedAt)
  const household = tables.household.find((h) => !h.deletedAt)
  if (!row || !household || row.followsRowId || isOldPocketShare(row)) return false
  return !resolveRules(engine.rows, household.closingRule).byRow.has(rowId)
}

/**
 * What "Only this month" has to write beside the month itself, on a row whose months carry forward. The caller
 * writes the month with the mark of an exception (`once`): it then hands on what it was given, and in most cases
 * that is all. One case needs more: the month held an amount of its own that ran on from it ("1,250.00 from March
 * on", and now "March is 1,300.00, only this month"). What ran on still has to, so it is written into the first
 * later month that has nothing of its own. An exception on the way stays where it is, and a carried item in a list
 * on the way gets the amount it was carrying, since what its month is given changes. `engine` is the calculation
 * before the change; it has to reach `month`. Pure; `ts` stamps the writes.
 */
export function standingMoves(tables: Tables, engine: EngineOutput, rowId: string, month: MonthKey, ts: number): Mutation[] {
  const current = engine.cells[cellKey(rowId, month)]
  // nothing ran on from this month: it carried what it was given, or was an exception already, or the row is new
  if (!current || current.handsOn == null || current.handsOn === current.given) return []
  const standing = current.handsOn
  const stored = new Map(tables.cells.filter((c) => c.rowId === rowId).map((c) => [c.month, c]))
  const out: Mutation[] = []
  for (let m = addMonths(month, 1); ; m = addMonths(m, 1)) {
    const cell = stored.get(m)
    if (!cell || cell.mode === 'inherit') {
      out.push(cellPut(cell, { rowId, month: m, mode: 'value', value: standing, items: [] }, ts))
      return out
    }
    if (cell.items.some((i) => i.kind === 'carry')) {
      out.push(cellPut(cell, { rowId, month: m, items: cell.items.map((i) => (i.kind === 'carry' ? { ...i, kind: 'normal' as const, amount: standing } : i)) }, ts))
    }
    // a month with an amount that runs on takes over from here
    if (!cell.once) return out
  }
}

/** What "This and following months" does to the months after the one it is said for. */
export interface Following {
  mutations: Mutation[]
  /** Later months that had an amount of their own, which goes: from now on they follow the new amount. */
  replaced: MonthKey[]
  /** Later months in which something is ticked as done: they keep what they show. */
  kept: MonthKey[]
}

/** Nothing to replace. A new object every time: callers add their own writes to the list they are handed. */
const noFollowing = (): Following => ({ mutations: [], replaced: [], kept: [] })

/** Whether something in a stored month of `row` is ticked as done: what happened is a record, and stays. */
function tickedCell(row: Row, c: Cell): boolean {
  if (c.mode === 'items' && c.items.some((i) => !i.skipped && i.status === 'done')) return true
  // what is left of a category's estimate is worked out, and carries its tick beside it
  return row.kind === 'category-estimate' && !!c.markedDone
}

/** The one source a stored month's amounts come out of, when that is another than the row's own; null otherwise. */
function ownSource(row: Row, c: Cell): FundedBy | null {
  if (row.section !== 'expense' || c.mode !== 'items') return null
  const live = c.items.filter((i) => !i.skipped)
  if (live.length === 0) return null
  const source = live[0].fundedBy
  return source !== row.defaultFundedBy && live.every((i) => i.fundedBy === source) ? source : null
}

/**
 * Make every month after `month` follow `amount`, whatever it held: the months that have something of their own
 * stored are emptied (they inherit again; the note stays). Two kinds of month are not emptied:
 * - a month in which something is ticked as done keeps what it shows, as that month's alone (`once`), so the new
 *   amount goes on after it;
 * - a month whose amounts all come out of one source other than the row's own (the months before a source was
 *   changed "from June on" are stored that way) gets the new amount and keeps that source: emptied, it would take
 *   the row's source of today, and the past balance of the old account would move.
 * `replaced` names the months that showed something else than they were handed; a month that only repeated the
 * amount before it follows silently, and so does a month that holds a list with nothing in it (what a deleted
 * schedule leaves where it had posted): that is no amount of anybody's. `engine` is used when it reaches the last
 * stored month, else one is worked out.
 * No guard here: `planFollowing` decides whether there is anything to replace. Pure; `ts` stamps the writes.
 */
export function replaceFollowing(tables: Tables, rowId: string, month: MonthKey, amount: Money, ts: number, engine?: EngineOutput): Following {
  const row = tables.rows.find((r) => r.id === rowId && !r.deletedAt)
  const household = tables.household.find((h) => !h.deletedAt)
  if (!row || !household) return noFollowing()
  const later = tables.cells
    .filter((c) => c.rowId === rowId && compareMonths(c.month, month) > 0 && (c.mode !== 'inherit' || tickedCell(row, c)))
    .sort((a, b) => compareMonths(a.month, b.month))
  if (later.length === 0) return noFollowing()
  const first = compareMonths(household.startMonth, month) < 0 ? household.startMonth : month
  const last = later[later.length - 1].month
  const shownBy = engine && engine.months.includes(first) && engine.months.includes(last) ? engine : computeEngine({ tables, months: monthRange(first, last) })
  const out: Following = { mutations: [], replaced: [], kept: [] }
  for (const c of later) {
    const shown = shownBy.cells[cellKey(rowId, c.month)]
    if (tickedCell(row, c)) {
      out.kept.push(c.month)
      if (c.mode === 'inherit') {
        // an estimate ticked while it only carried: what it showed is written down
        out.mutations.push(cellPut(c, { rowId, month: c.month, mode: 'value', value: shown ? typedAmount(shown) : 0, items: [], once: true }, ts))
      } else if (!c.once || c.items.some((i) => i.kind === 'carry')) {
        // a carried item reads what the month is given, which changes now: it gets the amount it carried
        const items = c.items.map((i) => (i.kind === 'carry' ? { ...i, kind: 'normal' as const, amount: shown?.items.find((x) => x.id === i.id)?.effectiveAmount ?? 0 } : i))
        out.mutations.push(cellPut(c, { rowId, month: c.month, items, once: true }, ts))
      }
      continue
    }
    const holdsNothing = c.mode === 'items' && c.items.every((i) => i.skipped)
    if (!holdsNothing && (!shown || shown.given == null || typedAmount(shown) !== shown.given)) out.replaced.push(c.month)
    const source = ownSource(row, c)
    if (source) {
      const live = c.items.filter((i) => !i.skipped)
      const item: CellItem = live.length === 1 && live[0].kind === 'normal'
        ? { ...live[0], amount }
        : { id: newId(), label: '', amount, status: row.defaultStatus, fundedBy: source, date: null, note: null, recurringItemId: null, kind: 'normal', skipped: false }
      out.mutations.push(cellPut(c, { rowId, month: c.month, mode: 'items', value: null, items: [item], currencyOverride: null, once: false }, ts))
    } else {
      out.mutations.push(cellPut(c, { rowId, month: c.month, mode: 'inherit', value: null, items: [], currencyOverride: null, markedDone: false }, ts))
    }
  }
  return out
}

/**
 * What saving a month for "This and following months" does to the months after it, when the month then hands on
 * `handsOn`. Only a new amount replaces: a month saved again with the amount it handed on already (to tick it, to
 * change how sure it is, to add a note) leaves the later months alone. And only on a row whose months carry forward
 * (`carriesForward`). The dialog's sentence and the save both come from here, so they cannot disagree. `engine` is
 * the calculation before the change and has to reach `month`. Pure; `ts` stamps the writes.
 */
export function planFollowing(tables: Tables, engine: EngineOutput, rowId: string, month: MonthKey, handsOn: Money, ts: number): Following {
  if (!carriesForward(tables, engine, rowId)) return noFollowing()
  const current = engine.cells[cellKey(rowId, month)]
  if (current && current.handsOn === handsOn) return noFollowing()
  return replaceFollowing(tables, rowId, month, handsOn, ts, engine)
}

/** What a list of items comes to in a month that is given `given`: a carried item is worth that. */
export const itemsAmount = (items: CellItem[], given: Money | null | undefined): Money =>
  items.reduce((sum, i) => (i.skipped ? sum : sum + (i.kind === 'carry' ? given ?? 0 : i.amount)), 0)

/** The currency a row's amounts are typed in: its own, or the household's. A form that reads an amount for a row reads it in this. */
export function rowCurrencyOf(tables: Pick<Tables, 'rows' | 'household'>, rowId: string | null | undefined): string {
  const base = tables.household.find((h) => !h.deletedAt)?.baseCurrency ?? 'EUR'
  return tables.rows.find((r) => r.id === rowId)?.currency ?? base
}

/**
 * A row that moves to a currency counting other decimals (euros to Icelandic krónur, which have no cents) keeps its
 * digits: 1,000.00 becomes 1,000, not 100,000. An amount is stored in its currency's smallest unit, so the stored
 * amounts of the row's months and of its schedules are written again in the new unit; half a króna rounds. A month
 * that keeps a currency of its own (`currencyOverride`) is not in the row's and stays as it is. Between two
 * currencies that count the same decimals nothing is written: the stored numbers already read right.
 * Returns the writes, and the tables as they are with them and with the row in its new currency. Pure.
 */
export function keepDigits(tables: Tables, rowId: string, to: string | null | undefined, ts: number): { tables: Tables; mutations: Mutation[] } {
  const row = tables.rows.find((r) => r.id === rowId && !r.deletedAt)
  const base = tables.household.find((h) => !h.deletedAt)?.baseCurrency
  if (!row || !base || to === undefined) return { tables, mutations: [] }
  const from = row.currency ?? base
  const next = to ?? base
  if (currencyExponent(from) === currencyExponent(next)) return { tables, mutations: [] }
  const inNext = (amount: Money): Money => toMinor(fromMinor(amount, from), next)
  const mutations: Mutation[] = []
  const cells = tables.cells.map((c) => {
    if (c.rowId !== rowId || c.mode === 'inherit' || c.currencyOverride != null) return c
    const record = cellRecord(c, { rowId, month: c.month, value: c.value == null ? null : inNext(c.value), items: c.items.map((it) => ({ ...it, amount: inNext(it.amount) })) }, ts)
    mutations.push({ op: 'put', table: 'cells', record })
    return record
  })
  const recurringItems = tables.recurringItems.map((r) => {
    if (r.rowId !== rowId || r.deletedAt) return r
    const record = RecurringItemSchema.parse({ ...r, amount: inNext(r.amount), updatedAt: ts })
    mutations.push({ op: 'put', table: 'recurringItems', record })
    return record
  })
  return { tables: { ...tables, cells, recurringItems, rows: tables.rows.map((r) => (r.id === rowId ? { ...r, currency: to } : r)) }, mutations }
}

/**
 * What a save of the row's dialog works on when the dialog also moves the row to a currency counting other decimals:
 * the tables with the row's stored amounts in the new unit (`keepDigits`), and the calculation over them. The dialog
 * hands in its amounts in the new unit, so the save compares like with like; read against the old figures, a change
 * of currency alone would look like a new amount and replace what the later months hold. `pre` is what is written for
 * it, ahead of the save's own writes. Without such a change everything comes back as it was handed in.
 */
export function rowInNewCurrency(tables: Tables, engine: EngineOutput, rowId: string, change: RowChange | undefined, ts: number): { tables: Tables; engine: EngineOutput; pre: Mutation[] } {
  const moved = change?.currency === undefined ? null : keepDigits(tables, rowId, change.currency, ts)
  if (!moved || moved.mutations.length === 0) return { tables, engine, pre: [] }
  return { tables: moved.tables, engine: computeEngine({ tables: moved.tables, months: engine.months }), pre: moved.mutations }
}

/** `first` without the writes that `then` makes again: where a save writes a record twice, the later write is the one that counts. */
export function withoutRewritten(first: Mutation[], then: Mutation[]): Mutation[] {
  const keyOf = (m: Mutation) => `${m.table}|${JSON.stringify(m.op === 'put' ? (primaryKeyOf as (t: string, r: unknown) => unknown)(m.table, m.record) : m.key)}`
  const again = new Set(then.map(keyOf))
  return first.filter((m) => !again.has(keyOf(m)))
}

/** What the row's dialog can change on the row itself, in the same step as the month's amount. A field left out stays as it is. */
export interface RowChange {
  /** The currency the row is typed in; null is the household's own. */
  currency?: string | null
  /** The category the row sorts under, one of its section's; null is none. */
  categoryId?: string | null
  /** "Usually paid": the row's day and method of payment, for every month (`withUsualPayment` adds what follows from it). */
  pay?: UsualPayment
}

/** Where a row goes when it moves to a category of its section (or to none): the end of that group. Throws when it cannot go there. */
export function categoryPlacement(tables: Tables, row: Row, categoryId: string | null): { categoryId: string | null; order: string } {
  if (categoryId) {
    const cat = tables.categories.find((c) => c.id === categoryId && !c.deletedAt)
    if (!cat) throw new Error(txt.errors.categoryNoLongerExists)
    if (cat.section !== row.section) throw new Error(txt.errors.categoryInAnotherSection(cat.name))
  }
  if (row.kind === 'category-estimate') throw new Error(txt.errors.estimateStaysWithCategory(row.name))
  const group = sortRows(tables.rows.filter((r) => !r.deletedAt && r.id !== row.id && r.section === row.section && (r.categoryId ?? null) === categoryId), tables.categories)
  return { categoryId, order: generateKeyBetween(group.at(-1)?.order ?? null, null) }
}

/**
 * Why a row's currency cannot change to `next` (null: the household's), or null where it can. A month that holds a
 * recorded conversion (rule X10) keeps the row in its currency: the conversion is between that currency and the
 * household's. The dialogs ask it on the spot; the store refuses with it.
 */
export function currencyHeldReason(tables: Tables, rowId: string, next: string | null): string | null {
  const row = tables.rows.find((r) => r.id === rowId)
  if (!row || (row.currency ?? null) === next) return null
  const months = [...new Set(tables.cells.filter((c) => c.rowId === rowId && c.items.some((i) => i.conversion != null)).map((c) => c.month))].sort()
  if (months.length === 0) return null
  const household = tables.household.find((h) => !h.deletedAt)
  const locale = household?.locale ?? 'en'
  const where = months.length === 1 ? monthSpan(months, locale) : txt.errors.monthsTheFirst(months.length, monthSpan(months.slice(0, 1), locale))
  return txt.errors.conversionHoldsCurrency(row.name, where, row.currency ?? household?.baseCurrency ?? '')
}

/** The row record that goes with a save of the row's dialog: one put for whatever changed on the row, none when nothing did. */
export function rowChangePut(tables: Tables, rowId: string, change: RowChange | undefined): Mutation[] {
  const row = tables.rows.find((r) => r.id === rowId && !r.deletedAt)
  if (!change || !row) return []
  let next: Row = row
  const held = change.currency !== undefined ? currencyHeldReason(tables, rowId, change.currency) : null
  if (held) throw new Error(held)
  if (change.currency !== undefined && (row.currency ?? null) !== change.currency) next = { ...next, currency: change.currency }
  if (change.categoryId !== undefined && (row.categoryId ?? null) !== change.categoryId) next = { ...next, ...categoryPlacement(tables, row, change.categoryId) }
  return next === row ? [] : [{ op: 'put', table: 'rows', record: RowSchema.parse({ ...next, updatedAt: now() }) }]
}

/**
 * Set one amount for a month. `from-now-on` is "This and following months": the months after it follow, and a new
 * amount replaces what they held (`planFollowing`). `this-month` makes it that month's alone (`Cell.once`), so the
 * months after go on as they were. A row whose months do not carry forward (a schedule, a rule, a follower) takes
 * the amount for its month either way.
 */
export async function setCellValue(store: Store, rowId: string, month: MonthKey, value: Money, scope: EditScope, rowChange?: RowChange): Promise<void> {
  const loaded = await engineUpTo(store, month)
  const ts = now()
  const { tables, engine, pre } = rowInNewCurrency(loaded.tables, loaded.engine, rowId, rowChange, ts)
  const once = scope === 'this-month' && carriesForward(tables, engine, rowId)
  const mutations: Mutation[] = once ? standingMoves(tables, engine, rowId, month, ts) : planFollowing(tables, engine, rowId, month, value, ts).mutations
  const existing = cellOf(tables, rowId, month)
  mutations.push(cellPut(existing, { rowId, month, mode: 'value', value, items: [], markedDone: false, once }, ts))
  mutations.push(...rowChangePut(loaded.tables, rowId, rowChange))
  const all = withUsualPayment(loaded.tables, [...withoutRewritten(pre, mutations), ...mutations], rowId, rowChange?.pay, ts)
  refuseThirdCurrency(loaded.tables, all)
  await store.commit(all)
}

export async function setCellItems(store: Store, rowId: string, month: MonthKey, items: CellItem[], scope: EditScope = 'from-now-on', rowChange?: RowChange): Promise<void> {
  const loaded = await engineUpTo(store, month)
  const ts = now()
  const { tables, engine, pre } = rowInNewCurrency(loaded.tables, loaded.engine, rowId, rowChange, ts)
  const once = scope === 'this-month' && carriesForward(tables, engine, rowId)
  const total = itemsAmount(items, engine.cells[cellKey(rowId, month)]?.given)
  const mutations: Mutation[] = once ? standingMoves(tables, engine, rowId, month, ts) : planFollowing(tables, engine, rowId, month, total, ts).mutations
  const existing = cellOf(tables, rowId, month)
  mutations.push(cellPut(existing, { rowId, month, mode: 'items', value: null, items, markedDone: false, once }, ts))
  mutations.push(...rowChangePut(loaded.tables, rowId, rowChange))
  const all = withUsualPayment(loaded.tables, [...withoutRewritten(pre, mutations), ...mutations], rowId, rowChange?.pay, ts)
  refuseThirdCurrency(loaded.tables, all)
  await store.commit(all)
}

/** Back to inheriting from the previous month. Stored as an inherit record (not a delete) so the change travels between devices. */
export async function clearCell(store: Store, rowId: string, month: MonthKey): Promise<void> {
  const tables = await loadTables(store)
  const existing = cellOf(tables, rowId, month)
  if (!existing || existing.mode === 'inherit') return
  // an inheriting month has no amount of its own, so the mark of an exception goes with the amount (`cellRecord`)
  await store.commit([cellPut(existing, { rowId, month, mode: 'inherit', value: null, items: [], markedDone: false }, now())])
}

/** Turn whatever the cell shows into an items list so single entries can be added. */
export function itemsFromCurrent(engineCell: { source: string; value: Money; asked?: Money; items: CellItem[] } | undefined, defaultFundedBy: CellItem['fundedBy'], defaultStatus: ItemStatus): CellItem[] {
  if (!engineCell || engineCell.source === 'empty' || engineCell.source === 'archived') return []
  if (engineCell.source === 'items') return engineCell.items.map(({ ...it }) => ({ ...it }))
  if (engineCell.source === 'inherit') {
    return [{ id: newId(), label: '', amount: 0, status: defaultStatus, fundedBy: defaultFundedBy, date: null, note: null, recurringItemId: null, kind: 'carry', skipped: false }]
  }
  // what was planned, where a payment to a loan counts for less because less was owed
  return [{ id: newId(), label: '', amount: engineCell.asked ?? engineCell.value, status: defaultStatus, fundedBy: defaultFundedBy, date: null, note: null, recurringItemId: null, kind: 'normal', skipped: false }]
}

export async function setItemStatus(store: Store, rowId: string, month: MonthKey, itemId: string, status: ItemStatus): Promise<void> {
  const tables = await loadTables(store)
  const cell = cellOf(tables, rowId, month)
  if (!cell || cell.mode !== 'items') throw new Error(txt.errors.cellNoItems)
  if (!cell.items.some((it) => it.id === itemId)) throw new Error(txt.errors.itemGone)
  await store.commit([cellPut(cell, { rowId, month, items: cell.items.map((it) => (it.id === itemId ? { ...it, status } : it)) }, now())], NO_QUESTION)
}

// ---------- rows ----------

/** The category a row sorts under: a live category of its own section, or none. */
function groupKey(tables: Tables, r: Pick<Row, 'section' | 'categoryId'>): string | null {
  const c = r.categoryId ? tables.categories.find((x) => x.id === r.categoryId && !x.deletedAt) : undefined
  return c && c.section === r.section ? c.id : null
}

/** The rows a row is placed among: its section and its category group, in display order. */
function groupRows(tables: Tables, r: Pick<Row, 'section' | 'categoryId'>): Row[] {
  const key = groupKey(tables, r)
  return sortRows(tables.rows.filter((x) => !x.deletedAt && x.section === r.section && groupKey(tables, x) === key), tables.categories)
}

/** The put for a new row at the end of its group, or right after `afterRowId`; the caller commits. */
export function newRowMutation(tables: Tables, input: Partial<Row> & { name: string; section: Row['section'] }, afterRowId?: string): { row: Row; mutation: Mutation } {
  const after = afterRowId ? tables.rows.find((r) => r.id === afterRowId && !r.deletedAt) : undefined
  const categoryId = input.categoryId !== undefined ? input.categoryId : after?.categoryId ?? null
  if (categoryId && groupKey(tables, { section: input.section, categoryId }) === null) throw new Error(txt.errors.categoryNotSection)
  const list = groupRows(tables, { section: input.section, categoryId })
  let prev: string | null = list.length ? list[list.length - 1].order : null
  let next: string | null = null
  if (after) {
    const i = list.findIndex((r) => r.id === after.id)
    if (i >= 0) {
      prev = list[i].order
      next = list[i + 1]?.order ?? null
    }
  }
  const ts = now()
  const row = RowSchema.parse({ id: newId(), createdAt: ts, updatedAt: ts, ...input, categoryId, order: generateKeyBetween(prev, next) })
  return { row, mutation: { op: 'put', table: 'rows', record: row } }
}

/** Add a row at the end of its category group, or right after `afterRowId`, whose category it inherits unless given one. */
export async function addRow(store: Store, input: Partial<Row> & { name: string; section: Row['section'] }, afterRowId?: string): Promise<Row> {
  const tables = await loadTables(store)
  const { row, mutation } = newRowMutation(tables, input, afterRowId)
  refuseThirdCurrency(tables, [mutation])
  await store.commit([mutation], NO_QUESTION)
  return row
}

/**
 * What a new row under Transfers does; `plain` just moves money between your accounts, `from-savings` and
 * `from-investment` take money out of an account into the month.
 */
export type TransferRowKind = 'plain' | 'to-savings' | 'to-investment' | 'pool-allocation' | 'pocket-money' | 'from-savings' | 'from-investment'
/** What a new row under Expenses does: a normal expense, or a payment that brings a loan or card down. */
export type ExpenseRowKind = 'plain' | 'pay-off'

/**
 * What a new row can point at: live, unarchived accounts and virtual accounts, live adults, and whether the savings plug
 * already has its row. The grid's "Add row" and `addRowOfKind` both read this, so what is offered is what is accepted.
 */
export function rowTargets(tables: Tables, household: Household | undefined) {
  const live = <T extends { deletedAt: number | null; archivedMonth: MonthKey | null }>(xs: T[]) => xs.filter((x) => !x.deletedAt && !x.archivedMonth)
  const accounts = live(tables.accounts)
  const rows = tables.rows.filter((r) => !r.deletedAt)
  return {
    savings: accounts.filter((a) => a.type === 'savings'),
    investments: accounts.filter((a) => a.type === 'investment'),
    /** where a row that moves money can send it: the accounts with a balance of their own (savings, investments, cash, other assets) */
    balances: accounts.filter(holdsBalance),
    /** what a payment row brings down: loans and cards */
    payoff: accounts.filter((a) => a.type === 'loan' || a.type === 'credit-card'),
    /** virtual accounts whose row was deleted, so they can be filled again */
    orphanPools: live(tables.pools).filter((p) => !p.allocationRowId || !rows.some((r) => r.id === p.allocationRowId)),
    adults: live(tables.entities).filter((e) => e.kind === 'adult'),
    /** the rest of the month already has its row: a further "to savings" row gets a fixed amount of its own */
    plugTaken: !!household && resolveRules(sortRows(rows, tables.categories), household.closingRule).restRowId !== null,
  }
}

export interface RowOfKindInput {
  section: 'expense' | 'transfer'
  name: string
  categoryId: string | null
  kind: TransferRowKind | ExpenseRowKind
  accountId?: string | null
  poolId?: string | null
  adultId?: string | null
}

/** What a row is called when no name was typed: after the account it fills, takes from or pays off. */
export function rowNameFor(kind: RowOfKindInput['kind'], target: string): string {
  if (kind === 'from-savings' || kind === 'from-investment') return txt.names.rowFrom(target)
  if (kind === 'pay-off') return txt.names.rowPaysOff(target)
  return txt.names.rowTo(target)
}

/** The row that pays a loan or a card off is a row under Expenses: what `addRowOfKind` is asked for. */
export const PAY_OFF: Pick<RowOfKindInput, 'section' | 'kind'> = { section: 'expense', kind: 'pay-off' }

/**
 * The kind a row that pays `account` off is stored with: a loan's payment and a card's are two kinds, which the
 * engine reads alike (`isPayOffRow`). The one reading of it, for a new row and for a row whose account changed.
 */
export const payOffKindOf = (account: Pick<Account, 'type'>): 'debt-payment' | 'card-payment' => (account.type === 'loan' ? 'debt-payment' : 'card-payment')

/**
 * What has to change on rows that pay a loan or a card off so that they stand where such a row belongs: under
 * Expenses, with the kind of the account each of them pays (`kindOf`; a row whose account is gone keeps its kind).
 * A row that fits already is not in the result, so nothing is written for it. A row that stood under Transfers (the
 * payment of a card from before schema 23) joins the end of the expense rows without a category, the rows that move
 * together in the order they had; it loses its category, which belongs to the section it leaves. Pure.
 */
export function payOffPatches(tables: Tables, rows: Row[], kindOf: (row: Row) => Row['kind']): Map<string, Partial<Row>> {
  const out = new Map<string, Partial<Row>>()
  const moving = sortRows(rows.filter((r) => r.section !== 'expense'), tables.categories)
  const ids = new Set(moving.map((r) => r.id))
  const last = groupRows(tables, { section: 'expense', categoryId: null }).filter((r) => !ids.has(r.id)).at(-1)?.order ?? null
  const orders = generateNKeysBetween(last, null, moving.length)
  moving.forEach((r, i) => out.set(r.id, { section: 'expense', kind: kindOf(r), categoryId: null, order: orders[i] }))
  for (const r of rows) if (!out.has(r.id) && r.kind !== kindOf(r)) out.set(r.id, { kind: kindOf(r) })
  return out
}

/**
 * The puts for a new row under Transfers or Expenses. A deposit row needs its account, a pool row the virtual account
 * it fills (one that lost its row), pocket money the adult it is for, a payment row the loan or card it brings down;
 * everything is checked here so the form can say what is missing. A row that names an account, or a virtual account,
 * may come without a name and is then called after it. Pure; the caller commits, so an account and its row can be one
 * step.
 */
export function rowOfKindMutations(tables: Tables, input: RowOfKindInput): { row: Row; mutations: Mutation[] } {
  const targets = rowTargets(tables, tables.household.find((h) => !h.deletedAt))
  const transferOnly: string[] = ['to-savings', 'to-investment', 'pool-allocation', 'pocket-money', 'from-savings', 'from-investment']
  if ((input.section === 'expense' && transferOnly.includes(input.kind)) || (input.section === 'transfer' && input.kind === 'pay-off')) {
    throw new Error(txt.errors.rowKindNotInSection)
  }
  const typed = input.name.trim()
  const base: Partial<Row> & { name: string; section: Row['section'] } = { name: typed, section: input.section, categoryId: input.categoryId, kind: input.kind === 'pay-off' ? 'plain' : input.kind }
  const nameAfter = (target: string) => { if (!typed) base.name = rowNameFor(input.kind, target) }
  if (input.kind !== 'plain') base.defaultStatus = 'committed'
  if (input.kind === 'pay-off') {
    const acc = tables.accounts.find((a) => a.id === input.accountId && !a.deletedAt)
    if (!acc) throw new Error(txt.errors.pickLoanCardRowPays)
    if (acc.archivedMonth) throw new Error(txt.errors.archived(acc.name))
    if (!targets.payoff.some((a) => a.id === acc.id)) throw new Error(txt.errors.notLoanCreditCard(acc.name))
    base.kind = payOffKindOf(acc)
    base.accountId = acc.id
    nameAfter(acc.name)
  } else if (input.kind === 'to-savings' || input.kind === 'to-investment' || input.kind === 'from-savings' || input.kind === 'from-investment') {
    const acc = checkAccountForRow(tables, { kind: input.kind, name: typed || txt.errors.theNewRow }, input.accountId ?? null)
    if (acc) {
      base.accountId = acc.id
      nameAfter(acc.name)
    }
    // beside the row that takes the rest, a further savings row is typed: said outright, or it would read as idle
    if (input.kind === 'to-savings' && targets.plugTaken) base.rule = 'fixed'
  } else if (input.kind === 'plain' && input.section === 'transfer' && input.accountId) {
    // a row that moves money into another account: the account it names receives the amount, and may name the row
    const acc = checkAccountForRow(tables, { kind: 'plain', section: 'transfer', name: typed || txt.errors.theNewRow }, input.accountId)
    if (acc) {
      base.accountId = acc.id
      nameAfter(acc.name)
    }
  } else if (input.kind === 'pocket-money') {
    const adult = targets.adults.find((e) => e.id === input.adultId)
    if (!adult) throw new Error(txt.errors.pickAdultPocketMoney)
    Object.assign(base, { scope: adult.id, entityTags: [adult.id], pocketMode: 'fixed' })
  }
  let pool: Pool | undefined
  if (input.kind === 'pool-allocation') {
    const found = tables.pools.find((p) => p.id === input.poolId && !p.deletedAt)
    if (!found) throw new Error(txt.errors.pickVirtualAccountRowFills)
    if (found.archivedMonth) throw new Error(txt.errors.archived(found.name))
    if (!targets.orphanPools.some((p) => p.id === found.id)) throw new Error(txt.errors.alreadyFilledAnotherRow(found.name))
    base.accountId = found.accountId
    nameAfter(found.name)
    pool = found
  }
  if (!base.name) throw new Error(txt.errors.giveRowName)
  const { row, mutation } = newRowMutation(tables, base)
  const mutations: Mutation[] = [mutation]
  if (pool) mutations.push({ op: 'put', table: 'pools', record: PoolSchema.parse({ ...pool, allocationRowId: row.id, updatedAt: now() }) })
  return { row, mutations }
}

/** "Add row" under Transfers and Expenses: `rowOfKindMutations`, committed. */
export async function addRowOfKind(store: Store, input: RowOfKindInput): Promise<Row> {
  const tables = await loadTables(store)
  const { row, mutations } = rowOfKindMutations(tables, input)
  refuseThirdCurrency(tables, mutations)
  await store.commit(mutations, NO_QUESTION)
  return row
}

// ---------- category estimates ----------

/** The row that carries a category's estimate; the Grid shows it by this name. */
export const estimateRowName = (category: Pick<Category, 'name'>): string => txt.names.estimateRow(category.name)

/** A category's estimate row, archived or not; there is one per category at most. */
export const estimateRowOf = (tables: Tables, categoryId: string): Row | undefined =>
  tables.rows.find((r) => !r.deletedAt && r.kind === 'category-estimate' && r.categoryId === categoryId)

/**
 * The puts that give an expense category its estimate from `month`: the estimate row on first use (at the end of the
 * category, back from the archive if it was there) and its amount for the month. `this-month` makes the amount that
 * month's alone: the months after go on with the estimate they had, none for a category that had none. Otherwise a
 * new amount replaces what later months held, except where the estimate is ticked as done. `engine` is
 * the calculation before the change, for a category that has an estimate row already; a new one needs none.
 * Pure; the caller commits, so a new category and its estimate can be one step.
 */
export function categoryEstimateMutations(tables: Tables, category: Category, month: MonthKey, amount: Money, scope: EditScope, engine: EngineOutput | null = null): { row: Row; mutations: Mutation[] } {
  if (category.section !== 'expense') throw new Error(txt.errors.onlyExpenseCategoryEstimate)
  if (!Number.isFinite(amount) || amount < 0) throw new Error(txt.errors.estimateCannotBelowZero)
  const mutations: Mutation[] = []
  let row = estimateRowOf(tables, category.id)
  if (!row) {
    const made = newRowMutation(tables, { name: estimateRowName(category), section: 'expense', kind: 'category-estimate', categoryId: category.id })
    row = made.row
    mutations.push(made.mutation)
  } else if (row.archivedMonth) {
    // an estimate that is typed again is in use again: its row comes back as it is, and its archive is forgotten
    row = RowSchema.parse({ ...row, archivedMonth: null, archiveMemo: null, updatedAt: now() })
    mutations.push({ op: 'put', table: 'rows', record: row })
  }
  const ts = now()
  const once = scope === 'this-month'
  if (engine) mutations.push(...(once ? standingMoves(tables, engine, row.id, month, ts) : planFollowing(tables, engine, row.id, month, amount, ts).mutations))
  const existing = cellOf(tables, row.id, month)
  mutations.push(cellPut(existing, { rowId: row.id, month, mode: 'value', value: amount, items: [], currencyOverride: null, once }, ts))
  return { row, mutations }
}

/**
 * What an expense category is expected to come to in a month, typed before its rows are known. The category's rows
 * are taken off it and the rest counts as "Not broken down yet"; once they add up to more, they are the category.
 * 0 takes the estimate away from this month on (or for this month only). One commit.
 */
export async function setCategoryEstimate(store: Store, categoryId: string, month: MonthKey, amount: Money, scope: EditScope = 'from-now-on'): Promise<Row> {
  const { tables, engine } = await engineUpTo(store, month)
  const category = tables.categories.find((c) => c.id === categoryId && !c.deletedAt)
  if (!category) throw new Error(txt.errors.categoryNoLongerExists)
  const { row, mutations } = categoryEstimateMutations(tables, category, month, amount, scope, engine)
  await store.commit(mutations)
  return row
}

export async function updateRow(store: Store, rowId: string, patch: Partial<Omit<Row, 'id' | 'createdAt'>>): Promise<void> {
  const tables = await loadTables(store)
  const row = tables.rows.find((r) => r.id === rowId)
  if (!row) throw new Error(txt.errors.rowNotFound)
  const ts = now()
  const held = patch.currency !== undefined ? currencyHeldReason(tables, rowId, patch.currency) : null
  if (held) throw new Error(held)
  // another currency: the amounts the row holds keep their digits (`keepDigits`), in the same step
  const moved = patch.currency !== undefined && (patch.currency ?? null) !== (row.currency ?? null) ? keepDigits(tables, rowId, patch.currency, ts).mutations : []
  const mutations: Mutation[] = [{ op: 'put', table: 'rows', record: RowSchema.parse({ ...row, ...patch, updatedAt: ts }) }, ...moved]
  refuseThirdCurrency(tables, mutations)
  await store.commit(mutations)
}

export const renameRow = (store: Store, rowId: string, name: string) => updateRow(store, rowId, { name })

export async function moveRow(store: Store, rowId: string, direction: 'up' | 'down'): Promise<void> {
  const tables = await loadTables(store)
  const row = tables.rows.find((r) => r.id === rowId)
  if (!row) throw new Error(txt.errors.rowNotFound)
  const list = groupRows(tables, row)
  const i = list.findIndex((r) => r.id === rowId)
  const j = direction === 'up' ? i - 1 : i + 1
  if (j < 0 || j >= list.length) return
  // place between the neighbour on the far side and the neighbour we jump over
  const far = direction === 'up' ? list[j - 1]?.order ?? null : list[j + 1]?.order ?? null
  const order = direction === 'up' ? generateKeyBetween(far, list[j].order) : generateKeyBetween(list[j].order, far)
  await store.commit([{ op: 'put', table: 'rows', record: RowSchema.parse({ ...row, order, updatedAt: now() }) }])
}

// ---------- household ----------

export interface QuickHousehold {
  name: string
  baseCurrency: string
  locale: string
  startMonth: MonthKey
  closingRule?: Household['closingRule']
}

/** Minimal household: settings, one savings account, a handful of starter rows. */
export async function quickCreateHousehold(store: Store, input: QuickHousehold): Promise<Household> {
  const ts = now()
  // made since rule B9: there is nothing from before it to put right
  const household = HouseholdSchema.parse({ id: newId(), createdAt: ts, updatedAt: ts, askMainAccount: false, ...input })
  const savings: Account = AccountSchema.parse({
    id: newId(), createdAt: ts, updatedAt: ts, name: txt.names.starter.savings, type: 'savings', currency: input.baseCurrency,
    openingBalance: 0, openingMonth: input.startMonth, tracked: true,
  })
  const starters: Array<Partial<Row> & { name: string; section: Row['section'] }> = [
    { name: txt.names.starter.salary, section: 'income', kind: 'salary', defaultStatus: 'committed' },
    { name: txt.names.starter.otherIncome, section: 'income' },
    { name: txt.names.starter.rent, section: 'expense', defaultStatus: 'committed' },
    { name: txt.names.starter.groceries, section: 'expense' },
    { name: txt.names.starter.other, section: 'expense' },
    { name: txt.names.starter.toSavings, section: 'transfer', kind: 'to-savings', accountId: savings.id, defaultStatus: 'committed' },
  ]
  let prev: string | null = null
  const rows = starters.map((s) => {
    const order = generateKeyBetween(prev, null)
    prev = order
    return RowSchema.parse({ id: newId(), createdAt: ts, updatedAt: ts, ...s, order })
  })
  await store.commit([
    { op: 'put', table: 'household', record: household },
    { op: 'put', table: 'accounts', record: savings },
    ...rows.map((r): Mutation => ({ op: 'put', table: 'rows', record: r })),
  ], NO_QUESTION)
  return household
}

export async function updateHousehold(store: Store, patch: Partial<Omit<Household, 'id' | 'createdAt'>>): Promise<void> {
  const tables = await loadTables(store)
  const h = tables.household.find((x) => !x.deletedAt)
  if (!h) throw new Error(txt.errors.noHouseholdYet)
  await store.commit([{ op: 'put', table: 'household', record: HouseholdSchema.parse({ ...h, ...patch, updatedAt: now() }) }])
}

/** "Add <year>": plan one more calendar year after the last one shown. Stored on the household, so every screen and device shows it. */
export async function addPlanYear(store: Store, today: MonthKey = monthOfDate()): Promise<MonthKey> {
  const tables = await loadTables(store)
  const household = tables.household.find((h) => !h.deletedAt)
  if (!household) throw new Error(txt.errors.noHouseholdYet)
  const planUntil = monthKey(parseMonth(planEnd(household, tables, today)).year + 1, 12)
  await store.commit([{ op: 'put', table: 'household', record: HouseholdSchema.parse({ ...household, planUntil, updatedAt: now() }) }])
  return planUntil
}

/** Mark a whole cell done (or back to the row default). Plain values become a single item. */
/**
 * What ticking one line of a month as done (or as not done) writes; nothing for a line that is archived there, or
 * that reads so already. An amount the app works out keeps its tick beside it (`markedDone`). A typed or carried
 * amount becomes one item that carries the tick, and an itemized line gets it on every item that counts. No amount
 * changes: a month that only carried its amount is written down as that month's alone (`once`), so the months after
 * it go on reading the amount where it was typed, and a ticked month never becomes where an amount begins.
 * Pure; `ts` stamps the writes.
 */
export function lineDoneMutations(tables: Tables, engine: EngineOutput, row: Row, month: MonthKey, done: boolean, ts: number): Mutation[] {
  const current = engine.cells[cellKey(row.id, month)]
  if (!current || current.source === 'archived') return []
  const existing = cellOf(tables, row.id, month)
  if (current.source === 'derived') {
    if ((existing?.markedDone ?? false) === done) return []
    return [cellPut(existing, { rowId: row.id, month, markedDone: done }, ts)]
  }
  const status = done ? 'done' : row.defaultStatus
  if (existing?.mode === 'items' && existing.items.every((it) => it.skipped || it.status === status)) return []
  const items: CellItem[] =
    existing?.mode === 'items'
      ? existing.items.map((it) => (it.skipped ? it : { ...it, status }))
      : typedAmount(current) === 0
        ? []
        : [{ id: newId(), label: '', amount: typedAmount(current), status, fundedBy: row.defaultFundedBy, date: null, note: null, recurringItemId: null, kind: 'normal', skipped: false }]
  if (items.length === 0 && !existing) return []
  return [cellPut(existing, { rowId: row.id, month, mode: 'items', value: null, items, markedDone: false, ...(current.source === 'inherit' ? { once: true } : {}) }, ts)]
}

/**
 * "Count everything in <Month> as done": the tick on every line of the month that has an amount and does not carry it
 * yet. No amount changes. Pure; `ts` stamps the writes.
 */
export function countDoneMutations(tables: Tables, engine: EngineOutput, month: MonthKey, ts: number): Mutation[] {
  const out: Mutation[] = []
  for (const row of engine.rows) {
    const c = engine.cells[cellKey(row.id, month)]
    // a line with nothing in the month has nothing to tick; a payment that was cut to nothing still has its plan
    if (!c || c.source === 'archived' || c.source === 'empty' || (c.value === 0 && typedAmount(c) === 0)) continue
    out.push(...lineDoneMutations(tables, engine, row, month, true, ts))
  }
  return out
}

export async function setCellDone(store: Store, rowId: string, month: MonthKey, done: boolean): Promise<void> {
  const { tables, engine } = await engineUpTo(store, month)
  const row = tables.rows.find((r) => r.id === rowId)
  if (!row) throw new Error(txt.errors.rowNotFound)
  const mutations = lineDoneMutations(tables, engine, row, month, done, now())
  if (mutations.length) await store.commit(mutations, NO_QUESTION)
}
export async function setDerivedDone(store: Store, rowId: string, month: MonthKey, done: boolean): Promise<void> {
  const tables = await loadTables(store)
  const existing = cellOf(tables, rowId, month)
  if ((existing?.markedDone ?? false) === done) return
  await store.commit([cellPut(existing, { rowId, month, markedDone: done }, now())], NO_QUESTION)
}

// ---------- monthly defaults with a scope ----------

export type MonthlyDefaultScope = 'from-now-on' | 'this-month' | 'all-months'

/**
 * Change the cash buffer (the cash kept in the account at month end).
 * - 'this-month': an override for that month only; the default stays
 * - 'from-now-on': the months before `month` are held at what they show now, the default changes
 * - 'all-months': every month follows the new default, the months before as well (overrides dropped)
 */
export async function setMonthlyDefault(store: Store, value: Money, scope: MonthlyDefaultScope, month: MonthKey): Promise<void> {
  const tables = await loadTables(store)
  const household = tables.household.find((h) => !h.deletedAt)
  if (!household) throw new Error(txt.errors.noHouseholdYet)
  const states = new Map(tables.monthStates.map((s) => [s.month, s]))
  const ts = now()
  const mutations: Mutation[] = []
  const putState = (m: MonthKey, override: Money | null) => {
    const prev = states.get(m)
    mutations.push({ op: 'put', table: 'monthStates', record: MonthStateSchema.parse({ month: m, ...prev, cashBufferOverride: override, updatedAt: ts }) })
  }
  if (scope === 'this-month') {
    putState(month, value)
  } else {
    if (scope === 'from-now-on' && compareMonths(month, household.startMonth) > 0) {
      for (const m of monthRange(household.startMonth, addMonths(month, -1))) {
        if (states.get(m)?.cashBufferOverride != null) continue
        putState(m, household.cashBuffer)
      }
    }
    for (const s of tables.monthStates) {
      if (s.cashBufferOverride == null) continue
      if (scope === 'all-months' || compareMonths(s.month, month) >= 0) putState(s.month, null)
    }
    mutations.push({ op: 'put', table: 'household', record: HouseholdSchema.parse({ ...household, cashBuffer: value, updatedAt: ts }) })
  }
  await store.commit(mutations)
}

// ---------- row sources, accounts and followers ----------

export type RowSourceScope = { from: MonthKey } | 'all-months'

/**
 * Change where a row's single amounts come out of. With `{ from }`, every earlier month that showed
 * an amount is pinned to the old source (as one unlabelled item), so past savings and virtual account balances stay put.
 */
export async function setRowFundedBy(store: Store, rowId: string, fundedBy: FundedBy, scope: RowSourceScope): Promise<void> {
  const tables = await loadTables(store)
  const row = tables.rows.find((r) => r.id === rowId && !r.deletedAt)
  if (!row) throw new Error(txt.errors.rowNotFound)
  if (row.section !== 'expense') throw new Error(txt.errors.onlySpendingRowsSource)
  const mutations = planRowFundedBy(tables, row, fundedBy, scope, now())
  refuseThirdCurrency(tables, mutations)
  await store.commit(mutations)
}

/** The mutations behind `setRowFundedBy`; archiving an account or a virtual account uses them too. */
export function planRowFundedBy(tables: Tables, row: Row, fundedBy: FundedBy, scope: RowSourceScope, ts: number): Mutation[] {
  const poolId = poolIdOf(fundedBy)
  if (poolId && !tables.pools.some((p) => p.id === poolId && !p.deletedAt)) throw new Error(txt.errors.virtualAccountNoLongerExists)
  const accountId = accountIdOf(fundedBy)
  if (accountId) {
    const acc = tables.accounts.find((a) => a.id === accountId && !a.deletedAt)
    if (!acc) throw new Error(txt.errors.accountNoLongerExists)
    if (!paysExpenses(acc)) throw new Error(txt.errors.expenseCannotComeStraightOut(acc.name))
    if (acc.archivedMonth && fundedBy !== row.defaultFundedBy) throw new Error(txt.errors.archivedPickAccountStillOpen(acc.name))
  }
  const mutations: Mutation[] = []
  if (scope !== 'all-months' && fundedBy !== row.defaultFundedBy) {
    const household = tables.household.find((h) => !h.deletedAt)
    if (!household) throw new Error(txt.errors.noHouseholdYet)
    if (compareMonths(household.startMonth, scope.from) < 0) {
      const months = monthRange(household.startMonth, addMonths(scope.from, -1))
      const engine = computeEngine({ tables, months })
      for (const m of months) {
        const c = engine.cells[cellKey(row.id, m)]
        if (!c || (c.source !== 'value' && c.source !== 'inherit') || typedAmount(c) === 0) continue
        const existing = cellOf(tables, row.id, m)
        const item: CellItem = {
          id: newId(), label: '', amount: typedAmount(c), status: c.status === 'derived' ? row.defaultStatus : c.status, fundedBy: row.defaultFundedBy,
          date: null, note: null, recurringItemId: null, kind: 'normal', skipped: false,
        }
        mutations.push(cellPut(existing, { rowId: row.id, month: m, mode: 'items', value: null, items: [item] }, ts))
      }
    }
  }
  mutations.push({ op: 'put', table: 'rows', record: RowSchema.parse({ ...row, defaultFundedBy: fundedBy, updatedAt: ts }) })
  return mutations
}

/** Why a row has no amount of its own to mirror or replace, or null when it is an ordinary row. */
export function derivedRowReason(row: Row, closingRule: Household['closingRule']): string | null {
  if (row.kind === 'category-estimate') return txt.errors.estimateRest(row.name)
  const rule = row.rule ?? null
  if (canCarryRule(row) && isShareRule(rule)) {
    return txt.errors.workedOutByRule(row.name, sharePercent(row.ruleShare ?? 0), rule)
  }
  // the row that takes the rest (a transfer to any account), and under the first-savings-row default the idle ones
  // beside it; a savings row with a fixed amount is typed like any other
  const takesRest = closingRule === 'savings-plug' && ((canTakeRest(row) && rule === 'rest') || (row.kind === 'to-savings' && rule !== 'fixed'))
  if (takesRest) return txt.errors.workedOutFromRest(row.name)
  if (isOldPocketShare(row)) return txt.errors.oldPocketShare(row.name)
  return null
}

/** Make a row mirror another row's amount month by month (or a share of it, 0.25 for a quarter), or stop with `null`. The row's own cells are kept. */
export async function followRow(store: Store, rowId: string, targetId: string | null, share: number | null = null): Promise<void> {
  const tables = await loadTables(store)
  const row = tables.rows.find((r) => r.id === rowId && !r.deletedAt)
  if (!row) throw new Error(txt.errors.rowNotFound)
  if (targetId) {
    const household = tables.household.find((h) => !h.deletedAt)
    const rule = household?.closingRule ?? 'savings-plug'
    const own = derivedRowReason(row, rule)
    if (own) throw new Error(txt.errors.cannotFollowAnotherRow(own))
    if (targetId === rowId) throw new Error(txt.errors.rowCannotFollowItself)
    const target = tables.rows.find((r) => r.id === targetId && !r.deletedAt)
    if (!target) throw new Error(txt.errors.pickRowFollow)
    const why = derivedRowReason(target, rule)
    if (why) throw new Error(txt.errors.cannotBeFollowed(why))
    if (target.followsRowId) throw new Error(txt.errors.followsAnotherRowItselfFollow(target.name))
    if (target.archivedMonth) throw new Error(txt.errors.archived(target.name))
    if (tables.rows.some((r) => !r.deletedAt && r.followsRowId === rowId)) throw new Error(txt.errors.anotherRowAlreadyFollowsChains(row.name))
    if (share != null && !(share > 0)) throw new Error(txt.errors.shareMustAboveZeroLike)
  }
  // the whole amount is stored as null, so "= Salary" and "= 100% of Salary" are one state
  const followShare = targetId && share != null && share !== 1 ? share : null
  const mutations: Mutation[] = [{ op: 'put', table: 'rows', record: RowSchema.parse({ ...row, followsRowId: targetId, followShare, updatedAt: now() }) }]
  refuseThirdCurrency(tables, mutations)
  await store.commit(mutations)
}

/** The scope and tags a row gets when it belongs to `scope`: the person or thing it is scoped to is also among its tags, as templates do it. */
function scopePatch(row: Row, scope: string): Pick<Row, 'scope' | 'entityTags'> {
  const entityTags = row.entityTags.filter((t) => t !== row.scope)
  if (scope !== 'shared' && !entityTags.includes(scope)) entityTags.push(scope)
  return { scope, entityTags }
}

/**
 * Who a row belongs to: 'shared' or a person or thing. An income row takes the rows deducted from it along, since a
 * tax on one person's salary is that person's.
 */
export async function setRowScope(store: Store, rowId: string, scope: string): Promise<void> {
  const tables = await loadTables(store)
  const row = tables.rows.find((r) => r.id === rowId && !r.deletedAt)
  if (!row) throw new Error(txt.errors.rowNotFound)
  if (scope !== 'shared' && !tables.entities.some((e) => e.id === scope && !e.deletedAt)) throw new Error(txt.errors.personThingNoLongerExists)
  const ts = now()
  const mutations: Mutation[] = [{ op: 'put', table: 'rows', record: RowSchema.parse({ ...row, ...scopePatch(row, scope), updatedAt: ts }) }]
  if (row.section === 'income') {
    for (const d of tables.rows) if (!d.deletedAt && d.deductedFromRowId === row.id) mutations.push({ op: 'put', table: 'rows', record: RowSchema.parse({ ...d, ...scopePatch(d, scope), updatedAt: ts }) })
  }
  await store.commit(mutations)
}

/** Take a spending row out of an income row (tax, a pension contribution): the income's net is what its owner takes home. `null` undoes it. */
export async function setRowDeductedFrom(store: Store, rowId: string, incomeRowId: string | null): Promise<void> {
  const tables = await loadTables(store)
  const row = tables.rows.find((r) => r.id === rowId && !r.deletedAt)
  if (!row) throw new Error(txt.errors.rowNotFound)
  if (row.section !== 'expense') throw new Error(txt.errors.onlySpendingRowsDeductedIncome)
  let patch: Partial<Row> = { deductedFromRowId: null }
  if (incomeRowId) {
    const target = tables.rows.find((r) => r.id === incomeRowId && !r.deletedAt)
    if (!target || target.section !== 'income') throw new Error(txt.errors.pickIncomeRowDeduct)
    const why = derivedRowReason(target, tables.household.find((h) => !h.deletedAt)?.closingRule ?? 'savings-plug')
    if (why) throw new Error(txt.errors.nothingCanBeDeducted(why))
    if (target.archivedMonth) throw new Error(txt.errors.archived(target.name))
    patch = { deductedFromRowId: target.id, ...(target.scope !== 'shared' ? scopePatch(row, target.scope) : {}) }
  }
  await store.commit([{ op: 'put', table: 'rows', record: RowSchema.parse({ ...row, ...patch, updatedAt: now() }) }])
}

const ACCOUNT_TYPE_FOR_KIND: Partial<Record<RowKind, Account['type']>> = {
  'to-savings': 'savings', 'to-investment': 'investment', 'from-investment': 'investment', 'from-savings': 'savings', 'debt-payment': 'loan', 'card-payment': 'credit-card',
}

/**
 * The account type a row of this kind was made for, or null when any account (or none) will do. A row that pays a
 * debt off was made for a loan or for a card and can pay either (`fitsRow`).
 */
export function accountTypeForRow(row: Pick<Row, 'kind'>): Account['type'] | null {
  return ACCOUNT_TYPE_FOR_KIND[row.kind] ?? null
}

/** Whether a row of this kind can name the account: the type it was made for, and for a payment row any loan or card. */
export function fitsRow(row: Pick<Row, 'kind'>, account: Pick<Account, 'type'>): boolean {
  const need = accountTypeForRow(row)
  return !need || account.type === need || (isPayOffRow(row) && (account.type === 'loan' || account.type === 'credit-card'))
}

/**
 * Point a row at an account: destination for transfers, the card or loan it pays. An ordinary expense names none:
 * what is bought with a card is not said by the row (a payment method can say it), so the only thing left to do with
 * an account such a row still names, from an older version or for the overview, is to take it off.
 */
export async function setRowAccount(store: Store, rowId: string, accountId: string | null): Promise<void> {
  const tables = await loadTables(store)
  const row = tables.rows.find((r) => r.id === rowId && !r.deletedAt)
  if (!row) throw new Error(txt.errors.rowNotFound)
  const acc = checkAccountForRow(tables, row, accountId)
  if (acc && row.section === 'expense' && accountTypeForRow(row) == null && acc.id !== row.accountId) {
    throw new Error(txt.errors.expenseNamesNoAccount(row.name, acc.name))
  }
  // a payment row is stored with the kind of the account it pays: a loan's or a card's
  const fit = acc && isPayOffRow(row) ? payOffPatches(tables, [row], () => payOffKindOf(acc)).get(row.id) : undefined
  await updateRow(store, rowId, { accountId, ...fit })
}

/** The account a row may point at: it must exist, and a typed row (deposits, payments) needs the matching type. */
function checkAccountForRow(tables: Tables, row: Pick<Row, 'kind' | 'name'> & { section?: Row['section'] }, accountId: string | null): Account | null {
  const need = accountTypeForRow(row)
  const label = (t: Account['type']) => ACCOUNT_TYPE_INFO.find((i) => i.value === t)?.label ?? t
  if (!accountId) {
    if (need) throw new Error(txt.errors.needsAccountType(row.name, label(need)))
    return null
  }
  const acc = tables.accounts.find((a) => a.id === accountId && !a.deletedAt)
  if (!acc) throw new Error(txt.errors.accountNoLongerExists)
  if (acc.archivedMonth) throw new Error(txt.errors.archived(acc.name))
  if (need && !fitsRow(row, acc)) throw new Error(isPayOffRow(row) ? txt.errors.needsLoanOrCard(row.name, acc.name, label(acc.type)) : txt.errors.needsOtherType(row.name, label(need), acc.name, label(acc.type)))
  // a row that moves money sends it into the account it names, so only an account with a balance of its own can be named
  if (row.kind === 'plain' && row.section === 'transfer' && !holdsBalance(acc)) {
    throw new Error(txt.errors.noBalanceOwnMoneyGo(acc.name))
  }
  // pocket money is the adult's own: it lands only in an account that net worth leaves out, and one with a balance
  if (row.kind === 'pocket-money') {
    if (!isOutsideNetWorth(acc)) throw new Error(txt.errors.pocketMoneyOnlyLandAccount(acc.name))
    if (!ownBalance(acc)) throw new Error(txt.errors.noBalanceOwnPocketMoney(acc.name))
  }
  return acc
}
