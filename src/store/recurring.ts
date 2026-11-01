import {
  CellSchema, RecurringItemSchema, isDue, newId,
  type Cell, type CellItem, type MonthKey, type RecurringItem, type Row, type Tables,
} from '@/model'
import type { Mutation, Store } from './store'
import { loadTables } from './actions'

const now = () => Date.now()

function managedItem(item: RecurringItem, row: Row): CellItem {
  return {
    id: newId(), label: item.name, amount: item.amount, status: row.defaultStatus, fundedBy: item.fundedBy,
    date: null, note: null, recurringItemId: item.id, kind: 'normal', skipped: false,
  }
}

const sig = (items: CellItem[]) =>
  JSON.stringify([...items].sort((a, b) => (a.id < b.id ? -1 : 1)).map((i) => [i.id, i.label, i.amount, i.status, i.fundedBy, i.recurringItemId, i.kind, i.skipped]))

/**
 * Make every open month agree with the recurring register. Idempotent: running it
 * twice yields no mutations the second time. Closed months are never touched.
 * - due items missing from a cell are added as managed items
 * - managed items that are not done or skipped follow the register's amount, label and funding
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
            if (!i.recurringItemId || i.status === 'done' || i.skipped) return i
            const src = due.find((d) => d.id === i.recurringItemId)
            return src ? { ...i, label: src.name, amount: src.amount, fundedBy: src.fundedBy } : i
          })
      }
      for (const d of due) {
        if (!next.some((i) => i.recurringItemId === d.id)) next.push(managedItem(d, row))
      }
      if (!cell || cell.mode !== 'items') {
        if (next.length === 0) continue
        mutations.push({ op: 'put', table: 'cells', record: CellSchema.parse({ rowId, month: m, mode: 'items', value: null, items: next, note: cell?.note ?? null, currencyOverride: cell?.currencyOverride ?? null, updatedAt: now() }) })
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

export async function addRecurringItem(store: Store, input: Partial<RecurringInput> & Pick<RecurringInput, 'name' | 'rowId' | 'amount' | 'startMonth'>): Promise<RecurringItem> {
  const ts = now()
  const item = RecurringItemSchema.parse({ id: newId(), createdAt: ts, updatedAt: ts, ...input })
  await store.commit([{ op: 'put', table: 'recurringItems', record: item }])
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
  if (tables.monthStates.find((s) => s.month === month)?.closed) throw new Error(`${month} is closed. Reopen it to edit.`)
  const cell: Cell | undefined = tables.cells.find((c) => c.rowId === item.rowId && c.month === month)
  const items = cell?.mode === 'items' ? [...cell.items] : []
  const idx = items.findIndex((i) => i.recurringItemId === id)
  if (idx === -1) items.push({ ...managedItem(item, row), status: paid ? 'done' : row.defaultStatus })
  else items[idx] = { ...items[idx], status: paid ? 'done' : row.defaultStatus, skipped: false }
  await store.commit([{ op: 'put', table: 'cells', record: CellSchema.parse({ rowId: item.rowId, month, mode: 'items', value: null, items, note: cell?.note ?? null, currencyOverride: cell?.currencyOverride ?? null, updatedAt: now() }) }])
}

export type RecurringMonthStatus = 'not-due' | 'due' | 'paid' | 'skipped'

export function recurringStatus(tables: Tables, item: RecurringItem, month: MonthKey): RecurringMonthStatus {
  if (!isDue(item, month)) return 'not-due'
  const cell = tables.cells.find((c) => c.rowId === item.rowId && c.month === month)
  const posted = cell?.items.find((i) => i.recurringItemId === item.id)
  if (!posted) return 'due'
  if (posted.skipped) return 'skipped'
  return posted.status === 'done' ? 'paid' : 'due'
}
