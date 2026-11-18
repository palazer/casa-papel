import { describe, expect, it } from 'vitest'
import { CellSchema, newId, type Cell, type CellItem, type Conversion, type MonthKey } from '@/model'
import {
  CasaDb, Store, addRecurringItem, addRow, cellPut, clearCell, deleteRecurringItem, exportSnapshot, importMerge, importReplace, keepHouse, loadTables, parseExportFile,
  quickCreateHousehold, saveRowMonth, setCellDone, setCellItems, setCellValue, setItemStatus, setMonthBalances, setRecurringPaid, setRowFundedBy, skipRecurringMonth, wipeAll,
} from '@/store'
import { legacyClose } from '../legacyClose'

/**
 * An amount in another currency can carry the conversion that was recorded for it (`CellItem.conversion`, rule X10).
 * Nothing in this version sets it by a click that these tests could make, so they plant it; what they check is that
 * whatever writes that month afterwards leaves it on its item. A writer that dropped it would let the month's rate
 * count again where the user had recorded what really happened.
 */
const salary: Conversion = { foreign: 'USD', foreignAmount: 3300_00, homeAmount: 3000_00, rate: 1.1, date: '2026-03-30' }
const item = (amount: number, over: Partial<CellItem> = {}): CellItem =>
  ({ id: newId(), label: '', amount, status: 'committed', fundedBy: 'cash', date: null, note: null, recurringItemId: null, kind: 'normal', skipped: false, ...over })

/** "Pay" is 3,300.00 dollars a month from January; March's was recorded as 3,000.00 euros. As an expense, it is rent paid in dollars. */
async function fresh(section: 'income' | 'expense' = 'income') {
  const store = new Store(new CasaDb(`test-${newId()}`))
  await quickCreateHousehold(store, { name: 'Test', baseCurrency: 'EUR', locale: 'en-IE', startMonth: '2026-01' })
  const pay = await addRow(store, { name: 'Pay', section, categoryId: null })
  await setCellValue(store, pay.id, '2026-01', 3300_00, 'from-now-on', { currency: 'USD' })
  const recorded = item(3300_00, { status: 'done', conversion: salary })
  await store.commit([cellPut(undefined, { rowId: pay.id, month: '2026-03', mode: 'items', items: [recorded] }, Date.now())])
  return { store, pay, recorded }
}

const stored = async (store: Store, rowId: string, month: MonthKey): Promise<Cell | undefined> =>
  (await loadTables(store)).cells.find((c) => c.rowId === rowId && c.month === month)
/** The conversions March holds, item by item. */
const marchConversions = async (store: Store, rowId: string) => (await stored(store, rowId, '2026-03'))?.items.map((i) => i.conversion ?? null)

describe('a recorded conversion stays on its item, whatever writes its month', () => {
  it('as planted', async () => {
    const { store, pay } = await fresh()
    expect(await marchConversions(store, pay.id)).toEqual([salary])
  })

  it('the tick on the line taken back, and set again', async () => {
    const { store, pay } = await fresh()
    await setCellDone(store, pay.id, '2026-03', false)
    // the item goes back to the row's usual certainty, an estimate for this row
    expect(await stored(store, pay.id, '2026-03')).toMatchObject({ items: [{ status: 'projected', conversion: salary }] })
    await setCellDone(store, pay.id, '2026-03', true)
    expect(await stored(store, pay.id, '2026-03')).toMatchObject({ items: [{ status: 'done', conversion: salary }] })
  })

  it('the item\'s own certainty', async () => {
    const { store, pay, recorded } = await fresh()
    await setItemStatus(store, pay.id, '2026-03', recorded.id, 'projected')
    expect(await stored(store, pay.id, '2026-03')).toMatchObject({ items: [{ status: 'projected', conversion: salary }] })
  })

  it('"Count everything in March as done", with the item set back to Certain first', async () => {
    const { store, pay, recorded } = await fresh()
    await setItemStatus(store, pay.id, '2026-03', recorded.id, 'committed')
    await setMonthBalances(store, '2026-03', {}, { done: true })
    expect(await stored(store, pay.id, '2026-03')).toMatchObject({ items: [{ status: 'done', conversion: salary }] })
  })

  it('the app\'s own pass over a month an older version had closed', async () => {
    const { store, pay } = await fresh()
    await legacyClose(store, '2026-03')
    await keepHouse(store)
    expect(await marchConversions(store, pay.id)).toEqual([salary])
  })

  it('a new source for the row from May on: the earlier months are written down with the old one', async () => {
    const { store, pay } = await fresh('expense')
    await setRowFundedBy(store, pay.id, 'savings', { from: '2026-05' })
    expect(await marchConversions(store, pay.id)).toEqual([salary])
  })

  it('a new amount for this and following months from January: the ticked March stays as it is', async () => {
    const { store, pay } = await fresh()
    await setCellValue(store, pay.id, '2026-01', 3500_00, 'from-now-on', { currency: 'USD' })
    expect(await stored(store, pay.id, '2026-03')).toMatchObject({ items: [{ amount: 3300_00, conversion: salary }] })
  })

  it('a schedule that lands in the month, is paid, left out, back, and taken away again', async () => {
    const { store, pay } = await fresh()
    const bonus = await addRecurringItem(store, { name: 'Bonus', rowId: pay.id, amount: 200_00, startMonth: '2026-03', cadence: { intervalMonths: 1, anchorMonth: 1 } })
    expect(await marchConversions(store, pay.id)).toEqual([salary, null])
    await setRecurringPaid(store, bonus.id, '2026-03', true)
    await setRecurringPaid(store, bonus.id, '2026-03', false)
    await skipRecurringMonth(store, bonus.id, '2026-03', true)
    await skipRecurringMonth(store, bonus.id, '2026-03', false)
    expect(await marchConversions(store, pay.id)).toEqual([salary, null])
    await deleteRecurringItem(store, bonus.id)
    expect(await marchConversions(store, pay.id)).toEqual([salary])
  })

  it('the row\'s dialog: a list saved with the item as it stands, and one more item beside it', async () => {
    const { store, pay } = await fresh()
    const march = (await stored(store, pay.id, '2026-03'))!
    await setCellItems(store, pay.id, '2026-03', [{ ...march.items[0], amount: 3520_00 }], 'this-month')
    expect(await stored(store, pay.id, '2026-03')).toMatchObject({ items: [{ amount: 3520_00, conversion: salary }] })
    const now = (await stored(store, pay.id, '2026-03'))!
    await saveRowMonth(store, pay.id, '2026-03', { items: [...now.items, item(50_00, { label: 'Expenses back' })], scope: 'this-month' })
    expect(await marchConversions(store, pay.id)).toEqual([salary, null])
  })
})

describe('where a conversion goes with its amount', () => {
  it('"Clear" takes it with the amount, and Undo brings both back', async () => {
    const { store, pay } = await fresh()
    await clearCell(store, pay.id, '2026-03')
    expect((await stored(store, pay.id, '2026-03'))?.items ?? []).toEqual([])
    await store.undo()
    expect(await marchConversions(store, pay.id)).toEqual([salary])
  })

  it('an item removed from the list takes its conversion with it', async () => {
    const { store, pay } = await fresh()
    await setCellItems(store, pay.id, '2026-03', [item(3300_00, { status: 'done' })], 'this-month')
    expect(await marchConversions(store, pay.id)).toEqual([null])
  })
})

describe('a recorded conversion travels with the household', () => {
  it('export, wipe, import', async () => {
    const { store, pay } = await fresh()
    const file = parseExportFile(JSON.parse(JSON.stringify(await exportSnapshot(store))))
    await wipeAll(store)
    await importReplace(store, file)
    expect(await marchConversions(store, pay.id)).toEqual([salary])
  })

  it('merged into another device\'s copy', async () => {
    const { store, pay } = await fresh()
    const other = new Store(new CasaDb(`test-${newId()}`))
    await importMerge(other, parseExportFile(JSON.parse(JSON.stringify(await exportSnapshot(store)))))
    expect(await marchConversions(other, pay.id)).toEqual([salary])
  })

  it('a month stored before schema 18 reads as one without a conversion', () => {
    const old = { rowId: newId(), month: '2026-03', mode: 'items', value: null, items: [{ id: newId(), label: '', amount: 5, status: 'done' }], note: null, currencyOverride: null, markedDone: false, updatedAt: 1 }
    const cell = CellSchema.parse(old)
    expect(cell.items[0].conversion ?? null).toBeNull()
    expect('conversion' in cell.items[0]).toBe(false)
  })
})
