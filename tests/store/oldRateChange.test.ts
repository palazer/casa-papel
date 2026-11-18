import { describe, expect, it } from 'vitest'
import { householdFx, rateFor } from '@/engine'
import { FxRateSchema, HouseholdSchema, newId, type Household } from '@/model'
import { CasaDb, Store, addRow, keepHouse, loadTables, planHousekeeping, quickCreateHousehold, setCellValue } from '@/store'

/**
 * Versions up to schema 16 had one change per month for the months to come of every currency ("Change by a fixed %
 * each month"). Since rule X12 each currency follows its trend unless it has a change of its own, and the old setting
 * is not read. The app copies it to each currency once (`planHousekeeping`), so a household that had chosen a % sees
 * the same rates for the months to come as before.
 */
const rate = (pair: string, month: string, value: number) => FxRateSchema.parse({ pair, month, rate: value, source: 'api', updatedAt: 1 })

/** A household as an older version stored it, with a row in dollars and rates for dollars and lira. */
async function fresh(old: Partial<Pick<Household, 'fxDriftMode' | 'fxDriftDefault' | 'fxPairDrift'>>) {
  const store = new Store(new CasaDb(`test-${newId()}`))
  const household = await quickCreateHousehold(store, { name: 'Test', baseCurrency: 'EUR', locale: 'en-IE', startMonth: '2026-01' })
  await store.commitSystem([
    { op: 'put', table: 'household', record: HouseholdSchema.parse({ ...household, ...old }) },
    { op: 'put', table: 'fxRates', record: rate('EUR/USD', '2026-03', 1.1) },
    { op: 'put', table: 'fxRates', record: rate('EUR/TRY', '2026-03', 50) },
  ])
  const fee = await addRow(store, { name: 'Hosting', section: 'expense', categoryId: null })
  await setCellValue(store, fee.id, '2026-01', 100_00, 'from-now-on', { currency: 'USD' })
  return { store, fee }
}
const householdOf = async (store: Store) => (await loadTables(store)).household.find((h) => !h.deletedAt)!
async function rateIn(store: Store, to: string, month: string): Promise<number> {
  const tables = await loadTables(store)
  return rateFor(householdFx(tables.fxRates, await householdOf(store)), 'EUR', to, month)!
}

describe('an old change per month for all currencies', () => {
  it('becomes the own change of every currency that is in use or has a rate, and the months to come keep their rates', async () => {
    const { store } = await fresh({ fxDriftMode: 'fixed', fxDriftDefault: 0.015 })
    await keepHouse(store, '2026-03')
    const household = await householdOf(store)
    expect(household.fxPairDrift).toEqual({ 'EUR/USD': 0.015, 'EUR/TRY': 0.015 })
    expect(household.fxDriftDefault).toBe(0)
    // what the older version showed: the last rate times 1.015 for every month after it
    expect(await rateIn(store, 'USD', '2026-06')).toBeCloseTo(1.1 * Math.pow(1.015, 3), 12)
    expect(await rateIn(store, 'TRY', '2027-03')).toBeCloseTo(50 * Math.pow(1.015, 12), 9)
  })

  it('leaves a currency that had its own change', async () => {
    const { store } = await fresh({ fxDriftMode: 'fixed', fxDriftDefault: 0.015, fxPairDrift: { 'EUR/TRY': 0.03 } })
    await keepHouse(store, '2026-03')
    expect((await householdOf(store)).fxPairDrift).toEqual({ 'EUR/USD': 0.015, 'EUR/TRY': 0.03 })
  })

  it('happens once: a second run writes nothing to the household', async () => {
    const { store } = await fresh({ fxDriftMode: 'fixed', fxDriftDefault: 0.015 })
    await keepHouse(store, '2026-03')
    expect(planHousekeeping(await loadTables(store), '2026-03').filter((m) => m.table === 'household')).toEqual([])
  })

  it('is no edit: the record keeps its stamp, and Undo takes back what was done before it', async () => {
    const { store, fee } = await fresh({ fxDriftMode: 'fixed', fxDriftDefault: 0.015 })
    const before = (await householdOf(store)).updatedAt
    await keepHouse(store, '2026-03')
    // the store never writes a record with the stamp it had; one tick later is as close as it gets
    expect((await householdOf(store)).updatedAt).toBeLessThanOrEqual(before + 1)
    await store.undo()
    const tables = await loadTables(store)
    expect(tables.cells.some((c) => c.rowId === fee.id && c.mode !== 'inherit')).toBe(false)
    expect((await householdOf(store)).fxPairDrift).toEqual({ 'EUR/USD': 0.015, 'EUR/TRY': 0.015 })
  })

  it('is left alone where there was none: nothing is written, and the currencies follow their trend', async () => {
    const { store } = await fresh({ fxDriftMode: 'fixed', fxDriftDefault: 0 })
    expect(planHousekeeping(await loadTables(store), '2026-03').filter((m) => m.table === 'household')).toEqual([])
    // one month of rates is no year: the last rate is held
    expect(await rateIn(store, 'USD', '2026-12')).toBe(1.1)
  })

  it('"repeat the average change of the last year" had no % of its own: the trend takes its place', async () => {
    const { store } = await fresh({ fxDriftMode: 'average', fxDriftDefault: 0.015 })
    expect(planHousekeeping(await loadTables(store), '2026-03').filter((m) => m.table === 'household')).toEqual([])
    expect((await householdOf(store)).fxPairDrift).toEqual({})
  })
})
