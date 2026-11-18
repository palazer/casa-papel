import type { CellResult } from '@/engine'
import { CellSchema, newId, type Cell, type CellItem, type FundedBy, type Row } from '@/model'
import type { Mutation } from './store'

/** What a writer says about a month: its row and month, and the fields it means to change. */
export type CellPatch = Pick<Cell, 'rowId' | 'month'> & Partial<Omit<Cell, 'rowId' | 'month' | 'updatedAt'>>

/**
 * A month's record as it goes back into the store: what is stored for it, with `patch` on top, stamped `ts`. Whoever
 * rebuilds a month builds it here, so that what the writer does not name stays as it is: the note, the month's own
 * currency, the tick on an automatic amount, and above all the mark of an amount that is this month's alone
 * (`once`). A writer that lost that mark would turn an exception into an amount that runs on, silently. A month that
 * goes back to inheriting has no amount of its own, so it loses the mark by itself.
 */
export function cellRecord(existing: Cell | null | undefined, patch: CellPatch, ts: number): Cell {
  const next = CellSchema.parse({ ...(existing ?? {}), ...patch, updatedAt: ts })
  return next.mode === 'inherit' && next.once ? { ...next, once: false } : next
}

/**
 * A worked-out month written down as the row's own (a row that stops following another, one a rule takes over): what
 * it showed, as the fields that store it. An amount ticked as moved keeps its tick as a done item. Parts whose
 * conversion was recorded (rule X10) are written as done items that carry it, so the month counts as it did; the rest
 * is one more item beside them, as sure as the row usually is.
 */
export function writtenDown(c: CellResult, fundedBy: FundedBy, status: Row['defaultStatus']): Pick<CellPatch, 'mode' | 'value' | 'items'> {
  const moved = c.status === 'done' && c.value !== 0
  const item = (amount: number, over: Partial<CellItem> = {}): CellItem =>
    ({ id: newId(), label: '', amount, status: 'done', fundedBy, date: null, note: null, recurringItemId: null, kind: 'normal', skipped: false, ...over })
  if (!c.recorded) return moved ? { mode: 'items', value: null, items: [item(c.value)] } : { mode: 'value', value: c.value, items: [] }
  const items = c.recorded.map((p) => item(p.amount, { fundedBy: p.source, conversion: p.conversion }))
  const rest = c.value - c.recorded.reduce((sum, p) => sum + p.amount, 0)
  if (rest !== 0) items.push(item(rest, { status: moved ? 'done' : status }))
  return { mode: 'items', value: null, items }
}

/** `cellRecord` as the put that stores it. */
export const cellPut = (existing: Cell | null | undefined, patch: CellPatch, ts: number): Mutation =>
  ({ op: 'put', table: 'cells', record: cellRecord(existing, patch, ts) })
