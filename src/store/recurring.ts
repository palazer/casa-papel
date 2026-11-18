import { cellKey, computeEngine, typedAmount } from '@/engine'
import {
  CellSchema, RecurringItemSchema, addMonths, compareMonths, isDue, monthOfDate, newId,
  type Cell, type CellItem, type MonthKey, type RecurringItem, type Row, type Tables,
} from '@/model'
import type { Mutation, Store } from './store'
import { loadTables, newRowMutation } from './actions'
import { applyMutations, monthSpan } from './impact'
import { defaultMonths } from './months'

const now = () => Date.now()

/** The item a schedule posts into a month it lands in. */
export function managedItem(item: RecurringItem, row: Row): CellItem {
  return {
    id: newId(), label: item.name, amount: item.amount, status: row.defaultStatus, fundedBy: item.fundedBy,
    date: null, note: null, recurringItemId: item.id, kind: 'normal', skipped: false,
  }
}

const sig = (items: CellItem[]) =>
  JSON.stringify([...items].sort((a, b) => (a.id < b.id ? -1 : 1)).map((i) => [i.id, i.label, i.amount, i.status, i.fundedBy, i.recurringItemId, i.kind, i.skipped, i.pinned ?? false]))

/**
 * Make the given months agree with the recurring register. Idempotent: running it
 * twice yields no mutations the second time. Closed months are never touched.
 * - due items missing from a cell are added as managed items
 * - managed items that are not done, skipped or pinned follow the register's amount, label and funding
 * - managed items whose register entry is no longer due are removed unless done
 * - a plain value or carried-forward cell becomes an items cell; a bare value equal
 *   to a managed amount is treated as the same payment and dropped
 *
 * The caller says where: the months, and with `only` the rows. A change lands in the months it speaks of and in the
 * rows it touched; nothing else is looked at, so a month nobody named keeps what it holds, whatever the register says.
 */
export function planRecurringPosts(tables: Tables, months: MonthKey[], only?: Iterable<string>): Mutation[] {
  const closed = new Set(tables.monthStates.filter((s) => s.closed).map((s) => s.month))
  const items = tables.recurringItems.filter((r) => !r.deletedAt)
  const rowsById = new Map(tables.rows.filter((r) => !r.deletedAt).map((r) => [r.id, r]))
  const byRow = new Map<string, RecurringItem[]>()
  for (const it of items) {
    if (!rowsById.has(it.rowId)) continue
    const list = byRow.get(it.rowId) ?? []
    list.push(it)
    byRow.set(it.rowId, list)
  }
  // rows that ever had managed items also need cleanup when their register entries are deleted
  const rowsWithManaged = new Set(tables.cells.filter((c) => c.items.some((i) => i.recurringItemId)).map((c) => c.rowId))
  const wanted = only ? new Set(only) : null
  const rowIds = new Set([...byRow.keys(), ...rowsWithManaged].filter((id) => !wanted || wanted.has(id)))
  const cellsByKey = new Map(tables.cells.map((c) => [`${c.rowId}|${c.month}`, c]))
  const liveIds = new Set(items.map((i) => i.id))
  const mutations: Mutation[] = []

  for (const m of months) {
    if (closed.has(m)) continue
    for (const rowId of rowIds) {
      const row = rowsById.get(rowId)
      if (!row) continue
      const due = (byRow.get(rowId) ?? []).filter((it) => isDue(it, m))
      const cell = cellsByKey.get(`${rowId}|${m}`)
      let next: CellItem[]
      if (!cell || cell.mode === 'inherit') {
        next = []
      } else if (cell.mode === 'value') {
        const v = cell.value ?? 0
        next = v !== 0 && !due.some((d) => d.amount === v)
          ? [{ id: newId(), label: '', amount: v, status: row.defaultStatus, fundedBy: row.defaultFundedBy, date: null, note: null, recurringItemId: null, kind: 'normal', skipped: false }]
          : []
      } else {
        next = cell.items
          .filter((i) => {
            if (!i.recurringItemId) return true
            if (i.status === 'done') return true
            const stillDue = due.some((d) => d.id === i.recurringItemId)
            return stillDue && liveIds.has(i.recurringItemId)
          })
          .map((i) => {
            if (!i.recurringItemId || i.status === 'done' || i.skipped || i.pinned) return i
            const src = due.find((d) => d.id === i.recurringItemId)
            return src ? { ...i, label: src.name, amount: src.amount, fundedBy: src.fundedBy } : i
          })
      }
      for (const d of due) {
        if (!next.some((i) => i.recurringItemId === d.id)) next.push(managedItem(d, row))
      }
      if (!cell || cell.mode !== 'items') {
        if (next.length === 0) continue
        mutations.push({ op: 'put', table: 'cells', record: CellSchema.parse({ rowId, month: m, mode: 'items', value: null, items: next, note: cell?.note ?? null, currencyOverride: cell?.currencyOverride ?? null, markedDone: cell?.markedDone ?? false, updatedAt: now() }) })
      } else if (sig(next) !== sig(cell.items)) {
        mutations.push({ op: 'put', table: 'cells', record: CellSchema.parse({ ...cell, items: next, updatedAt: now() }) })
      }
    }
  }
  return mutations
}

/** Apply the plan as a system commit (not undoable). Returns how many cells changed. */
export async function postRecurring(store: Store, months: MonthKey[]): Promise<number> {
  const tables = await loadTables(store)
  const mutations = planRecurringPosts(tables, months)
  if (mutations.length) await store.commitSystem(mutations)
  return mutations.length
}

/**
 * What the app does by itself whenever it has the data in front of it: the schedules land in the current month and in
 * the months after it. A month that is over is left alone: the app never changes the past by itself, and whatever
 * reaches further back is somebody's own step, saved with its months. Pure, and idempotent like the poster.
 */
export function planHousekeeping(tables: Tables, today: MonthKey = monthOfDate()): Mutation[] {
  const household = tables.household.find((h) => !h.deletedAt)
  if (!household) return []
  return planRecurringPosts(tables, defaultMonths(household, tables, today).filter((m) => compareMonths(m, today) >= 0))
}

/** `planHousekeeping` as a system commit (not undoable). Returns how many records it wrote. */
export async function keepHouse(store: Store, today: MonthKey = monthOfDate()): Promise<number> {
  const mutations = planHousekeeping(await loadTables(store), today)
  if (mutations.length) await store.commitSystem(mutations)
  return mutations.length
}

export type RecurringInput = Omit<RecurringItem, 'id' | 'createdAt' | 'updatedAt' | 'deletedAt'>

/**
 * A row that gets its first schedule stops carrying its amount forward, in every month. The open months before
 * `before` that only carried an amount keep it: it is written into them, the way closing a month writes it down.
 * Nothing to do for a row that is on a schedule already.
 */
export function pinCarriedMonths(tables: Tables, rowId: string, before: MonthKey, ts: number): Mutation[] {
  if (tables.recurringItems.some((r) => !r.deletedAt && r.rowId === rowId)) return []
  const household = tables.household.find((h) => !h.deletedAt)
  if (!household) return []
  const months = defaultMonths(household, tables).filter((m) => compareMonths(m, before) < 0)
  if (months.length === 0) return []
  const engine = computeEngine({ tables, months })
  const out: Mutation[] = []
  for (const m of months) {
    const c = engine.cells[cellKey(rowId, m)]
    if (!c || c.source !== 'inherit' || typedAmount(c) === 0 || engine.totals[m]?.closed) continue
    out.push({ op: 'put', table: 'cells', record: CellSchema.parse({ rowId, month: m, mode: 'value', value: typedAmount(c), items: [], note: c.cell?.note ?? null, currencyOverride: c.cell?.currencyOverride ?? null, updatedAt: ts }) })
  }
  return out
}

/**
 * A change to schedules, with what it lands in the months of the rows it touches. Saved together they are one step:
 * one undo takes the schedule and its months back. Left to the app's own pass afterwards, the months would be a
 * second step that undo does not reach, and the rows would be left with what that pass made of them. `where` says
 * which months the change speaks of; the current month and the ones after it are always landed, as that pass would.
 */
function withPosts(tables: Tables, mutations: Mutation[], rowIds: string[], where: (m: MonthKey) => boolean = () => true): Mutation[] {
  const after = applyMutations(tables, mutations)
  const household = after.household.find((h) => !h.deletedAt)
  if (!household) return mutations
  const today = monthOfDate()
  const months = defaultMonths(household, after).filter((m) => compareMonths(m, today) >= 0 || where(m))
  return [...mutations, ...planRecurringPosts(after, months, rowIds)]
}

/** A row that a schedule's form makes together with the schedule. */
export type RecurringNewRow = Partial<Row> & { name: string; section: Row['section'] }

/**
 * Add a schedule to a row. With `newRow` the row is made in the same step, and `input.rowId` is not read: the form
 * that offers "New row…" saves the row, the schedule and its months as one thing. It lands from its first month on,
 * also where that month is over: the start is a month somebody typed.
 */
export async function addRecurringItem(
  store: Store, input: Partial<RecurringInput> & Pick<RecurringInput, 'name' | 'rowId' | 'amount' | 'startMonth'>, newRow?: RecurringNewRow,
): Promise<RecurringItem> {
  const ts = now()
  const tables = await loadTables(store)
  const mutations: Mutation[] = []
  let rowId = input.rowId
  if (newRow) {
    const made = newRowMutation(tables, newRow)
    mutations.push(made.mutation)
    rowId = made.row.id
  }
  const item = RecurringItemSchema.parse({ id: newId(), createdAt: ts, updatedAt: ts, ...input, rowId })
  // a row that is made here has carried nothing yet, so there is nothing of it to write down
  if (!newRow) mutations.push(...pinCarriedMonths(tables, item.rowId, item.startMonth, ts))
  mutations.push({ op: 'put', table: 'recurringItems', record: item })
  await store.commit(withPosts(tables, mutations, [item.rowId], (m) => compareMonths(m, item.startMonth) >= 0))
  return item
}

/**
 * Another name for something that repeats. It is the same thing under a better name, not a change from a month on:
 * every schedule of the row that carried the old name takes the new one (a rhythm changed earlier left one behind for
 * the months before), and so do the items they posted in the open months, done or not. Closed months keep what they show.
 */
export function planRename(tables: Tables, rowId: string, from: string, to: string, ts: number): Mutation[] {
  const closed = new Set(tables.monthStates.filter((s) => s.closed).map((s) => s.month))
  const renamed = tables.recurringItems.filter((r) => !r.deletedAt && r.rowId === rowId && r.name === from)
  const ids = new Set(renamed.map((r) => r.id))
  const posted = (i: CellItem) => !!i.recurringItemId && ids.has(i.recurringItemId)
  const muts: Mutation[] = renamed.map((r) => ({ op: 'put', table: 'recurringItems', record: RecurringItemSchema.parse({ ...r, name: to, updatedAt: ts }) }))
  for (const c of tables.cells) {
    if (c.rowId !== rowId || closed.has(c.month) || !c.items.some((i) => posted(i) && i.label !== to)) continue
    muts.push({ op: 'put', table: 'cells', record: CellSchema.parse({ ...c, items: c.items.map((i) => (posted(i) ? { ...i, label: to } : i)), updatedAt: ts }) })
  }
  return muts
}

/** What a schedule's months show: what it posts and how often. A change to one of these counts from a month on. */
const sameValues = (a: RecurringItem, b: RecurringItem): boolean =>
  a.rowId === b.rowId && a.amount === b.amount && a.fundedBy === b.fundedBy && a.currency === b.currency
  && JSON.stringify(a.cadence ?? null) === JSON.stringify(b.cadence ?? null)
  && JSON.stringify([...(a.dueMonths ?? [])].sort()) === JSON.stringify([...(b.dueMonths ?? [])].sort())

const isBefore = (a: MonthKey, b: MonthKey) => compareMonths(a, b) < 0
/** The months that lie between two months, the earlier one included: where a moved start changes what is due. */
const between = (a: MonthKey, b: MonthKey) => (m: MonthKey) => compareMonths(m, isBefore(a, b) ? a : b) >= 0 && isBefore(m, isBefore(a, b) ? b : a)
/** The months after the earlier of two last months, up to the later one (no last month: without limit): where a moved end changes what is due. */
const afterMovedEnd = (was: MonthKey | null, now: MonthKey | null) => (m: MonthKey): boolean => {
  if (was === now) return false
  const first = was == null ? now! : now == null ? was : isBefore(was, now) ? was : now
  const last = was == null || now == null ? null : isBefore(was, now) ? now : was
  return compareMonths(m, first) > 0 && (last == null || compareMonths(m, last) <= 0)
}

/**
 * Change a schedule from the list of schedules; with `newRow` it moves to a row that is made in the same step.
 *
 * The form names no month for what the schedule posts, so a new amount, source, rhythm or row counts from the current
 * month on: the schedule is split there, as the row's dialog splits it "from this month on", and the months before
 * keep what they show. A first or a last month is a month somebody typed and is applied as typed: the months between
 * the old one and the new one are filled or emptied. Its name, account, owner and notes are the schedule's own and
 * change in every month.
 *
 * A schedule that ended before the current month has no month left to change from here on: with a last month in
 * the current month or later (or none) it runs again from the current month, with what the form says; otherwise the
 * change is refused, and says where an amount of a month that is over is changed.
 */
export async function updateRecurringItem(store: Store, id: string, patch: Partial<RecurringInput>, newRow?: RecurringNewRow): Promise<void> {
  const tables = await loadTables(store)
  const item = tables.recurringItems.find((r) => r.id === id)
  if (!item) throw new Error('Recurring item not found')
  const ts = now()
  const today = monthOfDate()
  const mutations: Mutation[] = []
  let work = tables
  const push = (ms: Mutation[]) => {
    mutations.push(...ms)
    work = applyMutations(work, ms)
  }
  const putItem = (record: RecurringItem) => push([{ op: 'put', table: 'recurringItems', record: RecurringItemSchema.parse({ ...record, updatedAt: ts }) }])
  let next: RecurringItem = { ...item, ...patch }
  if (newRow) {
    const made = newRowMutation(tables, newRow)
    push([made.mutation])
    next = { ...next, rowId: made.row.id }
  }
  const rows = [...new Set([item.rowId, next.rowId])]
  const start = next.startMonth
  const end = next.endMonth ?? null
  const startMoved = between(item.startMonth, start)
  const ended = item.endMonth != null && isBefore(item.endMonth, today)
  const runsOn = end == null || !isBefore(end, today)

  // the name is the schedule's own, in every month: what it posted takes it too
  if (next.name !== item.name) push(planRename(work, item.rowId, item.name, next.name, ts))

  if (ended && runsOn) {
    // it ended in a month that is over and is given a later end, or none: it runs again from the current month
    push(planReactivate(work, { ...next, endMonth: item.endMonth }, today, end, ts))
    await store.commit(withPosts(tables, mutations, rows, startMoved))
    return
  }
  if (sameValues(item, next) || !isBefore(start, today)) {
    // nothing it posts changes, or all of it lies in the current month and later: the schedule as the form has it
    putItem(next)
    await store.commit(withPosts(tables, mutations, rows, (m) => startMoved(m) || afterMovedEnd(item.endMonth ?? null, end)(m)))
    return
  }
  if (!runsOn) {
    const locale = tables.household.find((h) => !h.deletedAt)?.locale ?? 'en'
    throw new Error(`"${item.name}" ${ended ? 'ended' : 'would end'} in ${monthSpan([end!], locale)}, and a change made here counts from ${monthSpan([today], locale)} on. Change the amount of a month that is over in that month, or give the schedule a later last month to run it again.`)
  }
  // it runs through the current month: the months before keep what it posted, a copy with the new values starts here
  const kept: RecurringItem = { ...item, name: next.name, accountId: next.accountId, scope: next.scope, notes: next.notes, startMonth: start }
  putItem(kept)
  const split = planChangeRecurringFrom(work, { ...kept, updatedAt: ts }, today, { amount: next.amount, fundedBy: next.fundedBy, cadence: next.cadence, dueMonths: next.dueMonths, endMonth: end }, ts)
  push(split.mutations)
  if (next.rowId !== item.rowId || next.currency !== item.currency) {
    const copy = work.recurringItems.find((r) => r.id === split.targetId)!
    putItem({ ...copy, rowId: next.rowId, currency: next.currency })
  }
  await store.commit(withPosts(tables, mutations, rows, startMoved))
}

/**
 * A schedule that has ended runs again from `today`, until `end` (none: without an end). One that ended last month
 * or later simply loses its end. One that ended further back keeps its months as they are: a copy starts at
 * `today`, so the months in between, which are over, get nothing they did not have.
 */
function planReactivate(tables: Tables, item: RecurringItem, today: MonthKey, end: MonthKey | null, ts: number): Mutation[] {
  const put = (record: RecurringItem): Mutation => ({ op: 'put', table: 'recurringItems', record: RecurringItemSchema.parse({ ...record, updatedAt: ts }) })
  const stored = tables.recurringItems.find((r) => r.id === item.id)
  const gap = item.endMonth != null && isBefore(item.endMonth, addMonths(today, -1))
  if (!gap) return [put({ ...item, endMonth: end })]
  // the piece that ended keeps what it posted; only what is the schedule's own in every month follows the form
  const kept = stored ? [put({ ...stored, name: item.name, accountId: item.accountId, scope: item.scope, notes: item.notes })] : []
  return [...kept, put({ ...item, id: newId(), createdAt: ts, startMonth: today, endMonth: end })]
}

/** "Reactivate" in the list of schedules: the schedule runs again from the current month, without an end. */
export async function reactivateRecurringItem(store: Store, id: string): Promise<void> {
  const tables = await loadTables(store)
  const item = tables.recurringItems.find((r) => r.id === id && !r.deletedAt)
  if (!item) throw new Error('Recurring item not found')
  if (item.endMonth == null) return
  await store.commit(withPosts(tables, planReactivate(tables, item, monthOfDate(), null, now()), [item.rowId]))
}

/**
 * What takes a schedule away: its record, and what it posted and was not paid. Nothing else in its months is looked
 * at. Closed months keep what they show.
 */
export function planDropSchedule(tables: Tables, item: RecurringItem, ts: number): Mutation[] {
  const closed = new Set(tables.monthStates.filter((s) => s.closed).map((s) => s.month))
  const muts: Mutation[] = [{ op: 'put', table: 'recurringItems', record: RecurringItemSchema.parse({ ...item, deletedAt: ts, updatedAt: ts }) }]
  for (const c of tables.cells) {
    if (c.rowId !== item.rowId || closed.has(c.month)) continue
    if (!c.items.some((i) => i.recurringItemId === item.id && i.status !== 'done')) continue
    muts.push({ op: 'put', table: 'cells', record: CellSchema.parse({ ...c, items: c.items.filter((i) => i.recurringItemId !== item.id || i.status === 'done'), updatedAt: ts }) })
  }
  return muts
}

/** Stop a schedule after `endMonth`: the month is one somebody chose, so what it posted after it and was not paid goes. */
export const endRecurringItem = (store: Store, id: string, endMonth: MonthKey) => updateRecurringItem(store, id, { endMonth })

export async function deleteRecurringItem(store: Store, id: string): Promise<void> {
  const tables = await loadTables(store)
  const item = tables.recurringItems.find((r) => r.id === id)
  if (!item) throw new Error('Recurring item not found')
  await store.commit(planDropSchedule(tables, item, now()))
}

/** Mark the posted item for `month` paid (done) or back to the row default. */
export async function setRecurringPaid(store: Store, id: string, month: MonthKey, paid: boolean): Promise<void> {
  const tables = await loadTables(store)
  const item = tables.recurringItems.find((r) => r.id === id)
  if (!item) throw new Error('Recurring item not found')
  const row = tables.rows.find((r) => r.id === item.rowId)
  if (!row) throw new Error('Row not found')
  if (!scheduleLive(tables, item, month)) throw new Error(`"${row.name}" is archived in ${month}.`)
  if (tables.monthStates.find((s) => s.month === month)?.closed) throw new Error(`${month} is closed. Reopen it to edit.`)
  const cell: Cell | undefined = tables.cells.find((c) => c.rowId === item.rowId && c.month === month)
  const items = cell?.mode === 'items' ? [...cell.items] : []
  const idx = items.findIndex((i) => i.recurringItemId === id)
  if (idx === -1) items.push({ ...managedItem(item, row), status: paid ? 'done' : row.defaultStatus })
  else items[idx] = { ...items[idx], status: paid ? 'done' : row.defaultStatus, skipped: false }
  await store.commit([{ op: 'put', table: 'cells', record: CellSchema.parse({ rowId: item.rowId, month, mode: 'items', value: null, items, note: cell?.note ?? null, currencyOverride: cell?.currencyOverride ?? null, markedDone: cell?.markedDone ?? false, updatedAt: now() }) }])
}

export type RecurringMonthStatus = 'not-due' | 'due' | 'paid' | 'skipped'

/** A schedule counts in `month` only while it and its row are there: neither removed nor archived by then. */
export function scheduleLive(tables: Tables, item: RecurringItem, month: MonthKey): boolean {
  if (item.deletedAt) return false
  const row = tables.rows.find((r) => r.id === item.rowId)
  return !!row && !row.deletedAt && !(row.archivedMonth && compareMonths(month, row.archivedMonth) >= 0)
}

export function recurringStatus(tables: Tables, item: RecurringItem, month: MonthKey): RecurringMonthStatus {
  if (!scheduleLive(tables, item, month) || !isDue(item, month)) return 'not-due'
  const cell = tables.cells.find((c) => c.rowId === item.rowId && c.month === month)
  const posted = cell?.items.find((i) => i.recurringItemId === item.id)
  if (!posted) return 'due'
  if (posted.skipped) return 'skipped'
  return posted.status === 'done' ? 'paid' : 'due'
}

// ---- grid-side management: the cell editor asks "only this month / from now on / all", these do the work ----

async function findLive(store: Store, id: string) {
  const tables = await loadTables(store)
  const item = tables.recurringItems.find((r) => r.id === id && !r.deletedAt)
  if (!item) throw new Error('Recurring item not found')
  return { tables, item }
}

/** Skip (or restore) one posted occurrence. The schedule keeps running in other months. */
export async function skipRecurringMonth(store: Store, id: string, month: MonthKey, skipped: boolean): Promise<void> {
  const { tables, item } = await findLive(store, id)
  if (tables.monthStates.some((s) => s.month === month && s.closed)) throw new Error('Month is closed')
  const cell = tables.cells.find((c) => c.rowId === item.rowId && c.month === month)
  if (!cell) return
  const items = cell.items.map((i) => (i.recurringItemId === id ? { ...i, skipped } : i))
  await store.commit([{ op: 'put', table: 'cells', record: CellSchema.parse({ ...cell, items, updatedAt: now() }) }])
}

/** Stop the schedule from `month` on. Earlier months keep what was posted. */
export async function endRecurringFrom(store: Store, id: string, month: MonthKey): Promise<void> {
  const { item } = await findLive(store, id)
  if (compareMonths(month, item.startMonth) <= 0) return deleteRecurringItem(store, id)
  return endRecurringItem(store, id, addMonths(month, -1))
}

/** What a schedule can be given from a month on: another amount, source or name, or another rhythm. */
export type SchedulePatch = Partial<Pick<RecurringItem, 'amount' | 'fundedBy' | 'name' | 'cadence' | 'dueMonths' | 'endMonth'>>

/**
 * Change amount/funding/name or the rhythm from `month` on. Earlier months keep the old values: the old
 * schedule ends the month before and a copy with the new values starts at `month`. Posted
 * items from `month` on are re-pointed to the copy so paid marks survive and nothing posts twice; what is paid
 * keeps the amount that was paid. Returns the id of the schedule that now covers `month`.
 */
export async function changeRecurringFrom(store: Store, id: string, month: MonthKey, patch: SchedulePatch): Promise<string> {
  const { tables, item } = await findLive(store, id)
  const { mutations, targetId } = planChangeRecurringFrom(tables, item, month, patch, now())
  await store.commit(mutations)
  return targetId
}

/** The mutations behind `changeRecurringFrom`; archiving a virtual account uses them to move its schedules to savings. */
export function planChangeRecurringFrom(tables: Tables, item: RecurringItem, month: MonthKey, patch: SchedulePatch, ts: number): { mutations: Mutation[]; targetId: string } {
  const mutations: Mutation[] = []
  let targetId = item.id
  if (compareMonths(month, item.startMonth) <= 0) {
    mutations.push({ op: 'put', table: 'recurringItems', record: RecurringItemSchema.parse({ ...item, ...patch, updatedAt: ts }) })
  } else {
    const fresh = RecurringItemSchema.parse({ ...item, ...patch, id: newId(), createdAt: ts, updatedAt: ts, startMonth: month, endMonth: patch.endMonth !== undefined ? patch.endMonth : item.endMonth })
    targetId = fresh.id
    mutations.push({ op: 'put', table: 'recurringItems', record: RecurringItemSchema.parse({ ...item, endMonth: addMonths(month, -1), updatedAt: ts }) })
    mutations.push({ op: 'put', table: 'recurringItems', record: fresh })
  }
  const closed = new Set(tables.monthStates.filter((s) => s.closed).map((s) => s.month))
  for (const cell of tables.cells) {
    if (cell.rowId !== item.rowId || compareMonths(cell.month, month) < 0 || closed.has(cell.month)) continue
    if (!cell.items.some((i) => i.recurringItemId === item.id)) continue
    const items = cell.items.map((i) =>
      i.recurringItemId !== item.id ? i
        : i.pinned || i.status === 'done' ? { ...i, recurringItemId: targetId }
        : { ...i, recurringItemId: targetId, amount: patch.amount ?? i.amount, fundedBy: patch.fundedBy ?? i.fundedBy, label: patch.name ?? i.label },
    )
    mutations.push({ op: 'put', table: 'cells', record: CellSchema.parse({ ...cell, items, updatedAt: ts }) })
  }
  return { mutations, targetId }
}
