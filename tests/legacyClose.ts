import { cellKey, computeEngine, typedAmount, type EngineOutput } from '@/engine'
import { CellSchema, MonthStateSchema, monthRange, type Household, type MonthKey, type Tables } from '@/model'
import { loadTables, type Mutation, type Store } from '@/store'

/**
 * What the app wrote when a month was closed, before schema 15: `closeMonthMutations` of that time, kept here so the
 * one-time opening of such months (`planHousekeeping`) is tested against data of exactly that shape. An amount the
 * month only carried was written down as typed, every item was ticked, and the month's record got the mark and kept
 * its cash buffer. What the app worked out (a rule, the rest, a follower) was left alone and only read as done.
 */
export function legacyCloseMutations(tables: Tables, engine: EngineOutput, household: Household, month: MonthKey, at: number): Mutation[] {
  const mutations: Mutation[] = []
  for (const row of engine.rows) {
    const c = engine.cells[cellKey(row.id, month)]
    if (!c || c.source === 'derived' || c.source === 'archived' || c.source === 'empty') continue
    if (c.source === 'inherit') {
      mutations.push({ op: 'put', table: 'cells', record: CellSchema.parse({ rowId: row.id, month, mode: 'value', value: typedAmount(c), items: [], note: null, currencyOverride: null, updatedAt: at }) })
    } else if (c.source === 'items' && c.cell && c.cell.items.some((it) => it.status !== 'done' && !it.skipped)) {
      mutations.push({ op: 'put', table: 'cells', record: CellSchema.parse({ ...c.cell, items: c.cell.items.map((it) => (it.skipped ? it : { ...it, status: 'done' })), updatedAt: at }) })
    }
  }
  const state = tables.monthStates.find((s) => s.month === month)
  mutations.push({
    op: 'put', table: 'monthStates',
    record: MonthStateSchema.parse({
      month, closed: true, closedAt: at,
      pocketTotalOverride: state?.pocketTotalOverride ?? household.pocketTotal,
      cashBufferOverride: state?.cashBufferOverride ?? household.cashBuffer,
      updatedAt: at,
    }),
  })
  return mutations
}

/** Close a month the way the older app did, as data that is simply there: not a step the user could undo. */
export async function legacyClose(store: Store, month: MonthKey, at: number = Date.now()): Promise<void> {
  const tables = await loadTables(store)
  const household = tables.household.find((h) => !h.deletedAt)!
  const engine = computeEngine({ tables, months: monthRange(household.startMonth, month) })
  await store.commitSystem(legacyCloseMutations(tables, engine, household, month, at))
}
