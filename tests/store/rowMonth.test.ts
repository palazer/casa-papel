import { describe, expect, it } from 'vitest'
import { cellKey, computeEngine } from '@/engine'
import { describeCadence, monthRange, newId, type CellItem } from '@/model'
import { CasaDb, Store, addCategory, addRecurringItem, addRow, closeMonth, loadTables, planRecurringPosts, postRecurring, quickCreateHousehold, saveRowMonth, setCellItems, setCellValue } from '@/store'

const months = monthRange('2026-01', '2026-12')

async function fresh() {
  const store = new Store(new CasaDb(`test-${newId()}`))
  await quickCreateHousehold(store, { name: 'T', baseCurrency: 'EUR', locale: 'en-IE', startMonth: '2026-01' })
  const rent = (await loadTables(store)).rows.find((r) => r.name === 'Rent')!
  return { store, row: rent }
}

const item = (over: Partial<CellItem> & { amount: number }): CellItem => ({
  id: newId(), label: '', status: 'committed', fundedBy: 'cash', date: null, note: null, recurringItemId: null, kind: 'normal', skipped: false, ...over,
})
const valuesOf = async (store: Store, rowId: string) => {
  const out = computeEngine({ tables: await loadTables(store), months })
  return months.map((m) => out.cells[cellKey(rowId, m)].value)
}
const itemsOf = async (store: Store, rowId: string, month: string) => (await loadTables(store)).cells.find((c) => c.rowId === rowId && c.month === month)?.items ?? []
const schedulesOf = async (store: Store, rowId: string) => (await loadTables(store)).recurringItems.filter((r) => !r.deletedAt && r.rowId === rowId)

describe('a row\'s month saved from its dialog', () => {
  it('an item set to repeat becomes a schedule from this month: linked, landed in its months, never twice, and one undo takes it all back', async () => {
    const { store, row } = await fresh()
    await setCellValue(store, row.id, '2026-01', 50000, 'from-now-on')
    const before = await valuesOf(store, row.id)
    expect(before).toEqual(months.map(() => 50000))

    const [a, b, c] = [item({ label: 'Liability', amount: 4500 }), item({ label: 'Legal', amount: 3000 }), item({ label: 'Car wash', amount: 1500, status: 'projected' })]
    await saveRowMonth(store, row.id, '2026-03', {
      items: [a, b, c], scope: 'from-now-on',
      repeats: { [a.id]: { kind: 'every', interval: 1, anchor: 3 }, [b.id]: { kind: 'every', interval: 3, anchor: 3 }, [c.id]: { kind: 'none' } },
    })
    const schedules = await schedulesOf(store, row.id)
    expect(schedules.map((s) => [s.name, s.amount, s.startMonth, describeCadence(s)])).toEqual([
      ['Liability', 4500, '2026-03', 'Every month'], ['Legal', 3000, '2026-03', 'Every 3 months (Mar, Jun, Sep, Dec)'],
    ])
    // this month keeps its three items, two of them now the schedules' own
    const march = await itemsOf(store, row.id, '2026-03')
    expect(march.map((i) => [i.label, i.amount, i.recurringItemId])).toEqual([['Liability', 4500, schedules[0].id], ['Legal', 3000, schedules[1].id], ['Car wash', 1500, null]])
    // earlier months keep what they carried; from here on the row shows only what repeats
    expect(await valuesOf(store, row.id)).toEqual([50000, 50000, 9000, 4500, 4500, 7500, 4500, 4500, 7500, 4500, 4500, 7500])
    // the other months were landed in the same step: the poster finds nothing left to do
    expect(planRecurringPosts(await loadTables(store), months)).toEqual([])

    await store.undo()
    expect(await schedulesOf(store, row.id)).toEqual([])
    expect(await valuesOf(store, row.id)).toEqual(before)
  })

  it('an item whose rhythm does not land in this month leaves it and comes in its own', async () => {
    const { store, row } = await fresh()
    const yearly = item({ label: 'Car insurance', amount: 48000 })
    const once = item({ label: 'Repair', amount: 9000 })
    await saveRowMonth(store, row.id, '2026-03', { items: [yearly, once], scope: 'from-now-on', repeats: { [yearly.id]: { kind: 'every', interval: 12, anchor: 6 } } })
    expect((await itemsOf(store, row.id, '2026-03')).map((i) => i.label)).toEqual(['Repair'])
    expect(await valuesOf(store, row.id)).toEqual([0, 0, 9000, 0, 0, 48000, 0, 0, 0, 0, 0, 0])
  })

  it('a single amount put on a schedule is named after its row; where it does not land the month is left empty', async () => {
    const { store, row } = await fresh()
    await setCellValue(store, row.id, '2026-02', 20000, 'from-now-on')
    const single = item({ amount: 60000 })
    await saveRowMonth(store, row.id, '2026-03', { items: [single], scope: 'from-now-on', repeats: { [single.id]: { kind: 'months', months: [5, 11] } } })
    expect((await schedulesOf(store, row.id)).map((s) => [s.name, describeCadence(s)])).toEqual([['Rent', 'In May, Nov']])
    expect(await itemsOf(store, row.id, '2026-03')).toEqual([])
    expect(await valuesOf(store, row.id)).toEqual([0, 20000, 0, 0, 60000, 0, 0, 0, 0, 0, 60000, 0])
  })

  it('a new rhythm counts from this month: earlier months keep what they show, and what is done stays', async () => {
    const { store, row } = await fresh()
    const first = await addRecurringItem(store, { name: 'Ticket', rowId: row.id, amount: 9800, startMonth: '2026-01' })
    await postRecurring(store, months)
    const april = (await itemsOf(store, row.id, '2026-04'))[0]
    await saveRowMonth(store, row.id, '2026-04', { items: [april], scope: 'from-now-on', repeats: { [april.id]: { kind: 'every', interval: 3, anchor: 4 } } })
    expect(await valuesOf(store, row.id)).toEqual([9800, 9800, 9800, 9800, 0, 0, 9800, 0, 0, 9800, 0, 0])
    const [old, now] = await schedulesOf(store, row.id)
    expect([old.id, old.endMonth, now.startMonth, describeCadence(now)]).toEqual([first.id, '2026-03', '2026-04', 'Every 3 months (Jan, Apr, Jul, Oct)'])

    // moved to a rhythm that skips July, with a new amount: July leaves, unless it was already paid
    const july = (await itemsOf(store, row.id, '2026-07'))[0]
    await saveRowMonth(store, row.id, '2026-07', { items: [{ ...july, amount: 30000, status: 'done' }], scope: 'from-now-on', repeats: { [july.id]: { kind: 'every', interval: 12, anchor: 12 } } })
    expect(await valuesOf(store, row.id)).toEqual([9800, 9800, 9800, 9800, 0, 0, 30000, 0, 0, 0, 0, 30000])
  })

  it('"only this month" on a scheduled item ends its schedule after this month', async () => {
    const { store, row } = await fresh()
    const schedule = await addRecurringItem(store, { name: 'Gym', rowId: row.id, amount: 3000, startMonth: '2026-01' })
    await postRecurring(store, months)
    const may = (await itemsOf(store, row.id, '2026-05'))[0]
    await saveRowMonth(store, row.id, '2026-05', { items: [may], scope: 'from-now-on', repeats: { [may.id]: { kind: 'none' } } })
    expect((await schedulesOf(store, row.id)).map((s) => [s.id, s.endMonth])).toEqual([[schedule.id, '2026-05']])
    expect(await valuesOf(store, row.id)).toEqual([3000, 3000, 3000, 3000, 3000, 0, 0, 0, 0, 0, 0, 0])
  })

  it('an edited amount is for this month alone, or from here on, as the dialog asked', async () => {
    const { store, row } = await fresh()
    await addRecurringItem(store, { name: 'Rent', rowId: row.id, amount: 100000, startMonth: '2026-01' })
    await postRecurring(store, months)
    const feb = (await itemsOf(store, row.id, '2026-02'))[0]
    await saveRowMonth(store, row.id, '2026-02', { items: [{ ...feb, amount: 90000 }], scope: 'from-now-on' })
    await postRecurring(store, months)
    expect((await valuesOf(store, row.id)).slice(0, 4)).toEqual([100000, 90000, 100000, 100000])
    const june = (await itemsOf(store, row.id, '2026-06'))[0]
    await saveRowMonth(store, row.id, '2026-06', { items: [{ ...june, amount: 110000 }], scope: 'from-now-on', applyTo: { [june.id]: 'from-now-on' } })
    expect((await valuesOf(store, row.id)).slice(4)).toEqual([100000, 110000, 110000, 110000, 110000, 110000, 110000, 110000])
  })

  it('a schedule that does not land in the month can be changed from it: its amount, or its rhythm, which may bring it in at once', async () => {
    const { store, row } = await fresh()
    const yearly = await addRecurringItem(store, { name: 'Car insurance', rowId: row.id, amount: 48000, cadence: { intervalMonths: 12, anchorMonth: 2 }, startMonth: '2026-01' })
    await postRecurring(store, months)
    expect(await valuesOf(store, row.id)).toEqual([0, 48000, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])
    // a dearer contract from March on, paid in March and September
    await saveRowMonth(store, row.id, '2026-03', { items: [], scope: 'from-now-on', others: { [yearly.id]: { amount: 26000, repeat: { kind: 'every', interval: 6, anchor: 3 } } } })
    expect(await valuesOf(store, row.id)).toEqual([0, 48000, 26000, 0, 0, 0, 0, 0, 26000, 0, 0, 0])
    expect((await itemsOf(store, row.id, '2026-03')).map((i) => [i.label, i.amount])).toEqual([['Car insurance', 26000]])
    // the same months picked another way, and the same amount: nothing is written
    const now = (await schedulesOf(store, row.id)).find((s) => !s.endMonth)!
    const tables = JSON.stringify(await loadTables(store))
    await saveRowMonth(store, row.id, '2026-04', { items: [], scope: 'from-now-on', others: { [now.id]: { amount: 26000, repeat: { kind: 'months', months: [3, 9] } } } })
    expect(JSON.stringify(await loadTables(store))).toBe(tables)
  })

  it('while nothing repeats it saves as before: the total carries on, or the next month is held', async () => {
    const { store, row } = await fresh()
    await setCellValue(store, row.id, '2026-01', 50000, 'from-now-on')
    await saveRowMonth(store, row.id, '2026-03', { items: [item({ label: 'A', amount: 100 }), item({ label: 'B', amount: 200 })], scope: 'this-month' })
    expect((await valuesOf(store, row.id)).slice(0, 5)).toEqual([50000, 50000, 300, 50000, 50000])
    await saveRowMonth(store, row.id, '2026-06', { items: [item({ label: 'C', amount: 700 })], scope: 'from-now-on' })
    expect((await valuesOf(store, row.id)).slice(4, 8)).toEqual([50000, 700, 700, 700])
    expect(await schedulesOf(store, row.id)).toEqual([])
  })
})

describe('something that repeats, renamed in the row\'s dialog', () => {
  const labelsOf = async (store: Store, rowId: string) => {
    const cells = (await loadTables(store)).cells.filter((c) => c.rowId === rowId)
    return months.map((m) => cells.find((c) => c.month === m)?.items.map((i) => i.label).join('+') ?? '')
  }

  it('the name typed over an item renames its schedule and what it posted in every open month, done or not; one undo takes it back', async () => {
    const { store, row } = await fresh()
    await addRecurringItem(store, { name: 'Getsafe', rowId: row.id, amount: 6000, startMonth: '2026-01' })
    await postRecurring(store, months)
    const feb = (await itemsOf(store, row.id, '2026-02'))[0]
    await saveRowMonth(store, row.id, '2026-02', { items: [{ ...feb, status: 'done' }], scope: 'from-now-on' })
    await closeMonth(store, '2026-01')
    const before = await valuesOf(store, row.id)

    const march = (await itemsOf(store, row.id, '2026-03'))[0]
    await saveRowMonth(store, row.id, '2026-03', { items: [{ ...march, label: '  Liability insurance ' }], scope: 'from-now-on' })
    expect((await schedulesOf(store, row.id)).map((s) => s.name)).toEqual(['Liability insurance'])
    // January is closed and keeps what it shows; February is done and is renamed all the same
    expect(await labelsOf(store, row.id)).toEqual(['Getsafe', ...months.slice(1).map(() => 'Liability insurance')])
    expect(await valuesOf(store, row.id)).toEqual(before)
    // nothing is left for the poster to put right
    expect(planRecurringPosts(await loadTables(store), months)).toEqual([])

    await store.undo()
    expect((await schedulesOf(store, row.id)).map((s) => s.name)).toEqual(['Getsafe'])
    expect(await labelsOf(store, row.id)).toEqual(months.map(() => 'Getsafe'))
  })

  it('an emptied name keeps the one it has, and a rhythm changed earlier is renamed with it', async () => {
    const { store, row } = await fresh()
    await addRecurringItem(store, { name: 'Ticket', rowId: row.id, amount: 9800, startMonth: '2026-01' })
    await postRecurring(store, months)
    const april = (await itemsOf(store, row.id, '2026-04'))[0]
    await saveRowMonth(store, row.id, '2026-04', { items: [april], scope: 'from-now-on', repeats: { [april.id]: { kind: 'every', interval: 3, anchor: 4 } } })
    expect((await schedulesOf(store, row.id)).map((s) => s.name)).toEqual(['Ticket', 'Ticket'])
    const july = (await itemsOf(store, row.id, '2026-07'))[0]
    await saveRowMonth(store, row.id, '2026-07', { items: [{ ...july, label: '   ' }], scope: 'from-now-on' })
    expect((await schedulesOf(store, row.id)).map((s) => s.name)).toEqual(['Ticket', 'Ticket'])
    expect((await labelsOf(store, row.id))[6]).toBe('Ticket')

    await saveRowMonth(store, row.id, '2026-07', { items: [{ ...july, label: 'Train pass' }], scope: 'from-now-on' })
    expect((await schedulesOf(store, row.id)).map((s) => s.name)).toEqual(['Train pass', 'Train pass'])
    expect(await labelsOf(store, row.id)).toEqual(['Train pass', 'Train pass', 'Train pass', 'Train pass', '', '', 'Train pass', '', '', 'Train pass', '', ''])
  })

  it('one that lands in other months is renamed from its box, with or without another change', async () => {
    const { store, row } = await fresh()
    const yearly = await addRecurringItem(store, { name: 'Car insurance', rowId: row.id, amount: 48000, cadence: { intervalMonths: 12, anchorMonth: 6 }, startMonth: '2026-01' })
    await postRecurring(store, months)
    await saveRowMonth(store, row.id, '2026-03', { items: [], scope: 'from-now-on', others: { [yearly.id]: { name: 'Car cover' } } })
    expect((await schedulesOf(store, row.id)).map((s) => [s.name, s.amount])).toEqual([['Car cover', 48000]])
    expect((await labelsOf(store, row.id))[5]).toBe('Car cover')
    const now = (await schedulesOf(store, row.id))[0]
    await saveRowMonth(store, row.id, '2026-03', { items: [], scope: 'from-now-on', others: { [now.id]: { name: 'Car policy', amount: 50000 } } })
    expect((await schedulesOf(store, row.id)).filter((s) => !s.endMonth).map((s) => [s.name, s.amount])).toEqual([['Car policy', 50000]])
    expect(await valuesOf(store, row.id)).toEqual([0, 0, 0, 0, 0, 50000, 0, 0, 0, 0, 0, 0])
    expect((await labelsOf(store, row.id))[5]).toBe('Car policy')
  })
})

describe('the row\'s currency, chosen in its dialog', () => {
  const currencyOf = async (store: Store, rowId: string) => (await loadTables(store)).rows.find((r) => r.id === rowId)!.currency

  it('goes with the amount: one step, and one undo takes both back', async () => {
    const { store, row } = await fresh()
    await setCellValue(store, row.id, '2026-02', 100000, 'from-now-on', { currency: 'USD' })
    expect(await currencyOf(store, row.id)).toBe('USD')
    expect((await valuesOf(store, row.id)).slice(0, 3)).toEqual([0, 100000, 100000])
    await store.undo()
    expect(await currencyOf(store, row.id)).toBeNull()
    expect((await valuesOf(store, row.id)).slice(0, 3)).toEqual([0, 0, 0])
  })

  it('is saved from every way the dialog saves, and null is the household\'s own again', async () => {
    const { store, row } = await fresh()
    await setCellItems(store, row.id, '2026-02', [item({ amount: 5000, status: 'done' })], 'from-now-on', { currency: 'TRY' })
    expect(await currencyOf(store, row.id)).toBe('TRY')
    await saveRowMonth(store, row.id, '2026-03', { items: [item({ label: 'A', amount: 100 }), item({ label: 'B', amount: 200 })], scope: 'from-now-on', row: { currency: 'USD' } })
    expect(await currencyOf(store, row.id)).toBe('USD')
    // left out, the row keeps what it has
    await saveRowMonth(store, row.id, '2026-04', { items: [item({ label: 'C', amount: 300 })], scope: 'from-now-on' })
    await setCellValue(store, row.id, '2026-05', 700, 'from-now-on')
    expect(await currencyOf(store, row.id)).toBe('USD')
    await saveRowMonth(store, row.id, '2026-06', { items: [item({ label: 'D', amount: 400 })], scope: 'from-now-on', row: { currency: null } })
    expect(await currencyOf(store, row.id)).toBeNull()
    // the same currency again writes no row
    const before = (await loadTables(store)).rows.find((r) => r.id === row.id)!.updatedAt
    await setCellValue(store, row.id, '2026-07', 900, 'from-now-on', { currency: null })
    expect((await loadTables(store)).rows.find((r) => r.id === row.id)!.updatedAt).toBe(before)
  })
})

describe('the row\'s category, chosen in its dialog', () => {
  const rowOf = async (store: Store, rowId: string) => (await loadTables(store)).rows.find((r) => r.id === rowId)!

  it('moves the row with the amount in one step, to the end of its new category; one undo takes both back', async () => {
    const { store, row } = await fresh()
    const hobbies = await addCategory(store, { name: 'Hobbies', section: 'expense' })
    const first = await addRow(store, { name: 'Climbing', section: 'expense', categoryId: hobbies.id })
    await setCellValue(store, row.id, '2026-02', 100000, 'from-now-on', { categoryId: hobbies.id, currency: 'USD' })
    const moved = await rowOf(store, row.id)
    expect([moved.categoryId, moved.currency]).toEqual([hobbies.id, 'USD'])
    expect(moved.order > (await rowOf(store, first.id)).order).toBe(true)
    expect((await valuesOf(store, row.id))[1]).toBe(100000)
    await store.undo()
    const back = await rowOf(store, row.id)
    expect([back.categoryId, back.currency, back.order]).toEqual([row.categoryId, null, row.order])
    expect((await valuesOf(store, row.id))[1]).toBe(0)
    // null is no category; the itemized save takes it too
    await saveRowMonth(store, row.id, '2026-03', { items: [item({ label: 'A', amount: 100 }), item({ label: 'B', amount: 200 })], scope: 'from-now-on', row: { categoryId: null } })
    expect((await rowOf(store, row.id)).categoryId).toBeNull()
  })

  it('refuses a category of another section, and then saves nothing at all', async () => {
    const { store, row } = await fresh()
    const jobs = await addCategory(store, { name: 'Jobs', section: 'income' })
    await expect(setCellValue(store, row.id, '2026-02', 100000, 'from-now-on', { categoryId: jobs.id })).rejects.toThrow('"Jobs" belongs to another section.')
    await expect(saveRowMonth(store, row.id, '2026-02', { items: [item({ amount: 100 })], scope: 'from-now-on', row: { categoryId: jobs.id } })).rejects.toThrow('"Jobs" belongs to another section.')
    expect((await rowOf(store, row.id)).categoryId).toBe(row.categoryId)
    expect((await valuesOf(store, row.id))[1]).toBe(0)
  })
})

describe('a schedule added from the long form', () => {
  it('keeps the amounts the row carried in the months before it starts', async () => {
    const { store, row } = await fresh()
    await setCellValue(store, row.id, '2026-01', 50000, 'from-now-on')
    await addRecurringItem(store, { name: 'Rent', rowId: row.id, amount: 60000, startMonth: '2026-04' })
    await postRecurring(store, months)
    expect((await valuesOf(store, row.id)).slice(0, 6)).toEqual([50000, 50000, 50000, 60000, 60000, 60000])
    // a second schedule on the same row changes nothing before it
    await addRecurringItem(store, { name: 'Parking', rowId: row.id, amount: 5000, startMonth: '2026-06' })
    await postRecurring(store, months)
    expect((await valuesOf(store, row.id)).slice(0, 6)).toEqual([50000, 50000, 50000, 60000, 60000, 65000])
  })
})
