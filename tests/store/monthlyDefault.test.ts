import { describe, expect, it } from 'vitest'
import { newId } from '@/model'
import { CasaDb, Store, closeMonth, loadTables, quickCreateHousehold, setMonthlyDefault } from '@/store'

async function fresh() {
  const store = new Store(new CasaDb(`test-${newId()}`))
  await quickCreateHousehold(store, { name: 'T', baseCurrency: 'EUR', locale: 'en-IE', startMonth: '2026-01', pocketTotal: 1000_00 })
  return store
}
const override = async (store: Store, m: string) => (await loadTables(store)).monthStates.find((s) => s.month === m)?.pocketTotalOverride ?? null

describe('pocket money and cash buffer with a scope', () => {
  it('from now on freezes earlier open months, leaves closed months alone, changes the default', async () => {
    const store = await fresh()
    await closeMonth(store, '2026-01')
    await setMonthlyDefault(store, 'pocketTotal', 1500_00, 'from-now-on', '2026-04')
    const t = await loadTables(store)
    expect(t.household[0].pocketTotal).toBe(1500_00)
    expect(await override(store, '2026-01')).toBe(1000_00) // closed: frozen at close time
    expect(await override(store, '2026-02')).toBe(1000_00)
    expect(await override(store, '2026-03')).toBe(1000_00)
    expect(await override(store, '2026-04')).toBeNull()
  })
  it('only this month sets an override and keeps the default', async () => {
    const store = await fresh()
    await setMonthlyDefault(store, 'pocketTotal', 800_00, 'this-month', '2026-03')
    expect((await loadTables(store)).household[0].pocketTotal).toBe(1000_00)
    expect(await override(store, '2026-03')).toBe(800_00)
    // every open month: overrides go, the default rules
    await setMonthlyDefault(store, 'pocketTotal', 1200_00, 'all-open', '2026-05')
    expect(await override(store, '2026-03')).toBeNull()
    expect((await loadTables(store)).household[0].pocketTotal).toBe(1200_00)
  })
})
