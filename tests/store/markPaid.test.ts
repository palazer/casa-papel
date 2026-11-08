import { describe, expect, it } from 'vitest'
import { cellKey, computeEngine } from '@/engine'
import { monthRange, newId, type CellItem } from '@/model'
import {
  CasaDb, Store, addRecurringItem, addRow, closeMonth, loadTables, markPaid, planRecurringPosts, postRecurring, quickCreateHousehold, setCellItems, setCellValue,
} from '@/store'

const months = monthRange('2026-01', '2026-04')

async function fresh() {
  const store = new Store(new CasaDb(`test-${newId()}`))
  await quickCreateHousehold(store, { name: 'Test', baseCurrency: 'EUR', locale: 'en-IE', startMonth: '2026-01' })
  const t = await loadTables(store)
  const pick = (name: string) => t.rows.find((r) => r.name === name)!
  return { store, rent: pick('Rent'), other: pick('Other'), toSavings: pick('To savings') }
}
const cellOf = async (store: Store, rowId: string, m: string) => computeEngine({ tables: await loadTables(store), months }).cells[cellKey(rowId, m)]
const valuesOf = async (store: Store, rowId: string) => Promise.all(months.map(async (m) => (await cellOf(store, rowId, m)).value))
const paid = (amount: number, over: Partial<Parameters<typeof markPaid>[4]> = {}) => ({ amount, status: 'done' as const, date: null, note: null, ...over })

describe('markPaid: the Paid sheet', () => {
  it('turns a single amount into one done item; later months stay as they were when the amount is unchanged', async () => {
    const { store, rent } = await fresh()
    await setCellValue(store, rent.id, '2026-01', 150000, 'from-now-on')
    await markPaid(store, rent.id, '2026-02', null, paid(150000, { date: '2026-02-03', note: 'at the bank' }))
    const feb = await cellOf(store, rent.id, '2026-02')
    expect(feb).toMatchObject({ source: 'items', status: 'done', value: 150000 })
    expect(feb.items).toHaveLength(1)
    expect(feb.items[0]).toMatchObject({ label: '', amount: 150000, status: 'done', date: '2026-02-03', note: 'at the bank' })
    expect(await cellOf(store, rent.id, '2026-03')).toMatchObject({ source: 'inherit', value: 150000, status: 'committed' })
    expect((await loadTables(store)).cells.find((c) => c.rowId === rent.id && c.month === '2026-03')).toBeUndefined()
  })

  it('a different amount changes this month only: the next month is frozen at what it showed', async () => {
    const { store, rent } = await fresh()
    await setCellValue(store, rent.id, '2026-01', 150000, 'from-now-on')
    await markPaid(store, rent.id, '2026-02', null, paid(99000))
    expect(await valuesOf(store, rent.id)).toEqual([150000, 99000, 150000, 150000])
    expect((await cellOf(store, rent.id, '2026-03')).source).toBe('value')
  })

  it('pays one item of an itemized cell and leaves the others alone; a cell with several items needs the item named', async () => {
    const { store, other } = await fresh()
    const gas: CellItem = { id: newId(), label: 'Gas', amount: 4000, status: 'committed', fundedBy: 'cash', date: null, note: null, recurringItemId: null, kind: 'normal', skipped: false }
    const water: CellItem = { ...gas, id: newId(), label: 'Water', amount: 2500 }
    await setCellItems(store, other.id, '2026-01', [gas, water])
    await markPaid(store, other.id, '2026-01', water.id, paid(2600, { date: '2026-01-15' }))
    const jan = await cellOf(store, other.id, '2026-01')
    expect(jan.items.map((i) => [i.label, i.amount, i.status])).toEqual([['Gas', 4000, 'committed'], ['Water', 2600, 'done']])
    expect(jan).toMatchObject({ status: 'committed', value: 6600 })
    // February was following January's 6,500 and keeps it
    expect(await cellOf(store, other.id, '2026-02')).toMatchObject({ source: 'value', value: 6500 })
    await expect(markPaid(store, other.id, '2026-01', null, paid(1))).rejects.toThrow(/several items/)
    await expect(markPaid(store, other.id, '2026-01', newId(), paid(1))).rejects.toThrow(/gone/)
  })

  it('a scheduled payment with a new amount is pinned; the schedule posts its own amount elsewhere and no month is frozen', async () => {
    const { store } = await fresh()
    const util = await addRow(store, { name: 'Utilities', section: 'expense' })
    const item = await addRecurringItem(store, { name: 'Utilities', rowId: util.id, amount: 21000, cadence: { intervalMonths: 1, anchorMonth: 1 }, startMonth: '2026-01' })
    await postRecurring(store, months)
    const posted = (await cellOf(store, util.id, '2026-02')).items[0]
    await markPaid(store, util.id, '2026-02', posted.id, paid(19900, { date: '2026-02-10' }))
    expect((await cellOf(store, util.id, '2026-02')).items[0]).toMatchObject({ recurringItemId: item.id, amount: 19900, status: 'done', pinned: true })
    expect(await valuesOf(store, util.id)).toEqual([21000, 19900, 21000, 21000])
    const tables = await loadTables(store)
    expect(planRecurringPosts(tables, months)).toEqual([])
    expect(tables.cells.find((c) => c.rowId === util.id && c.month === '2026-03')?.mode).toBe('items')
  })

  it('a quarterly schedule paid in its month leaves no phantom amount in the month after', async () => {
    const { store } = await fresh()
    const ins = await addRow(store, { name: 'Car insurance', section: 'expense' })
    await addRecurringItem(store, { name: 'Car insurance', rowId: ins.id, amount: 21000, cadence: { intervalMonths: 3, anchorMonth: 1 }, startMonth: '2026-01' })
    await postRecurring(store, months)
    const jan = (await cellOf(store, ins.id, '2026-01')).items[0]
    await markPaid(store, ins.id, '2026-01', jan.id, paid(20500))
    expect(await valuesOf(store, ins.id)).toEqual([20500, 0, 0, 21000])
    expect((await loadTables(store)).cells.find((c) => c.rowId === ins.id && c.month === '2026-02')).toBeUndefined()
  })

  it('an empty row paid for the first time starts carrying forward like any entry', async () => {
    const { store, other } = await fresh()
    await markPaid(store, other.id, '2026-02', null, paid(5000))
    expect(await valuesOf(store, other.id)).toEqual([0, 5000, 5000, 5000])
    expect((await cellOf(store, other.id, '2026-03')).status).toBe('projected')
  })

  it('does nothing when nothing changed, and refuses closed months and automatic rows', async () => {
    const { store, rent, toSavings } = await fresh()
    await setCellValue(store, rent.id, '2026-01', 150000, 'from-now-on')
    await markPaid(store, rent.id, '2026-01', null, paid(150000))
    const before = JSON.stringify((await loadTables(store)).cells)
    const version = store.getVersion()
    await markPaid(store, rent.id, '2026-01', null, paid(150000))
    expect(JSON.stringify((await loadTables(store)).cells)).toBe(before)
    expect(store.getVersion()).toBe(version)
    await closeMonth(store, '2026-01')
    await expect(markPaid(store, rent.id, '2026-01', null, paid(1))).rejects.toThrow(/closed/)
    await expect(markPaid(store, toSavings.id, '2026-02', null, paid(1))).rejects.toThrow(/Tick it instead/)
  })
})
