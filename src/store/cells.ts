import { CellSchema, type Cell } from '@/model'
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

/** `cellRecord` as the put that stores it. */
export const cellPut = (existing: Cell | null | undefined, patch: CellPatch, ts: number): Mutation =>
  ({ op: 'put', table: 'cells', record: cellRecord(existing, patch, ts) })
