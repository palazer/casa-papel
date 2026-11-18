import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cellKey, computeEngine } from '@/engine'
import { monthRange, newId } from '@/model'
import {
  CasaDb, Store, addRecurringItem, addRow, closeMonth, deleteRecurringItem, endRecurringItem, keepHouse, loadTables, planRecurringPosts, postRecurring,
  changeRecurringFrom, endRecurringFrom, quickCreateHousehold, reactivateRecurringItem, recurringStatus, setCellItems, setCellValue, setRecurringPaid, skipRecurringMonth,
  updateRecurringItem,
} from '@/store'
import { restoreToday, setToday } from '../today'

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
    // the save lands the schedule in its months itself: nothing is left for the app's own pass
    const posted = (await loadTables(store)).cells.filter((c) => c.rowId === rent.id && months.includes(c.month) && c.items.some((i) => i.recurringItemId))
    expect(posted.map((c) => c.month).sort()).toEqual(['2026-01', '2026-04', '2026-07', '2026-10'])
    expect(await postRecurring(store, months)).toBe(0)
    expect(await valuesOf(store, rent.id)).toEqual([21000, 0, 0, 21000, 0, 0, 21000, 0, 0, 21000, 0, 0])
    const out = computeEngine({ tables: await loadTables(store), months })
    expect(out.recurringRowIds).toContain(rent.id)
    expect(out.cells[cellKey(rent.id, '2026-01')].items[0]).toMatchObject({ label: 'Car insurance', amount: 21000, status: 'committed' })
  })

  it('a new amount from the list counts from the current month: earlier months keep what they had, and so does what is paid', async () => {
    setToday('2026-04-15')
    const { store, rent } = await fresh()
    const item = await addRecurringItem(store, { name: 'Rent', rowId: rent.id, amount: 100000, startMonth: '2026-01' })
    await setRecurringPaid(store, item.id, '2026-02', true)
    await setRecurringPaid(store, item.id, '2026-06', true)
    await closeMonth(store, '2026-01')
    expect(recurringStatus(await loadTables(store), item, '2026-02')).toBe('paid')
    expect(recurringStatus(await loadTables(store), item, '2026-03')).toBe('due')

    await updateRecurringItem(store, item.id, { amount: 110000 })
    expect(await keepHouse(store)).toBe(0)
    const v = await valuesOf(store, rent.id)
    expect(v[0]).toBe(100000) // closed January untouched
    expect(v[1]).toBe(100000) // paid February keeps what was paid
    expect(v[2]).toBe(100000) // March is over and was not paid: it keeps what it had all the same
    expect(v[3]).toBe(110000) // April, the current month
    expect(v[5]).toBe(100000) // June was paid ahead: what was paid stays
    expect(v[11]).toBe(110000)
    restoreToday()
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
    expect(await postRecurring(store, months)).toBe(0)
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

describe('a schedule saved from the list of schedules is one step', () => {
  beforeEach(() => setToday('2026-03-15'))
  afterEach(restoreToday)
  // the app's own pass, which must find nothing left to do after a step
  const posts = (store: Store) => keepHouse(store)

  it('undo takes the schedule and its months back, and the row is as it was', async () => {
    const { store, rent } = await fresh()
    await setCellValue(store, rent.id, '2026-01', 120000, 'from-now-on')
    const before = await valuesOf(store, rent.id)
    expect(before).toEqual(months.map(() => 120000))

    await addRecurringItem(store, { name: 'Rent', rowId: rent.id, amount: 130000, startMonth: '2026-03' })
    expect(await valuesOf(store, rent.id)).toEqual([120000, 120000, ...months.slice(2).map(() => 130000)])
    expect(await posts(store)).toBe(0)

    await store.undo()
    expect((await loadTables(store)).recurringItems.filter((r) => !r.deletedAt)).toEqual([])
    expect(await valuesOf(store, rent.id)).toEqual(before)
    // and the app's own pass finds nothing to tidy up afterwards
    expect(await posts(store)).toBe(0)
    expect(await valuesOf(store, rent.id)).toEqual(before)

    await store.redo()
    expect(await valuesOf(store, rent.id)).toEqual([120000, 120000, ...months.slice(2).map(() => 130000)])
  })

  it('ending a schedule, a new amount and reactivating are each one step', async () => {
    const { store, rent } = await fresh()
    const item = await addRecurringItem(store, { name: 'Rent', rowId: rent.id, amount: 100000, startMonth: '2026-01' })
    const all = months.map(() => 100000)

    await endRecurringItem(store, item.id, '2026-06')
    expect(await valuesOf(store, rent.id)).toEqual([...all.slice(0, 6), 0, 0, 0, 0, 0, 0])
    expect(await posts(store)).toBe(0)
    await store.undo()
    expect(await valuesOf(store, rent.id)).toEqual(all)
    expect(await posts(store)).toBe(0)

    // a new amount counts from March, the current month
    await updateRecurringItem(store, item.id, { amount: 110000 })
    expect(await valuesOf(store, rent.id)).toEqual([100000, 100000, ...months.slice(2).map(() => 110000)])
    expect(await posts(store)).toBe(0)
    await store.undo()
    expect(await valuesOf(store, rent.id)).toEqual(all)
    expect(await posts(store)).toBe(0)

    // ended last month and reactivated: nothing lies in between, so it simply runs on
    await endRecurringItem(store, item.id, '2026-02')
    expect(await valuesOf(store, rent.id)).toEqual([100000, 100000, ...months.slice(2).map(() => 0)])
    await reactivateRecurringItem(store, item.id)
    expect(await valuesOf(store, rent.id)).toEqual(all)
    expect((await loadTables(store)).recurringItems.filter((r) => !r.deletedAt)).toHaveLength(1)
    expect(await posts(store)).toBe(0)

    // ended after January: February is over and stays empty when the schedule runs again
    await endRecurringItem(store, item.id, '2026-01')
    expect(await valuesOf(store, rent.id)).toEqual([100000, ...months.slice(1).map(() => 0)])
    await reactivateRecurringItem(store, item.id)
    expect(await valuesOf(store, rent.id)).toEqual([100000, 0, ...months.slice(2).map(() => 100000)])
    const pieces = (await loadTables(store)).recurringItems.filter((r) => !r.deletedAt).map((r) => [r.startMonth, r.endMonth]).sort()
    expect(pieces).toEqual([['2026-01', '2026-01'], ['2026-03', null]])
    expect(await posts(store)).toBe(0)
    await store.undo()
    expect(await valuesOf(store, rent.id)).toEqual([100000, ...months.slice(1).map(() => 0)])
    expect(await posts(store)).toBe(0)
  })

  it('the form of the list: what the schedule posts counts from the current month, its dates as they are typed, the rest everywhere', async () => {
    const { store, rent, other } = await fresh()
    const item = await addRecurringItem(store, { name: 'Gym', rowId: rent.id, amount: 3000, startMonth: '2026-02', notes: '' })
    const pieces = async () => (await loadTables(store)).recurringItems.filter((r) => !r.deletedAt).sort((a, b) => (a.startMonth < b.startMonth ? -1 : 1))
    expect(await valuesOf(store, rent.id)).toEqual([0, ...months.slice(1).map(() => 3000)])

    // a new name and a note alone: the same schedule, renamed in every month
    await updateRecurringItem(store, item.id, { ...item, name: 'Gym membership', notes: 'card' })
    expect((await pieces()).map((r) => [r.name, r.notes, r.startMonth, r.endMonth])).toEqual([['Gym membership', 'card', '2026-02', null]])
    expect((await loadTables(store)).cells.filter((c) => c.rowId === rent.id).flatMap((c) => c.items.map((i) => i.label))).toEqual(months.slice(1).map(() => 'Gym membership'))

    // a new amount and an earlier first month in one save: January is filled as typed, with what the schedule posted then
    await updateRecurringItem(store, item.id, { ...item, name: 'Gym membership', notes: 'card', amount: 3500, startMonth: '2026-01' })
    expect(await valuesOf(store, rent.id)).toEqual([3000, 3000, ...months.slice(2).map(() => 3500)])
    expect((await pieces()).map((r) => [r.name, r.notes, r.amount, r.startMonth, r.endMonth])).toEqual([
      ['Gym membership', 'card', 3000, '2026-01', '2026-02'], ['Gym membership', 'card', 3500, '2026-03', null],
    ])
    expect(await posts(store)).toBe(0)
    await store.undo()
    expect(await valuesOf(store, rent.id)).toEqual([0, ...months.slice(1).map(() => 3000)])

    // moved to another row: from the current month on, the months before stay on the row they were on
    await updateRecurringItem(store, item.id, { ...item, name: 'Gym membership', notes: 'card', rowId: other.id })
    expect(await valuesOf(store, rent.id)).toEqual([0, 3000, ...months.slice(2).map(() => 0)])
    expect(await valuesOf(store, other.id)).toEqual([0, 0, ...months.slice(2).map(() => 3000)])
    expect(await posts(store)).toBe(0)
    await store.undo()

    // a later first month is a month that was typed: what was posted before it and not paid goes
    await setRecurringPaid(store, item.id, '2026-02', true)
    await updateRecurringItem(store, item.id, { ...item, name: 'Gym membership', notes: 'card', startMonth: '2026-05' })
    expect(await valuesOf(store, rent.id)).toEqual([0, 3000, 0, 0, ...months.slice(4).map(() => 3000)])
    expect(await posts(store)).toBe(0)
  })

  it('a schedule that ended in a month that is over says so, or runs again from the current month', async () => {
    const { store, rent } = await fresh()
    const item = await addRecurringItem(store, { name: 'Course', rowId: rent.id, amount: 5000, startMonth: '2026-01', endMonth: '2026-01' })
    expect(await valuesOf(store, rent.id)).toEqual([5000, ...months.slice(1).map(() => 0)])
    // a new amount has no month left to count from
    await expect(updateRecurringItem(store, item.id, { ...item, amount: 6000 })).rejects.toThrow('"Course" ended in Jan 2026, and a change made here counts from Mar 2026 on. Change the amount of a month that is over in that month, or give the schedule a later last month to run it again.')
    expect(await valuesOf(store, rent.id)).toEqual([5000, ...months.slice(1).map(() => 0)])
    // its name can still be put right
    await updateRecurringItem(store, item.id, { ...item, name: 'Evening course' })
    expect((await loadTables(store)).recurringItems.find((r) => r.id === item.id)).toMatchObject({ name: 'Evening course', endMonth: '2026-01' })
    // with a later last month it runs again from the current month, with the new amount; February stays empty
    await updateRecurringItem(store, item.id, { ...item, name: 'Evening course', amount: 6000, endMonth: '2026-06' })
    expect(await valuesOf(store, rent.id)).toEqual([5000, 0, 6000, 6000, 6000, 6000, 0, 0, 0, 0, 0, 0])
    expect(await posts(store)).toBe(0)
    await store.undo()
    expect(await valuesOf(store, rent.id)).toEqual([5000, ...months.slice(1).map(() => 0)])
  })

  it('a schedule that starts in the current month or later is changed as a whole', async () => {
    const { store } = await fresh()
    const row = await addRow(store, { name: 'Insurance', section: 'expense' })
    const item = await addRecurringItem(store, { name: 'Insurance', rowId: row.id, amount: 20000, startMonth: '2026-03' })
    await updateRecurringItem(store, item.id, { ...item, amount: 21000 })
    expect((await loadTables(store)).recurringItems.filter((r) => !r.deletedAt)).toHaveLength(1)
    expect(await valuesOf(store, row.id)).toEqual([0, 0, ...months.slice(2).map(() => 21000)])
    expect(await posts(store)).toBe(0)
  })

  it('a row made in the same form is part of the step', async () => {
    const { store } = await fresh()
    const rows = (await loadTables(store)).rows.length
    const item = await addRecurringItem(store, { name: 'Car insurance', rowId: '__new__', amount: 21000, startMonth: '2026-02' }, { name: 'Car', section: 'expense', defaultStatus: 'committed' })
    let t = await loadTables(store)
    const car = t.rows.find((r) => r.name === 'Car')!
    expect(item.rowId).toBe(car.id)
    expect(await valuesOf(store, car.id)).toEqual([0, ...months.slice(1).map(() => 21000)])

    await store.undo()
    t = await loadTables(store)
    expect(t.rows.length).toBe(rows)
    expect(t.recurringItems).toEqual([])
    expect(t.cells.filter((c) => c.rowId === car.id)).toEqual([])
  })
})
