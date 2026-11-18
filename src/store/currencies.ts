import { thirdCurrency } from '@/engine'
import type { Tables } from '@/model'
import { applyMutations } from './impact'
import type { Mutation } from './store'

/**
 * Rule X15 for the writers: a change that would make an amount count across three currencies is refused, with the
 * sentence `thirdCurrency` writes. The writers that can name a currency, an account or a source ask before they
 * commit; what is stored already is never refused by a change that adds no currency to it.
 */

/** The rows whose amounts `mutations` can change the currencies of: the rows they write, every row once an account or
 * a virtual account changes, and the rows that follow any of them. */
function rowsConcerned(after: Tables, mutations: Mutation[]): Set<string> {
  const ids = new Set<string>()
  let everyRow = false
  for (const m of mutations) {
    if (m.op !== 'put') continue
    if (m.table === 'rows') ids.add(m.record.id)
    else if (m.table === 'cells' || m.table === 'recurringItems') ids.add(m.record.rowId)
    else if (m.table === 'accounts' || m.table === 'pools') everyRow = true
  }
  if (everyRow) for (const r of after.rows) ids.add(r.id)
  // a row that follows another is in that row's currency
  for (let grew = true; grew;) {
    grew = false
    for (const r of after.rows) {
      if (r.followsRowId && ids.has(r.followsRowId) && !ids.has(r.id)) {
        ids.add(r.id)
        grew = true
      }
    }
  }
  return ids
}

/** Why `mutations` would make an amount count across three currencies, or null; the dialogs ask it on the spot. */
export function thirdCurrencyReason(before: Tables, mutations: Mutation[]): string | null {
  // only the months the change writes are applied one by one; the others are taken over as they are
  const written = new Set<string>()
  for (const m of mutations) {
    if (m.table !== 'cells') continue
    written.add(m.op === 'put' ? m.record.rowId : String((m.key as unknown[])[0]))
  }
  const changed = applyMutations({ ...before, cells: before.cells.filter((c) => written.has(c.rowId)) }, mutations)
  const after: Tables = { ...changed, cells: [...before.cells.filter((c) => !written.has(c.rowId)), ...changed.cells] }
  return thirdCurrency(before, after, rowsConcerned(after, mutations))
}

/** Throws the sentence of `thirdCurrencyReason`, for a writer about to commit `mutations`. */
export function refuseThirdCurrency(before: Tables, mutations: Mutation[]): void {
  const reason = thirdCurrencyReason(before, mutations)
  if (reason) throw new Error(reason)
}
