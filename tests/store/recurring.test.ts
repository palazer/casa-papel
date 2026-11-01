import { describe, expect, it } from 'vitest'
import { cellKey, computeEngine } from '@/engine'
import { monthRange, newId } from '@/model'
import {
  CasaDb, Store, addRecurringItem, closeMonth, deleteRecurringItem, endRecurringItem, loadTables, planRecurringPosts, postRecurring,
  quickCreateHousehold, recurringStatus, setCellValue, setRecurringPaid, updateRecurringItem,
} from '@/store'

const months = monthRange('2026-01', '2026-12')

async function fresh() {
  const store = new Store(new CasaDb(`test-${newId()}`))
  await quickCreateHousehold(store, { name: 'T', baseCurrency: 'EUR', locale: 'en-IE', startMonth: '2026-01' })
  const t = await loadTables(store)
  const rent = t.rows.find((r) => r.name === 'Rent')!
  const other = t.rows.find((r) => r.name === 'Other')!
  return { store, rent, other }
}

const valuesOf = async (store: Store, rowId: string) => {
  const out = computeEngine({ tables: await loadTables(store), months })
  return months.map((m) => out.cells[cellKey(rowId, m)].value)
}

describe('recurring posting', () => {
  it('posts due months only, is idempotent, and the row no longer carries forward', async () => {
    const { store, rent } = await fresh()
    await addRecurringItem(store, { name: 'Car insurance', rowId: rent.id, amount: 21000, cadence: { intervalMonths: 3, anchorMonth: 1 }, startMonth: '2026-01' })
    expect(await postRecurring(store, months)).toBe(4)
    expect(await postRecurring(store, months)).toBe(0)
    expect(await valuesOf(store, rent.id)).toEqual([21000, 0, 0, 21000, 0, 0, 21000, 0, 0, 21000, 0, 0])
    const out = computeEngine({ tables: await loadTables(store), months })
    expect(out.recurringRowIds).toContain(rent.id)
    expect(out.cells[cellKey(rent.id, '2026-01')].items[0]).toMatchObject({ label: 'Car insurance', amount: 21000, status: 'committed' })
  })

  it('follows amount changes in open months, keeps done items, never touches closed months', async () => {
    const { store, rent } = await fresh()
    const item = await addRecurringItem(store, { name: 'Rent', rowId: rent.id, amount: 100000, startMonth: '2026-01' })
    await postRecurring(store, months)
    await setRecurringPaid(store, item.id, '2026-02', true)
    await closeMonth(store, '2026-01')
    expect(recurringStatus(await loadTables(store), item, '2026-02')).toBe('paid')
    expect(recurringStatus(await loadTables(store), item, '2026-03')).toBe('due')

    await updateRecurringItem(store, item.id, { amount: 110000 })
    await postRecurring(store, months)
    const v = await valuesOf(store, rent.id)
    expect(v[0]).toBe(100000) // closed January untouched
    expect(v[1]).toBe(100000) // paid February keeps what was paid
    expect(v[2]).toBe(110000)
    expect(v[11]).toBe(110000)
  })

  it('ending or deleting an item removes future postings but keeps paid ones', async () => {
    const { store, rent } = await fresh()
    const item = await addRecurringItem(store, { name: 'Gym', rowId: rent.id, amount: 3000, startMonth: '2026-01' })
    await postRecurring(store, months)
    await setRecurringPaid(store, item.id, '2026-01', true)
    await endRecurringItem(store, item.id, '2026-03')
    await postRecurring(store, months)
    expect(await valuesOf(store, rent.id)).toEqual([3000, 3000, 3000, 0, 0, 0, 0, 0, 0, 0, 0, 0])
    await deleteRecurringItem(store, item.id)
    await postRecurring(store, months)
    expect(await valuesOf(store, rent.id)).toEqual([3000, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])
  })

  it('converts a typed value: same amount merges, a different amount stays as its own item', async () => {
    const { store, rent, other } = await fresh()
    await setCellValue(store, rent.id, '2026-01', 100000, 'from-now-on')
    await setCellValue(store, other.id, '2026-01', 5000, 'from-now-on')
    await addRecurringItem(store, { name: 'Rent', rowId: rent.id, amount: 100000, startMonth: '2026-01' })
    await addRecurringItem(store, { name: 'Streaming', rowId: other.id, amount: 1800, startMonth: '2026-01' })
    await postRecurring(store, months)
    expect((await valuesOf(store, rent.id))[0]).toBe(100000)
    expect((await valuesOf(store, rent.id))[1]).toBe(100000)
    expect((await valuesOf(store, other.id))[0]).toBe(6800)
    expect((await valuesOf(store, other.id))[1]).toBe(1800) // February inherited nothing: schedule-driven now
  })

  it('plan is pure and reports nothing for an empty register', async () => {
    const { store } = await fresh()
    expect(planRecurringPosts(await loadTables(store), months)).toEqual([])
  })
})
