import { describe, expect, it } from 'vitest'
import { computeEngine } from '@/engine'
import { FxRateSchema, monthRange } from '@/model'
import { account, actual, cellValue, household, row, tables } from './helpers'

const months = monthRange('2026-01', '2026-03')

describe('cards, loans, other assets and net worth', () => {
  it('itemized card: spending on the card raises what is owed, the payment lowers it and stays out of the plug', () => {
    const card = account({ name: 'Visa', type: 'credit-card', openingBalance: 200_00, card: { cardMode: 'itemized' } })
    const salary = row({ name: 'Salary', section: 'income' })
    const shopping = row({ name: 'Shopping', section: 'expense', accountId: card.id, order: 'b0' })
    const pay = row({ name: 'Pay Visa', section: 'transfer', kind: 'card-payment', accountId: card.id, order: 'c0' })
    const t = tables({ household: [household()], accounts: [card], rows: [salary, shopping, pay], cells: [cellValue(salary.id, '2026-01', 2000_00), cellValue(shopping.id, '2026-01', 150_00), cellValue(pay.id, '2026-01', 200_00), cellValue(pay.id, '2026-02', 150_00)] })
    const out = computeEngine({ tables: t, months })
    const s = out.accounts[card.id]
    expect(s.liability).toBe(true)
    expect(s.months['2026-01']).toMatchObject({ inflow: 150_00, outflow: 200_00, balance: 150_00 })
    expect(s.months['2026-02'].balance).toBe(150_00) // shopping carries 150 onto the card again, payment 150 clears January's
    // the plug counts the shopping (cash expense) but not the card payment
    expect(out.totals['2026-01'].toSavings).toBe(2000_00 - 150_00)
    expect(out.totals['2026-01'].debt).toBe(0)
    expect(out.netWorth['2026-01']).toBe(-150_00)
  })
  it('lump card: the payment is the expense; what is owed only comes from real balances', () => {
    const card = account({ name: 'Amex', type: 'credit-card', openingBalance: 500_00, card: { cardMode: 'lump' } })
    const salary = row({ name: 'Salary', section: 'income' })
    const pay = row({ name: 'Pay Amex', section: 'transfer', kind: 'card-payment', accountId: card.id, order: 'c0' })
    const t = tables({ household: [household()], accounts: [card], rows: [salary, pay], cells: [cellValue(salary.id, '2026-01', 2000_00), cellValue(pay.id, '2026-01', 300_00)], accountMonths: [actual(card.id, '2026-02', 420_00)] })
    const out = computeEngine({ tables: t, months })
    expect(out.totals['2026-01'].debt).toBe(300_00)
    expect(out.totals['2026-01'].toSavings).toBe(1700_00)
    const s = out.accounts[card.id]
    expect(s.months['2026-01'].balance).toBe(200_00)
    expect(s.months['2026-02']).toMatchObject({ balance: 420_00, projected: false })
    expect(s.months['2026-03'].balance).toBe(120_00) // 420 − carried 300 payment
  })
  it('loan: debt payments bring the outstanding amount down; other assets carry until pinned; net worth converts currencies', () => {
    const loan = account({ name: 'Car loan', type: 'loan', openingBalance: 5000_00 })
    const deposit = account({ name: 'Rental deposit', type: 'other-asset', openingBalance: 3000_00 })
    const savings = account({ name: 'Savings', type: 'savings', openingBalance: 1000_00 })
    const broker = account({ name: 'Broker', type: 'investment', currency: 'USD', openingBalance: 1100_00 })
    const salary = row({ name: 'Salary', section: 'income' })
    const instalment = row({ name: 'Car instalment', section: 'expense', kind: 'debt-payment', accountId: loan.id, order: 'b0' })
    const toSavings = row({ name: 'To savings', section: 'transfer', kind: 'to-savings', accountId: savings.id, order: 'c0' })
    const t = tables({
      household: [household()], accounts: [loan, deposit, savings, broker], rows: [salary, instalment, toSavings],
      cells: [cellValue(salary.id, '2026-01', 1000_00), cellValue(instalment.id, '2026-01', 250_00)],
      accountMonths: [actual(deposit.id, '2026-02', 2900_00)],
      fxRates: [FxRateSchema.parse({ pair: 'EUR/USD', month: '2026-01', rate: 1.1, source: 'manual', updatedAt: 0 })],
    })
    const out = computeEngine({ tables: t, months })
    expect(out.accounts[loan.id].months['2026-01'].balance).toBe(4750_00)
    expect(out.accounts[loan.id].months['2026-03'].balance).toBe(4250_00)
    expect(out.totals['2026-01'].debt).toBe(250_00)
    expect(out.accounts[deposit.id].months['2026-01'].balance).toBe(3000_00)
    expect(out.accounts[deposit.id].months['2026-03'].balance).toBe(2900_00)
    // January: savings 1000 + 750 plug, deposit 3000, broker 1100 USD = 1000 EUR, loan −4750
    expect(out.netWorth['2026-01']).toBe(1750_00 + 3000_00 + 1000_00 - 4750_00)
  })
})
