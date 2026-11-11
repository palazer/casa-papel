import { describe, expect, it } from 'vitest'
import { cellKey, computeEngine } from '@/engine'
import { CategorySchema, CellSchema, FxRateSchema, monthRange, newId, poolRef, type Tables } from '@/model'
import { T0, account, cellItems, cellValue, closedMonth, household, pool, row, tables } from './helpers'

const months = monthRange('2026-01', '2026-03')
const category = (name: string, order = 'a0', section: 'expense' | 'income' = 'expense') => CategorySchema.parse({ id: newId(), createdAt: T0, updatedAt: T0, name, section, order })
const fx = (pair: string, month: string, rate: number) => FxRateSchema.parse({ pair, month, rate, source: 'manual', updatedAt: T0 })

/** Housing is expected to come to 1,450 a month; Rent 1,100 and Electricity 90 are known. */
function housing(over: Partial<Tables> = {}) {
  const cat = category('Housing')
  const salary = row({ name: 'Salary', section: 'income' })
  const estimate = row({ name: 'Housing – Not broken down yet', section: 'expense', kind: 'category-estimate', categoryId: cat.id, order: 'b0' })
  const rent = row({ name: 'Rent', section: 'expense', categoryId: cat.id, order: 'b1' })
  const power = row({ name: 'Electricity', section: 'expense', categoryId: cat.id, order: 'b2' })
  const t = tables({
    household: [household()], categories: [cat], rows: [salary, estimate, rent, power],
    cells: [cellValue(salary.id, '2026-01', 4000_00), cellValue(estimate.id, '2026-01', 1450_00), cellValue(rent.id, '2026-01', 1100_00), cellValue(power.id, '2026-01', 90_00)],
    ...over,
  })
  return { t, cat, salary, estimate, rent, power }
}

describe('a category\'s estimate', () => {
  it('counts what the category\'s rows have not explained yet, and the category comes to the estimate', () => {
    const { t, estimate } = housing()
    const out = computeEngine({ tables: t, months })
    for (const m of months) {
      expect(out.cells[cellKey(estimate.id, m)]).toMatchObject({ value: 260_00, valueBase: 260_00, estimate: 1450_00, estimateBase: 1450_00, source: 'derived', status: 'derived', funding: { cash: 260_00, savings: 0, pools: {} } })
      expect(out.totals[m]).toMatchObject({ cashExpense: 1450_00, expensesTotal: 1450_00, toSavings: 4000_00 - 1450_00 })
    }
    expect(out.rowTotals[estimate.id].total).toBe(3 * 260_00)
    expect(out.warnings).toEqual([])
  })

  it('shrinks as rows are added and is gone once they add up to it; beyond that the rows are the category', () => {
    const { t, estimate, rent, cat } = housing()
    const water = row({ name: 'Water', section: 'expense', categoryId: cat.id, order: 'b3' })
    const more = { ...t, rows: [...t.rows, water], cells: [...t.cells, cellValue(water.id, '2026-02', 260_00), cellValue(rent.id, '2026-03', 1300_00)] }
    const out = computeEngine({ tables: more, months })
    expect(months.map((m) => out.cells[cellKey(estimate.id, m)].value)).toEqual([260_00, 0, 0])
    // February is explained to the cent; March's rows come to 1,650 and that is what the category costs
    expect(months.map((m) => out.totals[m].cashExpense)).toEqual([1450_00, 1450_00, 1650_00])
    // the estimate itself keeps carrying forward untouched
    expect(months.map((m) => out.cells[cellKey(estimate.id, m)].estimate)).toEqual([1450_00, 1450_00, 1450_00])
  })

  it('carries the typed estimate forward, and a change applies from its month', () => {
    const { t, estimate } = housing()
    const out = computeEngine({ tables: { ...t, cells: [...t.cells, cellValue(estimate.id, '2026-03', 2000_00)] }, months })
    expect(months.map((m) => [out.cells[cellKey(estimate.id, m)].estimate, out.cells[cellKey(estimate.id, m)].value])).toEqual([[1450_00, 260_00], [1450_00, 260_00], [2000_00, 810_00]])
  })

  it('looks only at spending rows of its own category', () => {
    const { t, estimate, cat } = housing()
    const other = category('Living', 'a1')
    const loan = account({ name: 'Mortgage', type: 'loan', openingBalance: 100_000_00 })
    const food = row({ name: 'Food', section: 'expense', categoryId: other.id, order: 'b4' })
    const loose = row({ name: 'Odds', section: 'expense', order: 'b5' })
    const mortgage = row({ name: 'Mortgage payment', section: 'expense', kind: 'debt-payment', categoryId: cat.id, accountId: loan.id, order: 'b6' })
    const out = computeEngine({
      tables: { ...t, accounts: [loan], categories: [...t.categories, other], rows: [...t.rows, food, loose, mortgage], cells: [...t.cells, cellValue(food.id, '2026-01', 500_00), cellValue(loose.id, '2026-01', 70_00), cellValue(mortgage.id, '2026-01', 800_00)] },
      months,
    })
    expect(out.cells[cellKey(estimate.id, '2026-01')].value).toBe(260_00)
    expect(out.totals['2026-01']).toMatchObject({ cashExpense: 1450_00 + 500_00 + 70_00, debt: 800_00 })
  })

  it('reads its rows in the household currency, whatever they come out of', () => {
    const { t, estimate, cat } = housing()
    const savings = account({ name: 'Savings', type: 'savings', openingBalance: 5000_00 })
    const repairs = pool({ name: 'Repairs', accountId: savings.id, openingBalance: 1000_00 })
    const plumber = row({ name: 'Plumber', section: 'expense', categoryId: cat.id, currency: 'USD', order: 'b3' })
    const roof = row({ name: 'Roof', section: 'expense', categoryId: cat.id, defaultFundedBy: poolRef(repairs.id), order: 'b4' })
    const out = computeEngine({
      tables: { ...t, accounts: [savings], pools: [repairs], fxRates: [fx('USD/EUR', '2026-01', 0.9)], rows: [...t.rows, plumber, roof], cells: [...t.cells, cellValue(plumber.id, '2026-01', 100_00), cellValue(roof.id, '2026-01', 50_00)] },
      months: ['2026-01'],
    })
    // 1,450 − 1,100 − 90 − 90 (100 USD) − 50 from the virtual account
    expect(out.cells[cellKey(estimate.id, '2026-01')].value).toBe(120_00)
    expect(out.totals['2026-01']).toMatchObject({ cashExpense: 1100_00 + 90_00 + 90_00 + 120_00, poolFunded: 50_00, expensesTotal: 1450_00 })
  })

  it('takes an itemized estimate as its sum, and one in another currency in proportion', () => {
    const { t, estimate } = housing()
    const itemized = computeEngine({ tables: { ...t, cells: [...t.cells.filter((c) => c.rowId !== estimate.id), cellItems(estimate.id, '2026-01', [{ label: 'Fixed', amount: 1000_00 }, { label: 'Variable', amount: 450_00, fundedBy: 'savings' }])] }, months: ['2026-01'] })
    expect(itemized.cells[cellKey(estimate.id, '2026-01')]).toMatchObject({ value: 260_00, estimate: 1450_00, funding: { cash: 260_00, savings: 0 } })
    const foreign = { ...t, rows: t.rows.map((r) => (r.id === estimate.id ? { ...r, currency: 'USD' } : r)), fxRates: [fx('USD/EUR', '2026-01', 0.5)] }
    // 1,450 USD is 725 EUR, below the 1,190 EUR of rows: nothing left
    expect(computeEngine({ tables: foreign, months: ['2026-01'] }).cells[cellKey(estimate.id, '2026-01')]).toMatchObject({ value: 0, valueBase: 0, estimate: 1450_00, estimateBase: 725_00 })
    const bigger = { ...foreign, cells: foreign.cells.map((c) => (c.rowId === estimate.id ? { ...c, value: 4000_00 } : c)) }
    // 4,000 USD is 2,000 EUR; 810 EUR is left, 1,620 USD in the row's own currency
    expect(computeEngine({ tables: bigger, months: ['2026-01'] }).cells[cellKey(estimate.id, '2026-01')]).toMatchObject({ value: 1620_00, valueBase: 810_00 })
  })

  it('is done once the month is closed or it is ticked as moved', () => {
    const { t, estimate } = housing()
    const ticked = CellSchema.parse({ rowId: estimate.id, month: '2026-02', mode: 'inherit', value: null, items: [], markedDone: true, updatedAt: T0 })
    const out = computeEngine({ tables: { ...t, cells: [...t.cells, ticked], monthStates: [closedMonth('2026-01')] }, months })
    expect(months.map((m) => out.cells[cellKey(estimate.id, m)].status)).toEqual(['done', 'done', 'derived'])
    expect(out.cells[cellKey(estimate.id, '2026-02')].value).toBe(260_00)
  })

  it('counts nothing without a typed amount, once archived, or when its category is gone', () => {
    const { t, estimate, cat } = housing()
    const never = computeEngine({ tables: { ...t, cells: t.cells.filter((c) => c.rowId !== estimate.id) }, months: ['2026-01'] })
    expect(never.cells[cellKey(estimate.id, '2026-01')]).toMatchObject({ value: 0, source: 'empty', estimate: 0 })
    expect(never.totals['2026-01'].cashExpense).toBe(1190_00)
    const archived = computeEngine({ tables: { ...t, rows: t.rows.map((r) => (r.id === estimate.id ? { ...r, archivedMonth: '2026-02' } : r)) }, months })
    expect(months.map((m) => archived.totals[m].cashExpense)).toEqual([1450_00, 1190_00, 1190_00])
    const orphan = computeEngine({ tables: { ...t, categories: [{ ...cat, deletedAt: T0 }] }, months: ['2026-01'] })
    expect(orphan.cells[cellKey(estimate.id, '2026-01')]).toMatchObject({ value: 0, valueBase: 0 })
    expect(orphan.totals['2026-01'].cashExpense).toBe(1190_00)
  })
})
