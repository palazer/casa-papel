import { describe, expect, it } from 'vitest'
import { cellKey, computeEngine } from '@/engine'
import { monthRange, newId, type CellItem, type MonthKey } from '@/model'
import {
  CasaDb, Store, addRecurringItem, addRow, cellPut, keepDigits, loadTables, quickCreateHousehold, rowCurrencyOf, saveRowMonth, setCellDone, setCellItems, setCellValue, updateRow,
} from '@/store'

/**
 * A row that moves to a currency counting other decimals keeps its digits (finding F13). An amount is stored in its
 * currency's smallest unit: 1,000.00 euros are 100000 cents, and read as Icelandic krónur, which have no cents, the
 * same number would be 100,000 kr. Of the fifteen currencies offered only the króna differs.
 */
const months = monthRange('2026-01', '2026-06')
const item = (amount: number, over: Partial<CellItem> = {}): CellItem =>
  ({ id: newId(), label: '', amount, status: 'committed', fundedBy: 'cash', date: null, note: null, recurringItemId: null, kind: 'normal', skipped: false, ...over })

/** "House" is 1,000.00 from January and 1,200.00 from April. */
async function fresh() {
  const store = new Store(new CasaDb(`test-${newId()}`))
  await quickCreateHousehold(store, { name: 'Test', baseCurrency: 'EUR', locale: 'en-IE', startMonth: '2026-01' })
  const house = await addRow(store, { name: 'House', section: 'expense', categoryId: null })
  await setCellValue(store, house.id, '2026-01', 1000_00, 'from-now-on')
  await setCellValue(store, house.id, '2026-04', 1200_00, 'from-now-on')
  return { store, house }
}

/** The row's amounts as the calculation reads them, in the smallest unit of the currency each month is in. */
async function values(store: Store, rowId: string): Promise<number[]> {
  const out = computeEngine({ tables: await loadTables(store), months })
  return months.map((m) => out.cells[cellKey(rowId, m)].value)
}
const currencyIn = async (store: Store, rowId: string, month: MonthKey) =>
  computeEngine({ tables: await loadTables(store), months }).cells[cellKey(rowId, month)].currency

describe('the row menu\'s "Currency…"', () => {
  it('keeps the digits of every month when the new currency has no cents', async () => {
    const { store, house } = await fresh()
    await updateRow(store, house.id, { currency: 'ISK' })
    expect(await values(store, house.id)).toEqual([1000, 1000, 1000, 1200, 1200, 1200])
    expect(await currencyIn(store, house.id, '2026-02')).toBe('ISK')
  })

  it('and back: a currency with cents gets its two zeros', async () => {
    const { store, house } = await fresh()
    await updateRow(store, house.id, { currency: 'ISK' })
    await updateRow(store, house.id, { currency: null })
    expect(await values(store, house.id)).toEqual([1000_00, 1000_00, 1000_00, 1200_00, 1200_00, 1200_00])
  })

  it('writes nothing but the row between two currencies that count the same decimals', async () => {
    const { store, house } = await fresh()
    const before = (await loadTables(store)).cells.filter((c) => c.rowId === house.id)
    await updateRow(store, house.id, { currency: 'USD' })
    expect((await loadTables(store)).cells.filter((c) => c.rowId === house.id)).toEqual(before)
    expect(await values(store, house.id)).toEqual([1000_00, 1000_00, 1000_00, 1200_00, 1200_00, 1200_00])
  })

  it('is one step: one Undo brings back the currency and every amount', async () => {
    const { store, house } = await fresh()
    await updateRow(store, house.id, { currency: 'ISK' })
    await store.undo()
    expect(await values(store, house.id)).toEqual([1000_00, 1000_00, 1000_00, 1200_00, 1200_00, 1200_00])
    expect(await currencyIn(store, house.id, '2026-02')).toBe('EUR')
  })

  it('rounds where the new currency cannot hold the cents', async () => {
    const { store, house } = await fresh()
    await setCellValue(store, house.id, '2026-04', 1200_50, 'from-now-on')
    await updateRow(store, house.id, { currency: 'ISK' })
    expect((await values(store, house.id))[3]).toBe(1201)
  })

  it('reaches items, a ticked month and the row\'s schedules', async () => {
    const { store, house } = await fresh()
    await setCellItems(store, house.id, '2026-02', [item(300_00, { label: 'Roof' }), item(50_00, { label: 'Paint' })], 'this-month')
    await setCellDone(store, house.id, '2026-03', true)
    const cabin = await addRow(store, { name: 'Cabin', section: 'expense', categoryId: null })
    await addRecurringItem(store, { name: 'Caretaker', rowId: cabin.id, amount: 250_00, startMonth: '2026-01', cadence: { intervalMonths: 1, anchorMonth: 1 } })
    await updateRow(store, house.id, { currency: 'ISK' })
    await updateRow(store, cabin.id, { currency: 'ISK' })
    expect(await values(store, house.id)).toEqual([1000, 350, 1000, 1200, 1200, 1200])
    const tables = await loadTables(store)
    expect(tables.cells.find((c) => c.rowId === house.id && c.month === '2026-03')?.items.map((i) => [i.amount, i.status])).toEqual([[1000, 'done']])
    expect(tables.recurringItems.find((r) => r.name === 'Caretaker')?.amount).toBe(250)
    expect(await values(store, cabin.id)).toEqual([250, 250, 250, 250, 250, 250])
  })

  it('leaves a month that keeps a currency of its own', async () => {
    const { store, house } = await fresh()
    const tables = await loadTables(store)
    const april = tables.cells.find((c) => c.rowId === house.id && c.month === '2026-04')
    await store.commit([cellPut(april, { rowId: house.id, month: '2026-04', currencyOverride: 'USD' }, Date.now())])
    const moved = keepDigits(await loadTables(store), house.id, 'ISK', 1)
    expect(moved.mutations.map((m) => (m.op === 'put' && m.table === 'cells' ? m.record.month : '?'))).toEqual(['2026-01'])
    expect(moved.tables.cells.find((c) => c.rowId === house.id && c.month === '2026-04')?.value).toBe(1200_00)
    expect(rowCurrencyOf(moved.tables, house.id)).toBe('ISK')
  })
})

describe('the currency field in the row\'s dialog, saved with the month', () => {
  it('a currency change alone replaces nothing in the later months', async () => {
    const { store, house } = await fresh()
    // February carries 1,000.00; the dialog shows those digits and saves them as 1,000 kr for this and following months
    await setCellValue(store, house.id, '2026-02', 1000, 'from-now-on', { currency: 'ISK' })
    expect(await values(store, house.id)).toEqual([1000, 1000, 1000, 1200, 1200, 1200])
  })

  it('a new amount typed with it replaces the later months, as it always does', async () => {
    const { store, house } = await fresh()
    await setCellValue(store, house.id, '2026-02', 1500, 'from-now-on', { currency: 'ISK' })
    expect(await values(store, house.id)).toEqual([1000, 1500, 1500, 1500, 1500, 1500])
  })

  it('only this month: the month after goes on with what it had, in the new unit', async () => {
    const { store, house } = await fresh()
    await setCellValue(store, house.id, '2026-02', 1500, 'this-month', { currency: 'ISK' })
    expect(await values(store, house.id)).toEqual([1000, 1500, 1000, 1200, 1200, 1200])
  })

  it('is one step for Undo', async () => {
    const { store, house } = await fresh()
    await setCellValue(store, house.id, '2026-02', 1000, 'from-now-on', { currency: 'ISK' })
    await store.undo()
    expect(await values(store, house.id)).toEqual([1000_00, 1000_00, 1000_00, 1200_00, 1200_00, 1200_00])
    expect(await currencyIn(store, house.id, '2026-01')).toBe('EUR')
  })

  it('a list of items: the other months and a schedule keep their digits, and an untouched scheduled item is not taken for an edit', async () => {
    const store = new Store(new CasaDb(`test-${newId()}`))
    await quickCreateHousehold(store, { name: 'Test', baseCurrency: 'EUR', locale: 'en-IE', startMonth: '2026-01' })
    const cabin = await addRow(store, { name: 'Cabin', section: 'expense', categoryId: null })
    await addRecurringItem(store, { name: 'Caretaker', rowId: cabin.id, amount: 250_00, startMonth: '2026-01', cadence: { intervalMonths: 1, anchorMonth: 1 } })
    const march = (await loadTables(store)).cells.find((c) => c.rowId === cabin.id && c.month === '2026-03')!
    // the dialog rescales what it shows when the currency is picked, and saves the list as it stands
    const shown = march.items.map((i) => ({ ...i, amount: i.amount / 100 }))
    await saveRowMonth(store, cabin.id, '2026-03', { items: [...shown, item(40, { label: 'Firewood' })], scope: 'this-month', row: { currency: 'ISK' } })
    expect(await values(store, cabin.id)).toEqual([250, 250, 290, 250, 250, 250])
    const tables = await loadTables(store)
    expect(tables.recurringItems.filter((r) => !r.deletedAt && r.rowId === cabin.id).map((r) => r.amount)).toEqual([250])
    expect(tables.cells.find((c) => c.rowId === cabin.id && c.month === '2026-03')?.items.find((i) => i.recurringItemId)?.pinned ?? false).toBe(false)
  })
})

describe('the currency a form reads a row\'s amount in', () => {
  it("is the row's own, or the household's", async () => {
    const { store, house } = await fresh()
    expect(rowCurrencyOf(await loadTables(store), house.id)).toBe('EUR')
    await updateRow(store, house.id, { currency: 'ISK' })
    expect(rowCurrencyOf(await loadTables(store), house.id)).toBe('ISK')
    expect(rowCurrencyOf(await loadTables(store), 'no-such-row')).toBe('EUR')
  })
})
