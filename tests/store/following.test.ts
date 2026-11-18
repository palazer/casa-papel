import { describe, expect, it } from 'vitest'
import { cellKey, computeEngine } from '@/engine'
import { monthRange, newId, type CellItem, type MonthKey } from '@/model'
import {
  CasaDb, Store, addAccount, addPool, cellPut, engineUpTo, loadTables, planFollowing, quickCreateHousehold, saveRowMonth, setCategoryEstimate, setCellDone, setCellItems, setCellValue,
  setDerivedDone, setRowFundedBy, setRule, itemsFromCurrent,
} from '@/store'
import { DEMO_IDS } from '@/demo/demoHousehold'
import { loadDemo } from '@/demo/loadDemo'

/**
 * "This and following months" replaces what the following months held (rule A3). What is ticked as done stays, and
 * so does where a month comes out of. These tests read the stored months as well as the figures.
 */
const months = monthRange('2026-01', '2026-08')
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
const storedOf = async (store: Store, rowId: string): Promise<string[]> =>
  (await loadTables(store)).cells.filter((c) => c.rowId === rowId).sort((a, b) => (a.month < b.month ? -1 : 1))
    .map((c) => `${c.month.slice(5)} ${c.mode === 'value' ? (c.value ?? 0) / 100 : c.mode === 'items' ? `[${c.items.map((i) => (i.kind === 'carry' ? 'carry' : i.amount / 100)).join(' ')}]` : 'inherit'}${c.once ? '!' : ''}`)
/** What the dialog would say before saving `amount` for `month`: the months replaced and kept. */
const preview = async (store: Store, rowId: string, month: MonthKey, amount: number) => {
  const { tables, engine } = await engineUpTo(store, month)
  const { replaced, kept } = planFollowing(tables, engine, rowId, month, amount, 0)
  return { replaced, kept }
}

describe('"This and following months" replaces what the following months held', () => {
  it('a later amount, an exception and a list all go; one step, one undo', async () => {
    const { store, rent } = await fresh()
    await setCellValue(store, rent.id, '2026-07', 1300_00, 'from-now-on')
    await setCellValue(store, rent.id, '2026-05', 1400_00, 'this-month')
    await setCellItems(store, rent.id, '2026-06', [item(1000_00, { label: 'A' }), item(250_00, { label: 'B' })], 'this-month')
    expect(await values(store, rent.id)).toEqual([1200, 1200, 1200, 1200, 1400, 1250, 1300, 1300])
    expect(await preview(store, rent.id, '2026-03', 1250_00)).toEqual({ replaced: ['2026-05', '2026-06', '2026-07'], kept: [] })

    await setCellValue(store, rent.id, '2026-03', 1250_00, 'from-now-on')
    expect(await storedOf(store, rent.id)).toEqual(['01 1200', '03 1250', '05 inherit', '06 inherit', '07 inherit'])
    expect(await values(store, rent.id)).toEqual([1200, 1200, 1250, 1250, 1250, 1250, 1250, 1250])
    await store.undo()
    expect(await storedOf(store, rent.id)).toEqual(['01 1200', '05 1400!', '06 [1000 250]!', '07 1300'])
    expect(await values(store, rent.id)).toEqual([1200, 1200, 1200, 1200, 1400, 1250, 1300, 1300])
  })

  it('a note on a replaced month stays, and the month reads in the row\'s currency again', async () => {
    const { store, rent } = await fresh()
    await store.commit([cellPut(undefined, { rowId: rent.id, month: '2026-06', mode: 'value', value: 900_00, note: 'paid in dollars', currencyOverride: 'USD' }, Date.now())])
    await setCellValue(store, rent.id, '2026-03', 1250_00, 'from-now-on')
    expect((await loadTables(store)).cells.find((c) => c.rowId === rent.id && c.month === '2026-06')).toMatchObject({ mode: 'inherit', note: 'paid in dollars', currencyOverride: null, once: false })
  })

  it('only a new amount replaces: the same amount saved again, a tick, another certainty leave later months alone', async () => {
    const { store, rent } = await fresh()
    await setCellValue(store, rent.id, '2026-03', 1250_00, 'from-now-on')
    await setCellValue(store, rent.id, '2026-07', 1300_00, 'from-now-on')
    const before = await storedOf(store, rent.id)
    expect(await preview(store, rent.id, '2026-03', 1250_00)).toEqual({ replaced: [], kept: [] })
    await setCellValue(store, rent.id, '2026-03', 1250_00, 'from-now-on')
    expect(await storedOf(store, rent.id)).toEqual(before)
    // "How sure: Done" on the single amount, saved for this and following months
    await setCellItems(store, rent.id, '2026-03', [item(1250_00, { status: 'done' })], 'from-now-on')
    expect(await storedOf(store, rent.id)).toEqual(['01 1200', '03 [1250]', '07 1300'])
    expect(await values(store, rent.id)).toEqual([1200, 1200, 1250, 1250, 1250, 1250, 1300, 1300])
  })

  it('a month that only carried, saved with the amount it carried, replaces nothing either', async () => {
    const { store, rent } = await fresh()
    await setCellValue(store, rent.id, '2026-07', 1300_00, 'from-now-on')
    await setCellValue(store, rent.id, '2026-04', 1200_00, 'from-now-on')
    expect(await storedOf(store, rent.id)).toEqual(['01 1200', '04 1200', '07 1300'])
  })

  it('zero is a new amount on a row that had none', async () => {
    const { store } = await fresh()
    const tables = await loadTables(store)
    const groceries = tables.rows.find((r) => r.section === 'expense' && r.name !== 'Rent')!
    await setCellValue(store, groceries.id, '2026-05', 300_00, 'from-now-on')
    expect(await preview(store, groceries.id, '2026-02', 0)).toEqual({ replaced: ['2026-05'], kept: [] })
    await setCellValue(store, groceries.id, '2026-02', 0, 'from-now-on')
    expect(await values(store, groceries.id)).toEqual([0, 0, 0, 0, 0, 0, 0, 0])
  })

  it('a list saved for this and following months replaces by its total', async () => {
    const { store, rent } = await fresh()
    await setCellValue(store, rent.id, '2026-07', 1300_00, 'from-now-on')
    const { engine } = await engineUpTo(store, '2026-03')
    const list = [...itemsFromCurrent(engine.cells[cellKey(rent.id, '2026-03')], 'cash', 'committed'), item(80_00, { label: 'Parking' })]
    await saveRowMonth(store, rent.id, '2026-03', { items: list, scope: 'from-now-on' })
    expect(await storedOf(store, rent.id)).toEqual(['01 1200', '03 [carry 80]', '07 inherit'])
    expect(await values(store, rent.id)).toEqual([1200, 1200, 1280, 1280, 1280, 1280, 1280, 1280])
    // saved again as it is: the total did not change, so nothing later is looked at
    await setCellValue(store, rent.id, '2026-07', 1300_00, 'from-now-on')
    const again = (await loadTables(store)).cells.find((c) => c.rowId === rent.id && c.month === '2026-03')!
    await saveRowMonth(store, rent.id, '2026-03', { items: again.items, scope: 'from-now-on' })
    expect(await values(store, rent.id)).toEqual([1200, 1200, 1280, 1280, 1280, 1280, 1300, 1300])
  })
})

describe('what is ticked as done stays', () => {
  it('a ticked month keeps its amount and its tick, and the new amount goes on after it', async () => {
    const { store, rent } = await fresh()
    await setCellValue(store, rent.id, '2026-05', 1300_00, 'from-now-on')
    await setCellDone(store, rent.id, '2026-05', true)
    expect(await values(store, rent.id)).toEqual([1200, 1200, 1200, 1200, 1300, 1300, 1300, 1300])
    expect(await preview(store, rent.id, '2026-03', 1250_00)).toEqual({ replaced: [], kept: ['2026-05'] })
    await setCellValue(store, rent.id, '2026-03', 1250_00, 'from-now-on')
    // May was where 1,300.00 began; now it is May's alone, and June follows March
    expect(await storedOf(store, rent.id)).toEqual(['01 1200', '03 1250', '05 [1300]!'])
    expect(await values(store, rent.id)).toEqual([1200, 1200, 1250, 1250, 1300, 1250, 1250, 1250])
    const out = computeEngine({ tables: await loadTables(store), months })
    expect(out.cells[cellKey(rent.id, '2026-05')].status).toBe('done')
    expect(out.cells[cellKey(rent.id, '2026-06')].status).not.toBe('done')
  })

  it('a list with one item ticked is kept whole, and a carried item in it gets the amount it carried', async () => {
    const { store, rent } = await fresh()
    const { engine } = await engineUpTo(store, '2026-05')
    const list = [...itemsFromCurrent(engine.cells[cellKey(rent.id, '2026-05')], 'cash', 'committed'), item(80_00, { label: 'Parking', status: 'done' })]
    await saveRowMonth(store, rent.id, '2026-05', { items: list, scope: 'this-month' })
    expect(await storedOf(store, rent.id)).toEqual(['01 1200', '05 [carry 80]!'])
    await setCellValue(store, rent.id, '2026-03', 1250_00, 'from-now-on')
    // without that, May would have become 1,330.00
    expect(await storedOf(store, rent.id)).toEqual(['01 1200', '03 1250', '05 [1200 80]!'])
    expect(await values(store, rent.id)).toEqual([1200, 1200, 1250, 1250, 1280, 1250, 1250, 1250])
  })

  it('ticked months before and unticked months between are told apart', async () => {
    const { store, rent } = await fresh()
    await setCellDone(store, rent.id, '2026-02', true)
    await setCellValue(store, rent.id, '2026-04', 1400_00, 'this-month')
    await setCellDone(store, rent.id, '2026-06', true)
    expect(await preview(store, rent.id, '2026-01', 1100_00)).toEqual({ replaced: ['2026-04'], kept: ['2026-02', '2026-06'] })
    await setCellValue(store, rent.id, '2026-01', 1100_00, 'from-now-on')
    expect(await values(store, rent.id)).toEqual([1100, 1200, 1100, 1100, 1100, 1200, 1100, 1100])
  })

  it('a category\'s estimate that is ticked keeps what it showed, also where it only carried', async () => {
    const store = new Store(new CasaDb(`test-${newId()}`))
    await loadDemo(store)
    const row = await setCategoryEstimate(store, DEMO_IDS.catHousing, '2026-11', 2000_00)
    await setCategoryEstimate(store, DEMO_IDS.catHousing, '2027-02', 2600_00)
    // January only carries the 2,000.00, and its line is ticked
    await setDerivedDone(store, row.id, '2027-01', true)
    await setCategoryEstimate(store, DEMO_IDS.catHousing, '2026-12', 2300_00)
    const t = await loadTables(store)
    const out = computeEngine({ tables: t, months: monthRange('2026-09', '2027-03') })
    expect(['2026-11', '2026-12', '2027-01', '2027-02', '2027-03'].map((m) => out.cells[cellKey(row.id, m)].estimate)).toEqual([2000_00, 2300_00, 2000_00, 2300_00, 2300_00])
    expect(out.cells[cellKey(row.id, '2027-01')].status).toBe('done')
    expect(t.cells.find((c) => c.rowId === row.id && c.month === '2027-01')).toMatchObject({ mode: 'value', value: 2000_00, markedDone: true, once: true })
  })
})

describe('where a month comes out of stays', () => {
  it('months written down with an older source get the new amount and keep that source', async () => {
    const { store, rent } = await fresh()
    const t = await loadTables(store)
    const savings = t.accounts.find((a) => a.type === 'savings')!
    const pool = await addPool(store, { name: 'Housing fund', accountId: savings.id, openingBalance: 9000_00 })
    await setRowFundedBy(store, rent.id, `pool:${pool.id}`, 'all-months')
    // from June on the rent comes out of the month's income again: January to May are written down with the fund
    await setRowFundedBy(store, rent.id, 'cash', { from: '2026-06' })
    expect(await storedOf(store, rent.id)).toEqual(['01 [1200]', '02 [1200]', '03 [1200]', '04 [1200]', '05 [1200]'])
    // those months only repeat the amount before them: they follow silently
    expect(await preview(store, rent.id, '2026-03', 1250_00)).toEqual({ replaced: [], kept: [] })

    await setCellItems(store, rent.id, '2026-03', [item(1250_00, { fundedBy: `pool:${pool.id}` })], 'from-now-on')
    expect(await storedOf(store, rent.id)).toEqual(['01 [1200]', '02 [1200]', '03 [1250]', '04 [1250]', '05 [1250]'])
    expect(await values(store, rent.id)).toEqual([1200, 1200, 1250, 1250, 1250, 1250, 1250, 1250])
    const after = await loadTables(store)
    expect(after.cells.filter((c) => c.rowId === rent.id).flatMap((c) => c.items.map((i) => i.fundedBy))).toEqual(Array(5).fill(`pool:${pool.id}`))
    // the fund paid January to May and nothing after: 9,000 less 2 × 1,200 and 3 × 1,250
    const out = computeEngine({ tables: after, months })
    expect(out.pools[pool.id].months['2026-05'].balance).toBe(9000_00 - 2 * 1200_00 - 3 * 1250_00)
    expect(out.pools[pool.id].months['2026-08'].balance).toBe(9000_00 - 2 * 1200_00 - 3 * 1250_00)
  })

  it('a month with amounts out of two sources is emptied like any other', async () => {
    const { store, rent } = await fresh()
    const t = await loadTables(store)
    const savings = t.accounts.find((a) => a.type === 'savings')!
    await setCellItems(store, rent.id, '2026-05', [item(700_00), item(500_00, { fundedBy: `account:${savings.id}` })], 'this-month')
    await setCellValue(store, rent.id, '2026-03', 1250_00, 'from-now-on')
    expect(await storedOf(store, rent.id)).toEqual(['01 1200', '03 1250', '05 inherit'])
  })
})

describe('rows whose months do not carry forward', () => {
  it('a row a rule works out: a typed amount is its month\'s alone and replaces nothing', async () => {
    const store = new Store(new CasaDb(`test-${newId()}`))
    await quickCreateHousehold(store, { name: 'Test', baseCurrency: 'EUR', locale: 'en-IE', startMonth: '2026-01' })
    const t = await loadTables(store)
    await setCellValue(store, t.rows.find((r) => r.name === 'Salary')!.id, '2026-01', 4000_00, 'from-now-on')
    const broker = await addAccount(store, { name: 'Broker', type: 'investment', currency: 'EUR', openingMonth: '2026-01', openingBalance: 0 })
    const row = await setRule(store, { accountId: broker.id }, { kind: 'share-of-income', share: 0.1 }, '2026-01')
    await setCellValue(store, row.id, '2026-05', 550_00, 'from-now-on')
    await setCellValue(store, row.id, '2026-03', 600_00, 'from-now-on')
    expect(await values(store, row.id)).toEqual([400, 400, 600, 400, 550, 400, 400, 400])
    expect((await loadTables(store)).cells.filter((c) => c.rowId === row.id).every((c) => !c.once)).toBe(true)
  })

  it('a fixed amount set from a month on (the rule dialog) replaces later amounts and keeps a ticked month', async () => {
    const store = new Store(new CasaDb(`test-${newId()}`))
    await quickCreateHousehold(store, { name: 'Test', baseCurrency: 'EUR', locale: 'en-IE', startMonth: '2026-01' })
    const t = await loadTables(store)
    await setCellValue(store, t.rows.find((r) => r.name === 'Salary')!.id, '2026-01', 4000_00, 'from-now-on')
    const pool = await addPool(store, { name: 'Clothing', accountId: t.accounts.find((a) => a.type === 'savings')!.id, openingBalance: 0, monthlyAllocation: 100_00, fromMonth: '2026-01' })
    const rowId = pool.allocationRowId!
    await setCellValue(store, rowId, '2026-05', 150_00, 'from-now-on')
    await setCellValue(store, rowId, '2026-06', 170_00, 'this-month')
    await setCellDone(store, rowId, '2026-06', true)
    expect(await values(store, rowId)).toEqual([100, 100, 100, 100, 150, 170, 150, 150])
    await setRule(store, { poolId: pool.id }, { kind: 'fixed', amount: 120_00 }, '2026-03')
    expect(await storedOf(store, rowId)).toEqual(['01 100', '03 120', '05 inherit', '06 [170]!'])
    expect(await values(store, rowId)).toEqual([100, 100, 120, 120, 120, 170, 120, 120])
  })
})
