import { cellKey, computeEngine } from '@/engine'
import {
  CellSchema, RecurringItemSchema, addMonths, compareMonths, isDue, newId,
  type Cell, type CellItem, type MonthKey, type RecurringItem, type Row, type Tables,
} from '@/model'
import type { Mutation, Store } from './store'
import { loadTables } from './actions'
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
 * Make every open month agree with the recurring register. Idempotent: running it
 * twice yields no mutations the second time. Closed months are never touched.
 * - due items missing from a cell are added as managed items
 * - managed items that are not done, skipped or pinned follow the register's amount, label and funding
 * - managed items whose register entry is no longer due are removed unless done
 * - a plain value or carried-forward cell becomes an items cell; a bare value equal
 *   to a managed amount is treated as the same payment and dropped
 */
export function planRecurringPosts(tables: Tables, months: MonthKey[]): Mutation[] {
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
  const rowIds = new Set([...byRow.keys(), ...rowsWithManaged])
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
    if (!c || c.source !== 'inherit' || c.value === 0 || engine.totals[m]?.closed) continue
    out.push({ op: 'put', table: 'cells', record: CellSchema.parse({ rowId, month: m, mode: 'value', value: c.value, items: [], note: c.cell?.note ?? null, currencyOverride: c.cell?.currencyOverride ?? null, updatedAt: ts }) })
  }
  return out
}

export async function addRecurringItem(store: Store, input: Partial<RecurringInput> & Pick<RecurringInput, 'name' | 'rowId' | 'amount' | 'startMonth'>): Promise<RecurringItem> {
  const ts = now()
  const item = RecurringItemSchema.parse({ id: newId(), createdAt: ts, updatedAt: ts, ...input })
  const tables = await loadTables(store)
  await store.commit([...pinCarriedMonths(tables, item.rowId, item.startMonth, ts), { op: 'put', table: 'recurringItems', record: item }])
  return item
}

export async function updateRecurringItem(store: Store, id: string, patch: Partial<RecurringInput>): Promise<void> {
  const tables = await loadTables(store)
  const item = tables.recurringItems.find((r) => r.id === id)
  if (!item) throw new Error('Recurring item not found')
  await store.commit([{ op: 'put', table: 'recurringItems', record: RecurringItemSchema.parse({ ...item, ...patch, updatedAt: now() }) }])
}

/** Stop an item after `endMonth` (null = active again). */
export const endRecurringItem = (store: Store, id: string, endMonth: MonthKey | null) => updateRecurringItem(store, id, { endMonth })
export const deleteRecurringItem = (store: Store, id: string) => updateRecurringItem(store, id, { deletedAt: now() } as Partial<RecurringInput>)

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
 * items from `month` on are re-pointed to the copy so paid marks survive and nothing posts twice.
 * Returns the id of the schedule that now covers `month`.
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
        : i.pinned ? { ...i, recurringItemId: targetId }
        : { ...i, recurringItemId: targetId, amount: patch.amount ?? i.amount, fundedBy: patch.fundedBy ?? i.fundedBy, label: patch.name ?? i.label },
    )
    mutations.push({ op: 'put', table: 'cells', record: CellSchema.parse({ ...cell, items, updatedAt: ts }) })
  }
  return { mutations, targetId }
}
