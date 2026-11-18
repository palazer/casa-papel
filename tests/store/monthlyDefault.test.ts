import { describe, expect, it } from 'vitest'
import { newId } from '@/model'
import { CasaDb, Store, loadTables, quickCreateHousehold, setMonthlyDefault } from '@/store'

async function fresh() {
  const store = new Store(new CasaDb(`test-${newId()}`))
  await quickCreateHousehold(store, { name: 'T', baseCurrency: 'EUR', locale: 'en-IE', startMonth: '2026-01', cashBuffer: 1000_00 })
  return store
}
const override = async (store: Store, m: string) => (await loadTables(store)).monthStates.find((s) => s.month === m)?.cashBufferOverride ?? null

describe('the cash buffer with a scope', () => {
  it('from now on holds the earlier months at what they show, keeps what a month has for itself, changes the default', async () => {
    const store = await fresh()
    await setMonthlyDefault(store, 700_00, 'this-month', '2026-01')
    await setMonthlyDefault(store, 1500_00, 'from-now-on', '2026-04')
    const t = await loadTables(store)
    expect(t.household[0].cashBuffer).toBe(1500_00)
    expect(await override(store, '2026-01')).toBe(700_00) // its own amount stays
    expect(await override(store, '2026-02')).toBe(1000_00)
    expect(await override(store, '2026-03')).toBe(1000_00)
    expect(await override(store, '2026-04')).toBeNull()
  })
  it('only this month sets an override and keeps the default', async () => {
    const store = await fresh()
    await setMonthlyDefault(store, 800_00, 'this-month', '2026-03')
    expect((await loadTables(store)).household[0].cashBuffer).toBe(1000_00)
    expect(await override(store, '2026-03')).toBe(800_00)
    // every month: what a month had for itself goes, also in a month before the one on screen, and the default rules
    await setMonthlyDefault(store, 1200_00, 'all-months', '2026-05')
    expect(await override(store, '2026-03')).toBeNull()
    expect((await loadTables(store)).household[0].cashBuffer).toBe(1200_00)
  })
})
