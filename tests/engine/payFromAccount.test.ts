import { describe, expect, it } from 'vitest'
import { FxRateSchema, accountRef, newId } from '@/model'
import { computeEngine, primarySavingsOf } from '@/engine'
import { T0, account, actual, cellItems, cellValue, household, row, tables } from './helpers'

const fx = (pair: string, month: string, rate: number) => FxRateSchema.parse({ pair, month, rate, source: 'manual', updatedAt: T0 })

/** A household with two savings accounts, an investment account and an other asset; "To savings" takes the rest into the first. */
function setup() {
  const savings = account({ name: 'Savings', type: 'savings', openingBalance: 5000_00, order: 'a0' })
  const rainy = account({ name: 'Rainy day', type: 'savings', openingBalance: 3000_00, order: 'a1' })
  const fund = account({ name: 'Index fund', type: 'investment', openingBalance: 10_000_00, order: 'a2' })
  const deposit = account({ name: 'Rental deposit', type: 'other-asset', openingBalance: 2000_00, order: 'a3' })
  const current = account({ name: 'Current', type: 'checking', order: 'a4' })
  const salary = row({ name: 'Salary', section: 'income', order: 'a0' })
  const rent = row({ name: 'Rent', section: 'expense', order: 'b0' })
  const boiler = row({ name: 'Boiler', section: 'expense', order: 'b1' })
  const toSavings = row({ name: 'To savings', section: 'transfer', kind: 'to-savings', accountId: savings.id, order: 'c0' })
  const accounts = [savings, rainy, fund, deposit, current]
  const rows = [salary, rent, boiler, toSavings]
  const cells = [cellValue(salary.id, '2026-01', 3000_00), cellValue(rent.id, '2026-01', 1000_00)]
  return { savings, rainy, fund, deposit, current, salary, rent, boiler, toSavings, accounts, rows, cells }
}

describe('engine: an expense that comes out of a named account', () => {
  it('lowers that savings account and leaves the month and the first savings account alone', () => {
    const s = setup()
    const without = computeEngine({ tables: tables({ household: [household()], accounts: s.accounts, rows: s.rows, cells: s.cells }), months: ['2026-01'] })
    const cells = [...s.cells, cellItems(s.boiler.id, '2026-01', [{ label: 'New boiler', amount: 900_00, fundedBy: accountRef(s.rainy.id) }])]
    const out = computeEngine({ tables: tables({ household: [household()], accounts: s.accounts, rows: s.rows, cells }), months: ['2026-01'] })
    const t = out.totals['2026-01']
    expect(t).toMatchObject({ cashExpense: 1000_00, savingsFunded: 0, poolFunded: 0, accountFunded: 900_00, accountFundedByAccount: { [s.rainy.id]: 900_00 } })
    expect(t.fromSavingsDerived).toBe(900_00)
    expect(t.expensesTotal).toBe(1900_00)
    // the month closes as it did without the boiler: the rest and the leftover do not move
    expect([t.toSavings, t.leftover]).toEqual([without.totals['2026-01'].toSavings, without.totals['2026-01'].leftover])
    expect(out.accounts[s.rainy.id].months['2026-01']).toMatchObject({ balance: 3000_00 - 900_00, outflow: 900_00 })
    expect(out.accounts[s.savings.id].months['2026-01'].balance).toBe(without.accounts[s.savings.id].months['2026-01'].balance)
    expect(out.netWorth['2026-01']).toBe(without.netWorth['2026-01'] - 900_00)
  })

  it('takes it from an investment account in that account\'s own currency, at the month\'s rate', () => {
    const s = setup()
    const dollars = account({ name: 'Dollar fund', type: 'investment', currency: 'USD', openingBalance: 1000_00, order: 'a5' })
    const trip = row({ name: 'Trip', section: 'expense', currency: 'USD', order: 'b2' })
    const cells = [
      ...s.cells,
      cellItems(s.boiler.id, '2026-01', [{ amount: 90_00, fundedBy: accountRef(dollars.id) }, { amount: 400_00, fundedBy: accountRef(s.fund.id) }]),
      cellItems(trip.id, '2026-01', [{ amount: 50_00, fundedBy: accountRef(dollars.id) }]),
    ]
    const out = computeEngine({
      tables: tables({ household: [household()], accounts: [...s.accounts, dollars], rows: [...s.rows, trip], cells, fxRates: [fx('USD/EUR', '2026-01', 0.9)] }),
      months: ['2026-01'],
    })
    // 90 EUR are 100 USD, and the 50 USD of the trip come back as 50 USD
    expect(out.totals['2026-01'].accountFundedByAccount).toEqual({ [dollars.id]: 90_00 + 45_00, [s.fund.id]: 400_00 })
    expect(out.accounts[dollars.id].months['2026-01']).toMatchObject({ balance: 1000_00 - 150_00, outflow: 150_00 })
    expect(out.accounts[s.fund.id].months['2026-01']).toMatchObject({ balance: 10_000_00 - 400_00, outflow: 400_00 })
    expect(out.warnings).toEqual([])
  })

  it('lowers an account kept in another currency by exactly what was typed in that currency', () => {
    const s = setup()
    const dollars = account({ name: 'Dollar savings', type: 'savings', currency: 'USD', openingBalance: 2000_00, order: 'a5' })
    const trip = row({ name: 'Trip', section: 'expense', currency: 'USD', order: 'b2' })
    // 444.44 USD are 406.08 EUR at this rate, and 406.08 EUR would come back as 444.43 USD
    const cells = [...s.cells, cellItems(trip.id, '2026-01', [{ amount: 333_33, fundedBy: accountRef(dollars.id) }, { amount: 111_11, fundedBy: accountRef(dollars.id) }])]
    const out = computeEngine({
      tables: tables({ household: [household()], accounts: [...s.accounts, dollars], rows: [...s.rows, trip], cells, fxRates: [fx('USD/EUR', '2026-01', 0.9137)] }),
      months: ['2026-01'],
    })
    expect(out.totals['2026-01'].fundedOwn).toEqual({ [accountRef(dollars.id)]: { USD: 444_44 } })
    expect(out.totals['2026-01'].accountFundedByAccount[dollars.id]).toBe(out.cells[`${trip.id}|2026-01`].valueBase)
    expect(out.accounts[dollars.id].months['2026-01']).toMatchObject({ balance: 2000_00 - 444_44, outflow: 444_44 })
  })

  it('lowers an other asset, which then carries the lower value until a real one is entered', () => {
    const s = setup()
    const cells = [...s.cells, cellItems(s.boiler.id, '2026-01', [{ amount: 500_00, fundedBy: accountRef(s.deposit.id) }]), cellValue(s.boiler.id, '2026-02', 0)]
    const t = tables({ household: [household()], accounts: s.accounts, rows: s.rows, cells })
    const out = computeEngine({ tables: t, months: ['2026-01', '2026-02', '2026-03'] })
    expect(out.accounts[s.deposit.id].months['2026-01']).toMatchObject({ computed: 1500_00, balance: 1500_00, outflow: 500_00 })
    expect(out.accounts[s.deposit.id].months['2026-03'].balance).toBe(1500_00)
    const entered = computeEngine({ tables: { ...t, accountMonths: [actual(s.deposit.id, '2026-01', 1800_00)] }, months: ['2026-01', '2026-02'] })
    expect(entered.accounts[s.deposit.id].months['2026-01']).toMatchObject({ computed: 1500_00, balance: 1800_00, adjustment: 300_00 })
    expect(entered.accounts[s.deposit.id].months['2026-02'].balance).toBe(1800_00)
  })

  it('follows the row\'s default into the months that inherit it', () => {
    const s = setup()
    const boiler = { ...s.boiler, defaultFundedBy: accountRef(s.rainy.id) }
    const rows = s.rows.map((r) => (r.id === boiler.id ? boiler : r))
    const out = computeEngine({ tables: tables({ household: [household()], accounts: s.accounts, rows, cells: [...s.cells, cellValue(boiler.id, '2026-01', 100_00)] }), months: ['2026-01', '2026-02'] })
    expect(out.totals['2026-02'].accountFundedByAccount).toEqual({ [s.rainy.id]: 100_00 })
    expect(out.accounts[s.rainy.id].months['2026-02'].balance).toBe(3000_00 - 200_00)
  })

  it('counts an account that is gone, or that cannot pay, as the month\'s income', () => {
    const s = setup()
    const card = account({ name: 'Visa', type: 'credit-card', card: { cardMode: 'lump' }, order: 'a6' })
    const gone = { ...account({ name: 'Closed', type: 'savings', order: 'a7' }), deletedAt: T0 }
    const cells = [...s.cells, cellItems(s.boiler.id, '2026-01', [
      { amount: 100_00, fundedBy: accountRef(newId()) }, { amount: 200_00, fundedBy: accountRef(s.current.id) },
      { amount: 300_00, fundedBy: accountRef(card.id) }, { amount: 400_00, fundedBy: accountRef(gone.id) },
    ])]
    const out = computeEngine({ tables: tables({ household: [household()], accounts: [...s.accounts, card, gone], rows: s.rows, cells }), months: ['2026-01'] })
    const t = out.totals['2026-01']
    expect(t).toMatchObject({ cashExpense: 1000_00 + 1000_00, accountFunded: 0, accountFundedByAccount: {} })
    // the rest of the month is what is left after all of it
    expect(t.toSavings).toBe(3000_00 - 2000_00)
  })

  it('keeps the old "Savings balance" on the first savings account, beside what names an account', () => {
    const s = setup()
    const cells = [...s.cells, cellItems(s.boiler.id, '2026-01', [
      { amount: 100_00, fundedBy: 'savings' }, { amount: 200_00, fundedBy: accountRef(s.savings.id) }, { amount: 300_00, fundedBy: accountRef(s.rainy.id) },
    ])]
    const t = tables({ household: [household()], accounts: s.accounts, rows: s.rows, cells })
    const out = computeEngine({ tables: t, months: ['2026-01'] })
    expect(out.primarySavingsId).toBe(s.savings.id)
    expect(primarySavingsOf(t)).toBe(s.savings.id)
    expect(out.totals['2026-01']).toMatchObject({ savingsFunded: 100_00, accountFunded: 500_00, fromSavingsDerived: 600_00 })
    // 5,000 + the rest of the month (2,000) − 100 − 200
    expect(out.accounts[s.savings.id].months['2026-01'].balance).toBe(5000_00 + 2000_00 - 300_00)
    expect(out.accounts[s.rainy.id].months['2026-01'].balance).toBe(3000_00 - 300_00)
    // the first savings account is the one "To savings" feeds, wherever it stands in the list
    const other = { ...s.toSavings, accountId: s.rainy.id }
    expect(primarySavingsOf({ ...t, rows: t.rows.map((r) => (r.id === other.id ? other : r)) })).toBe(s.rainy.id)
  })

  it('counts a category\'s estimate against everything its rows spent, whatever paid', () => {
    const s = setup()
    const cat = { id: newId(), createdAt: T0, updatedAt: T0, deletedAt: null, name: 'Home', section: 'expense' as const, order: 'a0' }
    const boiler = { ...s.boiler, categoryId: cat.id }
    const estimate = row({ name: 'Home – Not broken down yet', section: 'expense', kind: 'category-estimate', categoryId: cat.id, order: 'b9' })
    const rows = [...s.rows.map((r) => (r.id === boiler.id ? boiler : r)), estimate]
    const cells = [...s.cells, cellValue(estimate.id, '2026-01', 1000_00), cellItems(boiler.id, '2026-01', [{ amount: 600_00, fundedBy: accountRef(s.rainy.id) }])]
    const out = computeEngine({ tables: tables({ household: [household()], accounts: s.accounts, rows, cells, categories: [cat] }), months: ['2026-01'] })
    // 1,000 estimated, 600 explained by the boiler: 400 left, out of the month's income
    expect(out.cells[`${estimate.id}|2026-01`]).toMatchObject({ valueBase: 400_00, funding: { cash: 400_00, savings: 0, pools: {}, accounts: {} } })
  })
})
