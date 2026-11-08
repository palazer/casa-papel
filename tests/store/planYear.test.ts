import { describe, expect, it } from 'vitest'
import { newId } from '@/model'
import { CasaDb, Store, addPlanYear, defaultMonths, loadTables, quickCreateHousehold, setCellValue } from '@/store'

const TODAY = '2026-11'

async function fresh() {
  const store = new Store(new CasaDb(`test-${newId()}`))
  await quickCreateHousehold(store, { name: 'Test', baseCurrency: 'EUR', locale: 'en-IE', startMonth: '2026-01' })
  return store
}

const end = async (store: Store, today = TODAY) => {
  const t = await loadTables(store)
  const months = defaultMonths(t.household[0], t, today)
  return months[months.length - 1]
}

describe('addPlanYear', () => {
  it('plans the next calendar year after the last one shown, again and again, and undoes', async () => {
    const store = await fresh()
    expect(await end(store)).toBe('2027-12')
    expect(await addPlanYear(store, TODAY)).toBe('2028-12')
    expect(await end(store)).toBe('2028-12')
    expect(await addPlanYear(store, TODAY)).toBe('2029-12')
    expect(await end(store)).toBe('2029-12')
    expect((await loadTables(store)).household[0].planUntil).toBe('2029-12')
    await store.undo()
    expect(await end(store)).toBe('2028-12')
  })
  it('a December-only edit pins January and so shows the next year', async () => {
    const store = await fresh()
    const rent = (await loadTables(store)).rows.find((r) => r.name === 'Rent')!
    expect(await end(store, '2026-03')).toBe('2026-12')
    await setCellValue(store, rent.id, '2026-11', 150000, 'from-now-on')
    await setCellValue(store, rent.id, '2026-12', 99000, 'this-month')
    const t = await loadTables(store)
    expect(t.cells.some((c) => c.rowId === rent.id && c.month === '2027-01')).toBe(true)
    expect(await end(store, '2026-03')).toBe('2027-12')
  })
})
