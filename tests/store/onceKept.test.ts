import { describe, expect, it } from 'vitest'
import { cellKey, computeEngine } from '@/engine'
import { RowSchema, monthRange, newId, type Cell, type CellItem, type MonthKey } from '@/model'
import {
  CasaDb, Store, addPool, addRecurringItem, addRow, archiveRow, cellPut, cellRecord, clearCell, deleteRecurringItem, keepHouse, loadTables, quickCreateHousehold,
  setCellDone, setCellValue, setDerivedDone, setItemStatus, setMonthBalances, setRecurringPaid, setRowFundedBy, setRule, skipRecurringMonth, topUpPool,
} from '@/store'
import { legacyClose } from '../legacyClose'

/**
 * An amount that is its month's alone carries a mark (`Cell.once`). Nothing in the app sets it by a click that these
 * tests could make, so they plant it; what they check is that whatever writes that month afterwards leaves the mark
 * where it is. A writer that dropped it would turn the exception into an amount that runs on: the month after it,
 * here always 1,200.00, would show the exception's amount instead.
 */
const months = monthRange('2026-01', '2026-06')
const item = (amount: number, over: Partial<CellItem> = {}): CellItem =>
  ({ id: newId(), label: '', amount, status: 'committed', fundedBy: 'cash', date: null, note: null, recurringItemId: null, kind: 'normal', skipped: false, ...over })

/** Rent is 1,200.00 from January; March is 1,500.00 for March alone. */
async function fresh(march: Partial<Cell> = { mode: 'value', value: 1500_00 }) {
  const store = new Store(new CasaDb(`test-${newId()}`))
  await quickCreateHousehold(store, { name: 'Test', baseCurrency: 'EUR', locale: 'en-IE', startMonth: '2026-01' })
  const tables = await loadTables(store)
  const rent = tables.rows.find((r) => r.name === 'Rent')!
  const salary = tables.rows.find((r) => r.name === 'Salary')!
  await setCellValue(store, salary.id, '2026-01', 4000_00, 'from-now-on')
  await setCellValue(store, rent.id, '2026-01', 1200_00, 'from-now-on')
  await store.commit([cellPut(undefined, { rowId: rent.id, month: '2026-03', ...march, once: true }, Date.now())])
  return { store, rent, salary }
}

async function values(store: Store, rowId: string): Promise<number[]> {
  const out = computeEngine({ tables: await loadTables(store), months })
  return months.map((m) => out.cells[cellKey(rowId, m)].value / 100)
}
const stored = async (store: Store, rowId: string, month: MonthKey): Promise<Cell | undefined> =>
  (await loadTables(store)).cells.find((c) => c.rowId === rowId && c.month === month)

const AS_PLANTED = [1200, 1200, 1500, 1200, 1200, 1200]

describe('a month\'s record is built from what is stored', () => {
  it('what the writer does not name stays: note, own currency, the tick, the mark', () => {
    const rowId = newId()
    const before = cellRecord(undefined, { rowId, month: '2026-03', mode: 'value', value: 5, note: 'n', currencyOverride: 'USD', markedDone: true, once: true }, 1)
    const after = cellRecord(before, { rowId, month: '2026-03', mode: 'items', value: null, items: [item(7)] }, 2)
    expect(after).toMatchObject({ mode: 'items', value: null, note: 'n', currencyOverride: 'USD', markedDone: true, once: true, updatedAt: 2 })
    expect(after.items).toHaveLength(1)
  })

  it('a month that goes back to inheriting loses the mark, whoever asks', () => {
    const rowId = newId()
    const before = cellRecord(undefined, { rowId, month: '2026-03', mode: 'value', value: 5, once: true }, 1)
    expect(cellRecord(before, { rowId, month: '2026-03', mode: 'inherit', value: null, items: [] }, 2).once).toBe(false)
    expect(cellRecord(before, { rowId, month: '2026-03', mode: 'inherit', value: null, items: [], once: true }, 2).once).toBe(false)
  })

  it('a stored record from before the mark existed gets it as "no"', () => {
    const rowId = newId()
    const old = { rowId, month: '2026-03', mode: 'value', value: 5, items: [], note: null, currencyOverride: null, markedDone: false, updatedAt: 1 } as unknown as Cell
    expect(cellRecord(old, { rowId, month: '2026-03', note: 'x' }, 2)).toMatchObject({ value: 5, note: 'x', once: false })
  })
})

describe('an exception stays an exception, whatever writes its month', () => {
  it('as planted: March shows its own amount, April goes on with January\'s', async () => {
    const { store, rent } = await fresh()
    expect(await values(store, rent.id)).toEqual(AS_PLANTED)
    expect(await stored(store, rent.id, '2026-03')).toMatchObject({ mode: 'value', value: 1500_00, once: true })
  })

  it('ticking the line as done, and unticking it', async () => {
    const { store, rent } = await fresh()
    await setCellDone(store, rent.id, '2026-03', true)
    expect(await stored(store, rent.id, '2026-03')).toMatchObject({ mode: 'items', once: true })
    expect(await values(store, rent.id)).toEqual(AS_PLANTED)
    await setCellDone(store, rent.id, '2026-03', false)
    expect(await stored(store, rent.id, '2026-03')).toMatchObject({ mode: 'items', once: true })
    expect(await values(store, rent.id)).toEqual(AS_PLANTED)
  })

  it('ticking one item of it', async () => {
    const one = item(1500_00)
    const { store, rent } = await fresh({ mode: 'items', value: null, items: [one] })
    await setItemStatus(store, rent.id, '2026-03', one.id, 'done')
    expect(await stored(store, rent.id, '2026-03')).toMatchObject({ once: true, items: [{ status: 'done' }] })
    expect(await values(store, rent.id)).toEqual(AS_PLANTED)
  })

  it('"Count everything in March as done"', async () => {
    const { store, rent } = await fresh()
    await setMonthBalances(store, '2026-03', {}, { done: true })
    expect(await stored(store, rent.id, '2026-03')).toMatchObject({ mode: 'items', once: true, items: [{ status: 'done', amount: 1500_00 }] })
    expect(await values(store, rent.id)).toEqual(AS_PLANTED)
  })

  it('the app\'s own pass over a month an older version had closed (a step nobody can undo)', async () => {
    const { store, rent } = await fresh()
    await legacyClose(store, '2026-03')
    await keepHouse(store)
    expect(await stored(store, rent.id, '2026-03')).toMatchObject({ once: true, items: [{ status: 'done', amount: 1500_00 }] })
    expect(await values(store, rent.id)).toEqual(AS_PLANTED)
  })

  it('a new source for the row "from May on": the earlier months are written down with the old source', async () => {
    const { store, rent } = await fresh()
    await setRowFundedBy(store, rent.id, 'savings', { from: '2026-05' })
    const t = await loadTables(store)
    const march = t.cells.find((c) => c.rowId === rent.id && c.month === '2026-03')!
    expect(march).toMatchObject({ mode: 'items', once: true, items: [{ amount: 1500_00, fundedBy: 'cash' }] })
    // April only carried: its amount is written down too, as an amount of the usual kind
    expect(t.cells.find((c) => c.rowId === rent.id && c.month === '2026-04')).toMatchObject({ mode: 'items', once: false, items: [{ amount: 1200_00, fundedBy: 'cash' }] })
    expect(await values(store, rent.id)).toEqual(AS_PLANTED)
  })

  it('a schedule that lands in the month and is taken away again', async () => {
    const { store, rent } = await fresh({ mode: 'items', value: null, items: [item(1500_00)] })
    // the row goes on a schedule from March: the pass adds its item to March's list, and the row stops carrying
    const schedule = await addRecurringItem(store, { name: 'Parking', rowId: rent.id, amount: 80_00, startMonth: '2026-03', cadence: { intervalMonths: 1, anchorMonth: 1 } })
    expect(await stored(store, rent.id, '2026-03')).toMatchObject({ once: true, items: [{ amount: 1500_00 }, { amount: 80_00, recurringItemId: schedule.id }] })
    expect(await values(store, rent.id)).toEqual([1200, 1200, 1580, 80, 80, 80])
    // paid, left out, and back again: each rewrites the month's list
    await setRecurringPaid(store, schedule.id, '2026-03', true)
    expect((await stored(store, rent.id, '2026-03'))?.once).toBe(true)
    await setRecurringPaid(store, schedule.id, '2026-03', false)
    await skipRecurringMonth(store, schedule.id, '2026-03', true)
    expect((await stored(store, rent.id, '2026-03'))?.once).toBe(true)
    await skipRecurringMonth(store, schedule.id, '2026-03', false)
    // without its last schedule the row is an ordinary row again, and the months it had posted to are left as empty lists
    await deleteRecurringItem(store, schedule.id)
    expect(await stored(store, rent.id, '2026-03')).toMatchObject({ once: true, items: [{ amount: 1500_00 }] })
    expect(await values(store, rent.id)).toEqual([1200, 1200, 1500, 0, 0, 0])
    // every month the row holds is its own now (finding F11): a month that is cleared shows nothing, not March's amount
    await clearCell(store, rent.id, '2026-04')
    expect(await values(store, rent.id)).toEqual([1200, 1200, 1500, 0, 0, 0])
  })

  it('a top-up of a virtual account whose month is an exception', async () => {
    const store = new Store(new CasaDb(`test-${newId()}`))
    await quickCreateHousehold(store, { name: 'Test', baseCurrency: 'EUR', locale: 'en-IE', startMonth: '2026-01' })
    let t = await loadTables(store)
    await setCellValue(store, t.rows.find((r) => r.name === 'Salary')!.id, '2026-01', 4000_00, 'from-now-on')
    const pool = await addPool(store, { name: 'Clothing', accountId: t.accounts.find((a) => a.type === 'savings')!.id, openingBalance: 0, monthlyAllocation: 100_00, fromMonth: '2026-01' })
    t = await loadTables(store)
    const setAside = t.rows.find((r) => r.id === pool.allocationRowId)!
    await store.commit([cellPut(undefined, { rowId: setAside.id, month: '2026-03', mode: 'value', value: 150_00, once: true }, Date.now())])
    expect(await values(store, setAside.id)).toEqual([100, 100, 150, 100, 100, 100])
    await topUpPool(store, pool.id, '2026-03', { kind: 'income' }, 30_00)
    expect(await stored(store, setAside.id, '2026-03')).toMatchObject({ mode: 'items', once: true })
    expect(await values(store, setAside.id)).toEqual([100, 100, 180, 100, 100, 100])
  })

  it('a row that followed this one keeps the exception as one, when this row is archived', async () => {
    const { store, rent } = await fresh()
    // a quarter of the rent, paid back by a flatmate
    const share = await addRow(store, RowSchema.parse({ id: newId(), createdAt: 0, updatedAt: 0, name: 'Flatmate', section: 'income', followsRowId: rent.id, followShare: 0.25 }))
    expect(await values(store, share.id)).toEqual([300, 300, 375, 300, 300, 300])
    await archiveRow(store, rent.id, '2026-04')
    const t = await loadTables(store)
    expect(t.rows.find((r) => r.id === share.id)?.followsRowId ?? null).toBeNull()
    expect(t.cells.filter((c) => c.rowId === share.id).map((c) => [c.month, c.value, c.once])).toEqual([['2026-01', 300_00, false], ['2026-02', 300_00, false], ['2026-03', 375_00, true]])
    // on its own from April, it goes on with what it had before the exception
    expect(await values(store, share.id)).toEqual([300, 300, 375, 300, 300, 300])
  })

  it('the tick on an automatic amount beside it', async () => {
    const { store, rent } = await fresh()
    await setDerivedDone(store, rent.id, '2026-03', true)
    expect(await stored(store, rent.id, '2026-03')).toMatchObject({ mode: 'value', value: 1500_00, markedDone: true, once: true })
    expect(await values(store, rent.id)).toEqual(AS_PLANTED)
  })
})

describe('where the exception goes with the amount', () => {
  it('"Clear" takes the amount and the mark: the month carries again', async () => {
    const { store, rent } = await fresh()
    await clearCell(store, rent.id, '2026-03')
    expect(await stored(store, rent.id, '2026-03')).toMatchObject({ mode: 'inherit', once: false })
    expect(await values(store, rent.id)).toEqual([1200, 1200, 1200, 1200, 1200, 1200])
    await store.undo()
    expect(await stored(store, rent.id, '2026-03')).toMatchObject({ mode: 'value', value: 1500_00, once: true })
    expect(await values(store, rent.id)).toEqual(AS_PLANTED)
  })

  it('a rule from April on: March keeps its exception, a later one is the rule\'s month now', async () => {
    const store = new Store(new CasaDb(`test-${newId()}`))
    await quickCreateHousehold(store, { name: 'Test', baseCurrency: 'EUR', locale: 'en-IE', startMonth: '2026-01' })
    let t = await loadTables(store)
    await setCellValue(store, t.rows.find((r) => r.name === 'Salary')!.id, '2026-01', 4000_00, 'from-now-on')
    const pool = await addPool(store, { name: 'Clothing', accountId: t.accounts.find((a) => a.type === 'savings')!.id, openingBalance: 0, monthlyAllocation: 100_00, fromMonth: '2026-01' })
    const rowId = pool.allocationRowId!
    await store.commit([
      cellPut(undefined, { rowId, month: '2026-03', mode: 'value', value: 150_00, once: true }, Date.now()),
      cellPut(undefined, { rowId, month: '2026-05', mode: 'value', value: 170_00, once: true }, Date.now()),
    ])
    expect(await values(store, rowId)).toEqual([100, 100, 150, 100, 170, 100])
    // 120.00 a month from April: what was typed from April on is replaced
    await setRule(store, { poolId: pool.id }, { kind: 'fixed', amount: 120_00 }, '2026-04')
    t = await loadTables(store)
    expect(t.cells.filter((c) => c.rowId === rowId).map((c) => [c.month, c.mode, c.value, c.once])).toEqual([
      ['2026-01', 'value', 100_00, false], ['2026-03', 'value', 150_00, true], ['2026-04', 'value', 120_00, false], ['2026-05', 'inherit', null, false],
    ])
    expect(await values(store, rowId)).toEqual([100, 100, 150, 120, 120, 120])
    // a tenth of the income from April: the months before are written down as they showed, March as the exception it is
    await setRule(store, { poolId: pool.id }, { kind: 'share-of-income', share: 0.1 }, '2026-04')
    expect(await values(store, rowId)).toEqual([100, 100, 150, 400, 400, 400])
    expect(await stored(store, rowId, '2026-03')).toMatchObject({ value: 150_00, once: true })
  })
})
