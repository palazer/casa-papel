import { describe, expect, it } from 'vitest'
import { cellKey, computeEngine } from '@/engine'
import { monthRange, newId } from '@/model'
import {
  CasaDb, Store, addRecurringItem, closeMonth, deleteRecurringItem, endRecurringItem, loadTables, planRecurringPosts, postRecurring,
  changeRecurringFrom, endRecurringFrom, quickCreateHousehold, recurringStatus, setCellItems, setCellValue, setRecurringPaid, skipRecurringMonth, updateRecurringItem,
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

describe('recurring managed from the grid', () => {
  it('pinned amounts hold, changes split the schedule from a month, skips hold, ending clears later months', async () => {
    const { store, rent } = await fresh()
    const item = await addRecurringItem(store, { name: 'Rent', rowId: rent.id, amount: 100000, cadence: { intervalMonths: 1, anchorMonth: 1 }, startMonth: '2026-01' })
    await postRecurring(store, months)

    // March set by hand for this month only: the schedule leaves it alone
    const mar = (await loadTables(store)).cells.find((c) => c.rowId === rent.id && c.month === '2026-03')!
    await setCellItems(store, rent.id, '2026-03', mar.items.map((i) => ({ ...i, amount: 123400, pinned: true })), 'this-month')
    expect(await postRecurring(store, months)).toBe(0)
    expect((await valuesOf(store, rent.id))[2]).toBe(123400)

    // new amount from June on: May keeps the old one, the schedule is split, nothing double-posts
    const fromJune = await changeRecurringFrom(store, item.id, '2026-06', { amount: 110000 })
    expect(fromJune).not.toBe(item.id)
    expect(await postRecurring(store, months)).toBe(0)
    const v = await valuesOf(store, rent.id)
    expect(v[4]).toBe(100000)
    expect(v[5]).toBe(110000)
    expect(v[11]).toBe(110000)
    const t = await loadTables(store)
    expect(t.recurringItems.find((r) => r.id === item.id)?.endMonth).toBe('2026-05')
    expect(t.cells.filter((c) => c.rowId === rent.id).every((c) => c.items.filter((i) => !i.skipped).length === 1)).toBe(true)

    // skip August only
    await skipRecurringMonth(store, fromJune, '2026-08', true)
    expect(await postRecurring(store, months)).toBe(0)
    const w = await valuesOf(store, rent.id)
    expect(w[7]).toBe(0)
    expect(w[8]).toBe(110000)

    // end from October: later months empty out, September stays
    await endRecurringFrom(store, fromJune, '2026-10')
    expect(await postRecurring(store, months)).toBeGreaterThan(0)
    const x = await valuesOf(store, rent.id)
    expect(x[8]).toBe(110000)
    expect(x[9]).toBe(0)
    expect(x[11]).toBe(0)

    // changing at the very first month edits in place instead of splitting
    const same = await changeRecurringFrom(store, item.id, '2026-01', { amount: 90000 })
    expect(same).toBe(item.id)
    expect(await postRecurring(store, months)).toBe(0)
    expect((await valuesOf(store, rent.id))[0]).toBe(90000)
  })
})
