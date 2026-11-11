import { cellKey, computeEngine } from '@/engine'
import {
  CellSchema, PoolSchema, addMonths, compareMonths, monthRange, newId, resolveRules,
  type Cell, type CellItem, type Money, type MonthKey, type Row, type Tables,
} from '@/model'
import type { Mutation, Store } from './store'
import { loadTables, newRowMutation } from './actions'
import { applyMutations } from './impact'

/**
 * Where a top-up comes from: an account (the unassigned part of a savings account, or an investment account), which
 * leaves a line under "Taken from accounts", or the month itself, which leaves less for the rest.
 */
export type TopUpSource = { kind: 'account'; accountId: string } | { kind: 'income' }

/**
 * Top a virtual account up for one month, with a record of where the money came from. Two one-off items, this month only:
 * "Top-up for <pool>" on the row that takes money out of the source account (made on first use), and "Top-up from
 * <account>" on the virtual account's own set-aside row. The month takes the money in and sets it aside again, so the
 * rest is untouched; from the month's income only the second is written, and the rest shrinks. Pure; the caller
 * commits, and the dialog runs it on a copy to show what the month will hold.
 */
export function topUpMutations(tables: Tables, poolId: string, month: MonthKey, source: TopUpSource, amount: Money, ts: number = Date.now()): Mutation[] {
  const household = tables.household.find((h) => !h.deletedAt)
  if (!household) throw new Error('No household yet')
  const base = household.baseCurrency
  const pool = tables.pools.find((p) => p.id === poolId && !p.deletedAt)
  if (!pool) throw new Error('That virtual account no longer exists.')
  if (pool.archivedMonth && compareMonths(pool.archivedMonth, month) <= 0) throw new Error(`"${pool.name}" is archived in ${month}.`)
  if (!Number.isFinite(amount) || !(amount > 0)) throw new Error('The top-up must be more than zero.')
  if (compareMonths(month, household.startMonth) < 0) throw new Error(`The household starts in ${household.startMonth}.`)
  if (tables.monthStates.find((s) => s.month === month)?.closed) throw new Error(`${month} is closed. Reopen it to edit.`)

  const mutations: Mutation[] = []
  let working = tables
  const add = (made: Mutation[]): void => {
    mutations.push(...made)
    working = applyMutations(working, made)
  }

  // the virtual account's own set-aside row; one that lost its row gets a new one
  let setAside = working.rows.find((r) => r.id === pool.allocationRowId && !r.deletedAt)
  if (!setAside) {
    const made = newRowMutation(working, { name: `${pool.name} pool`, section: 'transfer', kind: 'pool-allocation', accountId: pool.accountId, defaultStatus: 'committed', rule: 'fixed' })
    setAside = made.row
    add([made.mutation, { op: 'put', table: 'pools', record: PoolSchema.parse({ ...pool, allocationRowId: made.row.id, updatedAt: ts }) }])
  } else if (setAside.archivedMonth && compareMonths(setAside.archivedMonth, month) <= 0) {
    throw new Error(`"${setAside.name}" is archived in ${month}. Restore it first.`)
  }

  let from: Row | undefined
  let sourceName = 'this month\'s income'
  if (source.kind === 'account') {
    const acc = working.accounts.find((a) => a.id === source.accountId && !a.deletedAt)
    if (!acc) throw new Error('That account no longer exists.')
    if (acc.archivedMonth && compareMonths(acc.archivedMonth, month) <= 0) throw new Error(`"${acc.name}" is archived in ${month}.`)
    if (acc.type !== 'savings' && acc.type !== 'investment') throw new Error(`A top-up comes from a savings or an investment account, and "${acc.name}" is neither.`)
    const kind = acc.type === 'savings' ? 'from-savings' : 'from-investment'
    sourceName = acc.name
    // the row that takes money out of that account, kept in the household currency like the virtual account itself
    from = working.rows.find((r) => !r.deletedAt && !r.archivedMonth && r.kind === kind && r.accountId === acc.id && (r.currency ?? base) === base)
    if (!from) {
      const made = newRowMutation(working, { name: `From ${acc.name}`, section: 'transfer', kind, accountId: acc.id, defaultStatus: 'committed' })
      from = made.row
      add([made.mutation])
    }
  }

  const start = compareMonths(household.startMonth, month) < 0 ? household.startMonth : month
  const engine = computeEngine({ tables: working, months: monthRange(start, month) })
  const rules = resolveRules(engine.rows, household.closingRule)
  const put = (cell: Cell): Mutation => ({ op: 'put', table: 'cells', record: CellSchema.parse({ ...cell, updatedAt: ts }) })

  /** One more item on a row's month, with what the month showed kept as it was and the month after left alone. */
  const oneOff = (row: Row, label: string): Mutation[] => {
    const out: Mutation[] = []
    const current = engine.cells[cellKey(row.id, month)]
    const existing = working.cells.find((c) => c.rowId === row.id && c.month === month)
    const shown = current && current.source !== 'archived' && current.source !== 'empty' ? current.value : 0
    const item = (text: string, value: Money, status: CellItem['status']): CellItem =>
      ({ id: newId(), label: text, amount: value, status, fundedBy: row.defaultFundedBy, date: null, note: null, recurringItemId: null, kind: 'normal', skipped: false })
    // items already typed stay; a single amount (typed, carried or worked out by a rule) becomes the first item
    const kept: CellItem[] = existing?.mode === 'items' && current?.source === 'items'
      ? existing.items.map((it) => (it.kind === 'carry' ? { ...it, kind: 'normal' as const, amount: current.items.find((x) => x.id === it.id)?.effectiveAmount ?? it.amount } : it))
      : shown !== 0 ? [item('', shown, current?.status === 'done' ? 'done' : row.defaultStatus)] : []
    const currencyOverride = current && current.currency !== (row.currency ?? base) ? current.currency : existing?.currencyOverride ?? null
    out.push(put({ rowId: row.id, month, mode: 'items', value: null, items: [...kept, item(label, amount, row.defaultStatus)], note: existing?.note ?? null, currencyOverride, markedDone: existing?.markedDone ?? false, updatedAt: ts }))
    // The month after keeps what this month showed before the top-up. A rule fills its own months, and a scheduled row
    // never carries, so neither needs holding.
    if (!rules.byRow.has(row.id) && !engine.recurringRowIds.includes(row.id)) {
      const next = addMonths(month, 1)
      const nextCell = working.cells.find((c) => c.rowId === row.id && c.month === next)
      if (!nextCell || nextCell.mode === 'inherit') out.push(put({ rowId: row.id, month: next, mode: 'value', value: shown, items: [], note: nextCell?.note ?? null, currencyOverride, markedDone: nextCell?.markedDone ?? false, updatedAt: ts }))
    }
    return out
  }

  if (from) mutations.push(...oneOff(from, `Top-up for ${pool.name}`))
  mutations.push(...oneOff(setAside, `Top-up from ${sourceName}`))
  return mutations
}

/** Top a virtual account up for one month; one undoable step. */
export async function topUpPool(store: Store, poolId: string, month: MonthKey, source: TopUpSource, amount: Money): Promise<void> {
  await store.commit(topUpMutations(await loadTables(store), poolId, month, source, amount))
}
