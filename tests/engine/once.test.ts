import { describe, expect, it } from 'vitest'
import { cellKey, computeEngine } from '@/engine'
import { CategorySchema, CellSchema, RecurringItemSchema, monthRange, newId, type Cell } from '@/model'
import { T0, account, cellItems, cellValue, household, row, tables } from './helpers'

const months = monthRange('2026-01', '2026-06')

/** A stored month whose amount is that month's alone. */
const once = (cell: Cell): Cell => CellSchema.parse({ ...cell, once: true })

/** What each month of a row is given and what it hands on, as `given > handsOn`; "-" is no amount yet. */
function chain(out: ReturnType<typeof computeEngine>, rowId: string, over = months): string[] {
  const say = (v: number | null) => (v == null ? '-' : String(v / 100))
  return over.map((m) => `${say(out.cells[cellKey(rowId, m)].given)} > ${say(out.cells[cellKey(rowId, m)].handsOn)}`)
}

describe('what a month is given and what it hands on', () => {
  it('a typed amount is handed on until the next one; before the first amount there is nothing', () => {
    const rent = row({ name: 'Rent', section: 'expense' })
    const t = tables({ household: [household()], rows: [rent], cells: [cellValue(rent.id, '2026-02', 1200_00), cellValue(rent.id, '2026-05', 1250_00)] })
    const out = computeEngine({ tables: t, months })
    expect(chain(out, rent.id)).toEqual(['- > -', '- > 1200', '1200 > 1200', '1200 > 1200', '1200 > 1250', '1250 > 1250'])
    // what an untyped month shows is what it was given
    expect(out.cells[cellKey(rent.id, '2026-03')]).toMatchObject({ source: 'inherit', value: 1200_00, given: 1200_00 })
    expect(out.cells[cellKey(rent.id, '2026-01')]).toMatchObject({ source: 'empty', value: 0, given: null, handsOn: null })
  })

  it('zero is an amount: a row typed down to nothing hands on 0.00, not "no amount yet"', () => {
    const gym = row({ name: 'Gym', section: 'expense' })
    const t = tables({ household: [household()], rows: [gym], cells: [cellValue(gym.id, '2026-02', 0)] })
    const out = computeEngine({ tables: t, months })
    expect(chain(out, gym.id).slice(0, 3)).toEqual(['- > -', '- > 0', '0 > 0'])
  })

  it('an itemized month hands on its sum, and a carried item in it is worth what the month was given', () => {
    const food = row({ name: 'Food', section: 'expense' })
    const t = tables({
      household: [household()], rows: [food],
      cells: [cellValue(food.id, '2026-01', 400_00), cellItems(food.id, '2026-03', [{ amount: 0, kind: 'carry' }, { amount: 60_00, label: 'Party' }, { amount: 999_00, skipped: true }])],
    })
    const out = computeEngine({ tables: t, months })
    expect(chain(out, food.id).slice(0, 4)).toEqual(['- > 400', '400 > 400', '400 > 460', '460 > 460'])
    expect(out.cells[cellKey(food.id, '2026-03')].items[0].effectiveAmount).toBe(400_00)
  })

  it('a payment to a loan hands on what was planned, also where less was still owed', () => {
    const loan = account({ name: 'Car loan', type: 'loan', openingBalance: 600_00 })
    const salary = row({ name: 'Salary', section: 'income' })
    const pay = row({ name: 'Car loan – Payment', section: 'transfer', kind: 'debt-payment', accountId: loan.id, order: 'c0' })
    const t = tables({ household: [household()], accounts: [loan], rows: [salary, pay], cells: [cellValue(salary.id, '2026-01', 3000_00), cellValue(pay.id, '2026-01', 250_00)] })
    const out = computeEngine({ tables: t, months })
    // 250, 250, then the last 100, then nothing: the amounts that count
    expect(months.map((m) => out.cells[cellKey(pay.id, m)].value)).toEqual([250_00, 250_00, 100_00, 0, 0, 0])
    // the plan behind them is untouched
    expect(chain(out, pay.id)).toEqual(['- > 250', '250 > 250', '250 > 250', '250 > 250', '250 > 250', '250 > 250'])
  })

  it('a category\'s estimate hands on what was typed, not what its rows have left of it', () => {
    const cat = CategorySchema.parse({ id: newId(), createdAt: T0, updatedAt: T0, name: 'Housing', section: 'expense', order: 'a0' })
    const estimate = row({ name: 'Housing – Not broken down yet', section: 'expense', kind: 'category-estimate', categoryId: cat.id, order: 'b0' })
    const rent = row({ name: 'Rent', section: 'expense', categoryId: cat.id, order: 'b1' })
    const t = tables({ household: [household()], categories: [cat], rows: [estimate, rent], cells: [cellValue(estimate.id, '2026-01', 1450_00), cellValue(rent.id, '2026-01', 1100_00)] })
    const out = computeEngine({ tables: t, months })
    expect(out.cells[cellKey(estimate.id, '2026-02')]).toMatchObject({ value: 350_00, estimate: 1450_00, given: 1450_00, handsOn: 1450_00 })
  })

  it('a month a rule works out, and an archived one, hand on what they were given', () => {
    const h = household({ closingRule: 'leftover-plug' })
    const salary = row({ name: 'Salary', section: 'income' })
    // a fifth of the income, with 300.00 typed for January: the typed month counts, the rule fills the others
    const saving = row({ name: 'To savings', section: 'transfer', kind: 'to-savings', order: 'c0', rule: 'share-of-income', ruleShare: 0.2 })
    const old = row({ name: 'Old phone plan', section: 'expense', order: 'b0', archivedMonth: '2026-03' })
    const t = tables({
      household: [h], rows: [salary, saving, old],
      cells: [cellValue(salary.id, '2026-01', 3000_00), cellValue(saving.id, '2026-01', 300_00), cellValue(old.id, '2026-01', 20_00)],
    })
    const out = computeEngine({ tables: t, months })
    expect(out.cells[cellKey(old.id, '2026-04')]).toMatchObject({ source: 'archived', value: 0, given: 20_00, handsOn: 20_00 })
    expect(out.cells[cellKey(saving.id, '2026-01')]).toMatchObject({ source: 'value', value: 300_00, given: null, handsOn: 300_00 })
    expect(out.cells[cellKey(saving.id, '2026-04')]).toMatchObject({ source: 'derived', value: 600_00, given: 300_00, handsOn: 300_00 })
  })

  it('a row on a schedule shows nothing in a month without items, whatever the month before held', () => {
    const insurance = row({ name: 'Insurance', section: 'expense' })
    const schedule = RecurringItemSchema.parse({ id: newId(), createdAt: T0, updatedAt: T0, rowId: insurance.id, name: 'Insurance', amount: 600_00, startMonth: '2026-01', cadence: { intervalMonths: 12, anchorMonth: 1 } })
    const t = tables({ household: [household()], rows: [insurance], recurringItems: [schedule], cells: [cellItems(insurance.id, '2026-01', [{ amount: 600_00, recurringItemId: schedule.id }])] })
    const out = computeEngine({ tables: t, months })
    expect(out.cells[cellKey(insurance.id, '2026-02')]).toMatchObject({ source: 'empty', value: 0, given: 600_00, handsOn: 0 })
  })
})

describe('an amount that is its month\'s alone', () => {
  const values = (out: ReturnType<typeof computeEngine>, rowId: string) => months.map((m) => out.cells[cellKey(rowId, m)].value / 100)

  it('counts in its month, and the months after go on with what came before it', () => {
    const rent = row({ name: 'Rent', section: 'expense' })
    const t = tables({ household: [household()], rows: [rent], cells: [cellValue(rent.id, '2026-01', 1200_00), once(cellValue(rent.id, '2026-03', 1500_00))] })
    const out = computeEngine({ tables: t, months })
    expect(values(out, rent.id)).toEqual([1200, 1200, 1500, 1200, 1200, 1200])
    expect(chain(out, rent.id)).toEqual(['- > 1200', '1200 > 1200', '1200 > 1200', '1200 > 1200', '1200 > 1200', '1200 > 1200'])
    expect(out.cells[cellKey(rent.id, '2026-03')].source).toBe('value')
    expect(out.cells[cellKey(rent.id, '2026-04')].source).toBe('inherit')
  })

  it('one after another, each stays in its own month', () => {
    const rent = row({ name: 'Rent', section: 'expense' })
    const t = tables({ household: [household()], rows: [rent], cells: [cellValue(rent.id, '2026-01', 1200_00), once(cellValue(rent.id, '2026-03', 1500_00)), once(cellValue(rent.id, '2026-04', 0)), cellValue(rent.id, '2026-06', 1300_00)] })
    const out = computeEngine({ tables: t, months })
    expect(values(out, rent.id)).toEqual([1200, 1200, 1500, 0, 1200, 1300])
  })

  it('on a row that had no amount yet, the months after it have none either', () => {
    const gift = row({ name: 'Gift', section: 'expense' })
    const t = tables({ household: [household()], rows: [gift], cells: [once(cellValue(gift.id, '2026-02', 80_00))] })
    const out = computeEngine({ tables: t, months })
    expect(values(out, gift.id)).toEqual([0, 80, 0, 0, 0, 0])
    expect(chain(out, gift.id).slice(1, 4)).toEqual(['- > -', '- > -', '- > -'])
    expect(out.cells[cellKey(gift.id, '2026-03')].source).toBe('empty')
  })

  it('as a list of items: a carried item in it is worth what the month was given, and the list is not handed on', () => {
    const food = row({ name: 'Food', section: 'expense' })
    const t = tables({
      household: [household()], rows: [food],
      cells: [cellValue(food.id, '2026-01', 400_00), once(cellItems(food.id, '2026-03', [{ amount: 0, kind: 'carry' }, { amount: 60_00, label: 'Party' }]))],
    })
    const out = computeEngine({ tables: t, months })
    expect(values(out, food.id)).toEqual([400, 400, 460, 400, 400, 400])
  })

  it('how sure it is stays in its month too: a done exception does not make the months after it read differently', () => {
    const rent = row({ name: 'Rent', section: 'expense', defaultStatus: 'projected' })
    const t = tables({
      household: [household()], rows: [rent],
      cells: [cellItems(rent.id, '2026-01', [{ amount: 1200_00, status: 'committed' }]), once(cellItems(rent.id, '2026-03', [{ amount: 1500_00, status: 'done' }]))],
    })
    const out = computeEngine({ tables: t, months })
    expect(months.map((m) => out.cells[cellKey(rent.id, m)].status)).toEqual(['committed', 'committed', 'done', 'committed', 'committed', 'committed'])
  })

  it('the mark on a month without an amount of its own says nothing', () => {
    const rent = row({ name: 'Rent', section: 'expense' })
    const empty = CellSchema.parse({ rowId: rent.id, month: '2026-03', mode: 'inherit', once: true, updatedAt: T0 })
    const t = tables({ household: [household()], rows: [rent], cells: [cellValue(rent.id, '2026-01', 1200_00), empty, cellValue(rent.id, '2026-04', 1300_00)] })
    const out = computeEngine({ tables: t, months })
    expect(values(out, rent.id)).toEqual([1200, 1200, 1200, 1300, 1300, 1300])
  })

  it('a record from before the mark existed reads as an amount that runs on', () => {
    const rent = row({ name: 'Rent', section: 'expense' })
    // as an older version stored it, and as it sits in a database that was never rewritten: no `once` at all
    const old = { rowId: rent.id, month: '2026-01', mode: 'value', value: 1200_00, items: [], note: null, currencyOverride: null, markedDone: false, updatedAt: T0 } as unknown as Cell
    const out = computeEngine({ tables: tables({ household: [household()], rows: [rent], cells: [old] }), months })
    expect(values(out, rent.id)).toEqual([1200, 1200, 1200, 1200, 1200, 1200])
  })
})
