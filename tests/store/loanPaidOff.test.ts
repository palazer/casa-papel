import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cellKey, computeEngine } from '@/engine'
import { monthRange, newId } from '@/model'
import {
  CasaDb, Store, addAccountWithRow, addRecurringItem, itemsFromCurrent, keepHouse, loadTables, quickCreateHousehold, setCellDone, setCellValue, setMonthBalances, setRowFundedBy,
} from '@/store'
import { legacyClose } from '../legacyClose'
import { restoreToday, setToday } from '../today'

const months = monthRange('2026-01', '2026-06')

/**
 * A loan of 600 with a payment of 250 a month from January: 250, 250, 100, then nothing counts. The store keeps
 * writing what was planned (250), never what counted, so the cut stays the engine's to make again.
 */
async function fresh() {
  const store = new Store(new CasaDb(`test-${newId()}`))
  await quickCreateHousehold(store, { name: 'T', baseCurrency: 'EUR', locale: 'en-IE', startMonth: '2026-01' })
  const { account: loan, row: pay } = await addAccountWithRow(store, { name: 'Car loan', type: 'loan', currency: 'EUR', openingMonth: '2026-01', openingBalance: 60000 }, { kind: 'pay-off' })
  await setCellValue(store, pay.id, '2026-01', 25000, 'from-now-on')
  return { store, loan, pay }
}
const counted = async (store: Store, rowId: string) => {
  const out = computeEngine({ tables: await loadTables(store), months })
  return months.map((m) => out.cells[cellKey(rowId, m)].value)
}
const stored = async (store: Store, rowId: string, month: string) => (await loadTables(store)).cells.find((c) => c.rowId === rowId && c.month === month)

describe('a loan that is paid off: the store writes what was planned, not what counted', () => {
  beforeEach(() => setToday('2026-03-15'))
  afterEach(restoreToday)

  it('counts 250, 250, 100, then nothing', async () => {
    const { store, pay } = await fresh()
    expect(await counted(store, pay.id)).toEqual([25000, 25000, 10000, 0, 0, 0])
  })

  it('an exception in a cut month holds the planned amount in the month after', async () => {
    const { store, pay } = await fresh()
    await setCellValue(store, pay.id, '2026-03', 5000, 'this-month')
    expect(await stored(store, pay.id, '2026-04')).toMatchObject({ mode: 'value', value: 25000 })
    // March took 50, so 50 is still owed in April, and then nothing
    expect(await counted(store, pay.id)).toEqual([25000, 25000, 5000, 5000, 0, 0])
  })

  it('counting a cut month as done writes the planned amount down, in its item', async () => {
    const { store, pay } = await fresh()
    for (const m of ['2026-01', '2026-02', '2026-03']) await setMonthBalances(store, m, {}, { done: true })
    expect((await stored(store, pay.id, '2026-03'))!.items.map((i) => [i.amount, i.status])).toEqual([[25000, 'done']])
    expect(await counted(store, pay.id)).toEqual([25000, 25000, 10000, 0, 0, 0])
  })

  it('a cut month an older version had closed keeps the planned amount when the app opens it', async () => {
    const { store, pay } = await fresh()
    for (const m of ['2026-01', '2026-02', '2026-03']) await legacyClose(store, m)
    expect(await stored(store, pay.id, '2026-03')).toMatchObject({ mode: 'value', value: 25000 })
    await keepHouse(store, '2026-06')
    expect((await stored(store, pay.id, '2026-03'))!.items.map((i) => [i.amount, i.status])).toEqual([[25000, 'done']])
    expect(await counted(store, pay.id)).toEqual([25000, 25000, 10000, 0, 0, 0])
  })

  it('ticking a cut month as paid keeps the planned amount in its item', async () => {
    const { store, pay } = await fresh()
    await setCellDone(store, pay.id, '2026-03', true)
    expect((await stored(store, pay.id, '2026-03'))!.items.map((i) => [i.amount, i.status])).toEqual([[25000, 'done']])
    const out = computeEngine({ tables: await loadTables(store), months })
    expect(out.cells[cellKey(pay.id, '2026-03')]).toMatchObject({ value: 10000, asked: 25000, status: 'done' })
  })

  it('a cut month opened as a list of items starts from the planned amount', () => {
    expect(itemsFromCurrent({ source: 'value', value: 10000, asked: 25000, items: [] }, 'cash', 'committed').map((i) => i.amount)).toEqual([25000])
    expect(itemsFromCurrent({ source: 'value', value: 10000, items: [] }, 'cash', 'committed').map((i) => i.amount)).toEqual([10000])
  })

  it('a first schedule from a later month writes the planned amount into the months before it', async () => {
    const { store, pay } = await fresh()
    await addRecurringItem(store, { name: 'Car loan', rowId: pay.id, amount: 25000, startMonth: '2026-05' })
    // written down as the month's amount; from the current month on the schedule's own pass keeps it as an item of the row
    expect(await stored(store, pay.id, '2026-02')).toMatchObject({ mode: 'value', value: 25000 })
    for (const m of ['2026-03', '2026-04']) expect((await stored(store, pay.id, m))!.items.map((i) => i.amount), m).toEqual([25000])
    expect(await counted(store, pay.id)).toEqual([25000, 25000, 10000, 0, 0, 0])
  })

  it('"comes out of" from a month on writes the planned amounts of the months before it', async () => {
    const { store, pay } = await fresh()
    await setRowFundedBy(store, pay.id, 'savings', { from: '2026-05' })
    const before = (await loadTables(store)).cells.filter((c) => c.rowId === pay.id && c.month < '2026-05').sort((a, b) => (a.month < b.month ? -1 : 1))
    expect(before.map((c) => [c.month, c.items.map((i) => i.amount)])).toEqual([['2026-01', [25000]], ['2026-02', [25000]], ['2026-03', [25000]], ['2026-04', [25000]]])
    expect(await counted(store, pay.id)).toEqual([25000, 25000, 10000, 0, 0, 0])
  })
})
