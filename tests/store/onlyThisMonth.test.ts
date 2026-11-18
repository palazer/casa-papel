import { describe, expect, it } from 'vitest'
import { cellKey, computeEngine } from '@/engine'
import { monthRange, newId, type CellItem } from '@/model'
import {
  CasaDb, Store, addPool, clearCell, estimateRowOf, itemsFromCurrent, loadTables, quickCreateHousehold, saveRowMonth, setCardBalanceBooked, setCategoryEstimate, setCellDone,
  setCellItems, setCellValue, topUpPool, unrecordedRowName,
} from '@/store'
import { DEMO_IDS } from '@/demo/demoHousehold'
import { loadDemo } from '@/demo/loadDemo'

/**
 * "Only this month" is a mark on its own month (`Cell.once`): the month hands on what it was given, and nothing is
 * written into the month after. These tests read the stored months as well as the figures, since the figures alone
 * looked right before too, when the old amount was written into the next month.
 */
const months = monthRange('2026-01', '2026-06')
const item = (amount: number, over: Partial<CellItem> = {}): CellItem =>
  ({ id: newId(), label: '', amount, status: 'committed', fundedBy: 'cash', date: null, note: null, recurringItemId: null, kind: 'normal', skipped: false, ...over })

/** Rent is 1,200.00 from January. */
async function fresh() {
  const store = new Store(new CasaDb(`test-${newId()}`))
  await quickCreateHousehold(store, { name: 'Test', baseCurrency: 'EUR', locale: 'en-IE', startMonth: '2026-01' })
  const tables = await loadTables(store)
  const rent = tables.rows.find((r) => r.name === 'Rent')!
  const salary = tables.rows.find((r) => r.name === 'Salary')!
  await setCellValue(store, salary.id, '2026-01', 4000_00, 'from-now-on')
  await setCellValue(store, rent.id, '2026-01', 1200_00, 'from-now-on')
  return { store, rent, salary }
}
const values = async (store: Store, rowId: string): Promise<number[]> => {
  const out = computeEngine({ tables: await loadTables(store), months })
  return months.map((m) => out.cells[cellKey(rowId, m)].value / 100)
}
/** The row's stored months, each as "month kind amount", with "!" for an amount that is its month's alone. */
const storedOf = async (store: Store, rowId: string): Promise<string[]> =>
  (await loadTables(store)).cells.filter((c) => c.rowId === rowId).sort((a, b) => (a.month < b.month ? -1 : 1))
    .map((c) => `${c.month.slice(5)} ${c.mode === 'value' ? (c.value ?? 0) / 100 : c.mode === 'items' ? `[${c.items.map((i) => (i.kind === 'carry' ? 'carry' : i.amount / 100)).join(' ')}]` : 'inherit'}${c.once ? '!' : ''}`)

describe('"Only this month" stays in its month', () => {
  it('writes one record, and Undo takes it back', async () => {
    const { store, rent } = await fresh()
    await setCellValue(store, rent.id, '2026-03', 1500_00, 'this-month')
    expect(await storedOf(store, rent.id)).toEqual(['01 1200', '03 1500!'])
    expect(await values(store, rent.id)).toEqual([1200, 1200, 1500, 1200, 1200, 1200])
    await store.undo()
    expect(await storedOf(store, rent.id)).toEqual(['01 1200'])
  })

  it('the month after it has nothing to clear, and clearing the exception brings the month back', async () => {
    const { store, rent } = await fresh()
    await setCellValue(store, rent.id, '2026-03', 1500_00, 'this-month')
    await clearCell(store, rent.id, '2026-04')
    expect(await values(store, rent.id)).toEqual([1200, 1200, 1500, 1200, 1200, 1200])
    await clearCell(store, rent.id, '2026-03')
    expect(await values(store, rent.id)).toEqual([1200, 1200, 1200, 1200, 1200, 1200])
  })

  it('an amount for this and following months, typed before it, replaces it and reaches past it', async () => {
    const { store, rent } = await fresh()
    await setCellValue(store, rent.id, '2026-03', 1500_00, 'this-month')
    await setCellValue(store, rent.id, '2026-02', 1250_00, 'from-now-on')
    // with the old amount written into April, April would have stayed at 1,200.00
    expect(await storedOf(store, rent.id)).toEqual(['01 1200', '02 1250', '03 inherit'])
    expect(await values(store, rent.id)).toEqual([1200, 1250, 1250, 1250, 1250, 1250])
  })

  it('once it is ticked as done it stays, and the months after it follow the new amount', async () => {
    const { store, rent } = await fresh()
    await setCellValue(store, rent.id, '2026-03', 1500_00, 'this-month')
    await setCellDone(store, rent.id, '2026-03', true)
    await setCellValue(store, rent.id, '2026-02', 1250_00, 'from-now-on')
    expect(await storedOf(store, rent.id)).toEqual(['01 1200', '02 1250', '03 [1500]!'])
    expect(await values(store, rent.id)).toEqual([1200, 1250, 1500, 1250, 1250, 1250])
  })

  it('made into an amount that runs on, it runs on', async () => {
    const { store, rent } = await fresh()
    await setCellValue(store, rent.id, '2026-03', 1500_00, 'this-month')
    await setCellValue(store, rent.id, '2026-03', 1500_00, 'from-now-on')
    expect(await storedOf(store, rent.id)).toEqual(['01 1200', '03 1500'])
    expect(await values(store, rent.id)).toEqual([1200, 1200, 1500, 1500, 1500, 1500])
  })

  it('as one item with its own certainty, and as a list with what the month carried', async () => {
    const { store, rent } = await fresh()
    await setCellItems(store, rent.id, '2026-03', [item(1500_00, { status: 'done' })], 'this-month')
    expect(await storedOf(store, rent.id)).toEqual(['01 1200', '03 [1500]!'])
    // "Chimney sweep" beside what April carries, for April alone
    const tables = await loadTables(store)
    const engine = computeEngine({ tables, months })
    const list = [...itemsFromCurrent(engine.cells[cellKey(rent.id, '2026-04')], 'cash', 'committed'), item(80_00, { label: 'Chimney sweep' })]
    await saveRowMonth(store, rent.id, '2026-04', { items: list, scope: 'this-month' })
    expect(await storedOf(store, rent.id)).toEqual(['01 1200', '03 [1500]!', '04 [carry 80]!'])
    expect(await values(store, rent.id)).toEqual([1200, 1200, 1500, 1280, 1200, 1200])
  })

  it('on a row that had no amount yet, the months after it stay without one, and nothing says "0.00" there', async () => {
    const { store, rent } = await fresh()
    await clearCell(store, rent.id, '2026-01')
    await setCellValue(store, rent.id, '2026-03', 990_00, 'this-month')
    expect(await storedOf(store, rent.id)).toEqual(['01 inherit', '03 990!'])
    const out = computeEngine({ tables: await loadTables(store), months })
    expect(months.map((m) => out.cells[cellKey(rent.id, m)].source)).toEqual(['empty', 'empty', 'value', 'empty', 'empty', 'empty'])
  })
})

describe('an exception in the month an amount began', () => {
  it('the amount that ran on from there begins in the month after', async () => {
    const { store, rent } = await fresh()
    await setCellValue(store, rent.id, '2026-03', 1250_00, 'from-now-on')
    await setCellValue(store, rent.id, '2026-03', 1300_00, 'this-month')
    expect(await storedOf(store, rent.id)).toEqual(['01 1200', '03 1300!', '04 1250'])
    expect(await values(store, rent.id)).toEqual([1200, 1200, 1300, 1250, 1250, 1250])
    await store.undo()
    expect(await storedOf(store, rent.id)).toEqual(['01 1200', '03 1250'])
  })

  it('nothing is written where the month after has an amount of its own', async () => {
    const { store, rent } = await fresh()
    await setCellValue(store, rent.id, '2026-03', 1250_00, 'from-now-on')
    await setCellValue(store, rent.id, '2026-04', 1400_00, 'from-now-on')
    await setCellValue(store, rent.id, '2026-03', 1300_00, 'this-month')
    expect(await storedOf(store, rent.id)).toEqual(['01 1200', '03 1300!', '04 1400'])
    expect(await values(store, rent.id)).toEqual([1200, 1200, 1300, 1400, 1400, 1400])
  })

  it('it goes past an exception that follows, to the first month with nothing of its own', async () => {
    const { store, rent } = await fresh()
    await setCellValue(store, rent.id, '2026-03', 1250_00, 'from-now-on')
    await setCellValue(store, rent.id, '2026-04', 1400_00, 'this-month')
    await setCellValue(store, rent.id, '2026-03', 1300_00, 'this-month')
    expect(await storedOf(store, rent.id)).toEqual(['01 1200', '03 1300!', '04 1400!', '05 1250'])
    expect(await values(store, rent.id)).toEqual([1200, 1200, 1300, 1400, 1250, 1250])
  })

  it('a carried item in a list on the way gets the amount it was carrying', async () => {
    const { store, rent } = await fresh()
    await setCellValue(store, rent.id, '2026-03', 1250_00, 'from-now-on')
    // April: what it carries plus 80.00, from April on
    const tables = await loadTables(store)
    const engine = computeEngine({ tables, months })
    await saveRowMonth(store, rent.id, '2026-04', { items: [...itemsFromCurrent(engine.cells[cellKey(rent.id, '2026-04')], 'cash', 'committed'), item(80_00)], scope: 'from-now-on' })
    expect(await values(store, rent.id)).toEqual([1200, 1200, 1250, 1330, 1330, 1330])
    await setCellValue(store, rent.id, '2026-03', 1300_00, 'this-month')
    expect(await storedOf(store, rent.id)).toEqual(['01 1200', '03 1300!', '04 [1250 80]'])
    expect(await values(store, rent.id)).toEqual([1200, 1200, 1300, 1330, 1330, 1330])
  })

  it('the same amount again, for this month only: the month becomes an exception and the amount still runs on after it', async () => {
    const { store, rent } = await fresh()
    await setCellValue(store, rent.id, '2026-03', 1250_00, 'from-now-on')
    await setCellValue(store, rent.id, '2026-03', 1250_00, 'this-month')
    expect(await storedOf(store, rent.id)).toEqual(['01 1200', '03 1250!', '04 1250'])
    expect(await values(store, rent.id)).toEqual([1200, 1200, 1250, 1250, 1250, 1250])
  })
})

describe('what the app writes for one month is that month\'s alone', () => {
  it('a tick on a month that only carried its amount', async () => {
    const { store, rent } = await fresh()
    await setCellDone(store, rent.id, '2026-02', true)
    expect(await storedOf(store, rent.id)).toEqual(['01 1200', '02 [1200]!'])
    // the amount typed for January changes: February stays as it was ticked, March follows January
    await setCellValue(store, rent.id, '2026-01', 1300_00, 'from-now-on')
    expect(await values(store, rent.id)).toEqual([1300, 1200, 1300, 1300, 1300, 1300])
  })

  it('a tick on the month an amount began leaves it the month the amount begins', async () => {
    const { store, rent } = await fresh()
    await setCellDone(store, rent.id, '2026-01', true)
    expect(await storedOf(store, rent.id)).toEqual(['01 [1200]'])
    expect(await values(store, rent.id)).toEqual([1200, 1200, 1200, 1200, 1200, 1200])
  })

  it('a top-up of a virtual account', async () => {
    const store = new Store(new CasaDb(`test-${newId()}`))
    await quickCreateHousehold(store, { name: 'Test', baseCurrency: 'EUR', locale: 'en-IE', startMonth: '2026-01' })
    const t = await loadTables(store)
    await setCellValue(store, t.rows.find((r) => r.name === 'Salary')!.id, '2026-01', 4000_00, 'from-now-on')
    const pool = await addPool(store, { name: 'Clothing', accountId: t.accounts.find((a) => a.type === 'savings')!.id, openingBalance: 0, monthlyAllocation: 100_00, fromMonth: '2026-01' })
    const rowId = pool.allocationRowId!
    await topUpPool(store, pool.id, '2026-03', { kind: 'income' }, 30_00)
    expect(await storedOf(store, rowId)).toEqual(['01 100', '03 [100 30]!'])
    expect(await values(store, rowId)).toEqual([100, 100, 130, 100, 100, 100])
    // in the month the amount began, what ran on from it is written into the month after
    await topUpPool(store, pool.id, '2026-01', { kind: 'income' }, 20_00)
    expect(await storedOf(store, rowId)).toEqual(['01 [100 20]!', '02 100', '03 [100 30]!'])
    expect(await values(store, rowId)).toEqual([120, 100, 130, 100, 100, 100])
  })

  it('a category\'s estimate for one month', async () => {
    const store = new Store(new CasaDb(`test-${newId()}`))
    await loadDemo(store)
    const row = await setCategoryEstimate(store, DEMO_IDS.catHousing, '2026-11', 2000_00)
    await setCategoryEstimate(store, DEMO_IDS.catHousing, '2026-12', 2500_00, 'this-month')
    expect(await storedOf(store, row.id)).toEqual(['11 2000', '12 2500!'])
    const out = computeEngine({ tables: await loadTables(store), months: monthRange('2026-09', '2027-02') })
    expect(['2026-11', '2026-12', '2027-01'].map((m) => out.cells[cellKey(row.id, m)].estimate)).toEqual([2000_00, 2500_00, 2000_00])
    // one month only for a category that had none: no "0.00" is written after it
    const living = await setCategoryEstimate(store, DEMO_IDS.catLiving, '2026-11', 1500_00, 'this-month')
    expect(await storedOf(store, living.id)).toEqual(['11 1500!'])
    expect(estimateRowOf(await loadTables(store), DEMO_IDS.catLiving)?.id).toBe(living.id)
  })

  it('a card\'s difference booked as spending', async () => {
    const store = new Store(new CasaDb(`test-${newId()}`))
    await loadDemo(store)
    const before = computeEngine({ tables: await loadTables(store), months: monthRange('2026-09', '2026-12') })
    const expected = before.accounts[DEMO_IDS.card].months['2026-10'].computed
    await setCardBalanceBooked(store, DEMO_IDS.card, '2026-10', expected + 400_00)
    const t = await loadTables(store)
    const row = t.rows.find((r) => r.name === unrecordedRowName(t.accounts.find((a) => a.id === DEMO_IDS.card)!))!
    expect(await storedOf(store, row.id)).toEqual(['10 [400]!'])
    const out = computeEngine({ tables: t, months: monthRange('2026-09', '2026-12') })
    expect(['2026-10', '2026-11', '2026-12'].map((m) => out.cells[cellKey(row.id, m)].value)).toEqual([400_00, 0, 0])
  })
})
