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
  it('an amount for December alone stays in December: nothing is written into January, and the plan keeps its end', async () => {
    const store = await fresh()
    const rent = (await loadTables(store)).rows.find((r) => r.name === 'Rent')!
    expect(await end(store, '2026-03')).toBe('2026-12')
    await setCellValue(store, rent.id, '2026-11', 150000, 'from-now-on')
    await setCellValue(store, rent.id, '2026-12', 99000, 'this-month')
    const t = await loadTables(store)
    expect(t.cells.filter((c) => c.rowId === rent.id).map((c) => [c.month, c.value, c.once])).toEqual([['2026-11', 150000, false], ['2026-12', 99000, true]])
    expect(await end(store, '2026-03')).toBe('2026-12')
  })
  it('the one case that still writes the month after: an exception in the month an amount began', async () => {
    const store = await fresh()
    const rent = (await loadTables(store)).rows.find((r) => r.name === 'Rent')!
    // 1,500.00 from December on, and then December alone is 990.00: the 1,500.00 has to begin somewhere
    await setCellValue(store, rent.id, '2026-12', 150000, 'from-now-on')
    await setCellValue(store, rent.id, '2026-12', 99000, 'this-month')
    const t = await loadTables(store)
    expect(t.cells.filter((c) => c.rowId === rent.id).map((c) => [c.month, c.value, c.once])).toEqual([['2026-12', 99000, true], ['2027-01', 150000, false]])
    expect(await end(store, '2026-03')).toBe('2027-12')
    // one step, one undo
    await store.undo()
    expect((await loadTables(store)).cells.filter((c) => c.rowId === rent.id).map((c) => [c.month, c.value, c.once])).toEqual([['2026-12', 150000, false]])
  })
})
