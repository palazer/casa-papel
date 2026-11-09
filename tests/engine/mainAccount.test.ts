import { describe, expect, it } from 'vitest'
import { computeEngine, computeMainAccount } from '@/engine'
import { FxRateSchema, monthRange } from '@/model'
import { T0, account, cellValue, household, row, tables } from './helpers'

const months = monthRange('2026-01', '2026-03')
const fx = (pair: string, month: string, rate: number) => FxRateSchema.parse({ pair, month, rate, source: 'manual', updatedAt: T0 })

describe('the main account: what stays behind', () => {
  it('starts from the opening balances and stays put when the month passes everything on', () => {
    const main = account({ name: 'Main', type: 'checking', openingBalance: 1200_00, tracked: false })
    const joint = account({ name: 'Joint', type: 'joint', openingBalance: 300_00, tracked: false, order: 'a1' })
    const savings = account({ name: 'Savings', type: 'savings', openingBalance: 5000_00, order: 'a2' })
    const salary = row({ name: 'Salary', section: 'income' })
    const rent = row({ name: 'Rent', section: 'expense', order: 'b0' })
    const toSavings = row({ name: 'To savings', section: 'transfer', kind: 'to-savings', accountId: savings.id, order: 'c0' })
    const t = tables({ household: [household()], accounts: [joint, savings, main], rows: [salary, rent, toSavings], cells: [cellValue(salary.id, '2026-01', 3000_00), cellValue(rent.id, '2026-01', 1000_00)] })
    const s = computeMainAccount(t, computeEngine({ tables: t, months }))!
    expect(s.accountIds).toEqual([main.id, joint.id])
    for (const m of months) expect(s.months[m]).toEqual({ start: 1500_00, kept: 0, cardBought: 0, cardPaid: 0, balance: 1500_00 })
  })

  it('grows by the cash buffer every month under the savings plug', () => {
    const main = account({ name: 'Main', type: 'checking', openingBalance: 1000_00, tracked: false })
    const salary = row({ name: 'Salary', section: 'income' })
    const t = tables({ household: [household({ cashBuffer: 100_00 })], accounts: [main], rows: [salary], cells: [cellValue(salary.id, '2026-01', 2000_00)] })
    const s = computeMainAccount(t, computeEngine({ tables: t, months }))!
    expect(months.map((m) => s.months[m].balance)).toEqual([1100_00, 1200_00, 1300_00])
    expect(s.months['2026-02']).toMatchObject({ start: 1100_00, kept: 100_00 })
  })

  it('keeps the leftover, and falls when a month overruns, when the savings amount is typed', () => {
    const main = account({ name: 'Main', type: 'checking', openingBalance: 500_00, tracked: false })
    const salary = row({ name: 'Salary', section: 'income' })
    const rent = row({ name: 'Rent', section: 'expense', order: 'b0' })
    const toSavings = row({ name: 'To savings', section: 'transfer', kind: 'to-savings', order: 'c0' })
    const t = tables({
      household: [household({ closingRule: 'leftover-plug' })], accounts: [main], rows: [salary, rent, toSavings],
      cells: [cellValue(salary.id, '2026-01', 1000_00), cellValue(rent.id, '2026-01', 700_00), cellValue(rent.id, '2026-02', 1200_00), cellValue(toSavings.id, '2026-01', 100_00)],
    })
    const s = computeMainAccount(t, computeEngine({ tables: t, months }))!
    expect(s.months['2026-01']).toMatchObject({ kept: 200_00, balance: 700_00 })
    expect(s.months['2026-02']).toMatchObject({ kept: -300_00, balance: 400_00 })
  })

  it('holds the money for an itemized card until the bill is paid', () => {
    const card = account({ name: 'Visa', type: 'credit-card', openingBalance: 200_00, card: { cardMode: 'itemized' } })
    const salary = row({ name: 'Salary', section: 'income' })
    const shopping = row({ name: 'Shopping', section: 'expense', accountId: card.id, order: 'b0' })
    const pay = row({ name: 'Pay Visa', section: 'transfer', kind: 'card-payment', accountId: card.id, order: 'c0' })
    const t = tables({ household: [household()], accounts: [card], rows: [salary, shopping, pay], cells: [cellValue(salary.id, '2026-01', 2000_00), cellValue(shopping.id, '2026-01', 150_00), cellValue(pay.id, '2026-01', 200_00), cellValue(pay.id, '2026-02', 150_00)] })
    const out = computeEngine({ tables: t, months })
    const s = computeMainAccount(t, out)!
    expect(s.accountIds).toEqual([])
    // January: 150 bought and still to pay, 200 paid for what was owed before
    expect(s.months['2026-01']).toEqual({ start: 0, kept: 0, cardBought: 150_00, cardPaid: 200_00, balance: -50_00 })
    // with the card's debt beside it, the two always net to what was owed at the start
    for (const m of months) expect(s.months[m].balance - out.accounts[card.id].months[m].balance).toBe(-200_00)
  })

  it('leaves a lump card alone: its payment is already an outflow of the month', () => {
    const card = account({ name: 'Amex', type: 'credit-card', openingBalance: 500_00, card: { cardMode: 'lump' } })
    const salary = row({ name: 'Salary', section: 'income' })
    const pay = row({ name: 'Pay Amex', section: 'transfer', kind: 'card-payment', accountId: card.id, order: 'c0' })
    const t = tables({ household: [household()], accounts: [card], rows: [salary, pay], cells: [cellValue(salary.id, '2026-01', 2000_00), cellValue(pay.id, '2026-01', 300_00)] })
    const s = computeMainAccount(t, computeEngine({ tables: t, months }))!
    expect(s.months['2026-01']).toMatchObject({ cardBought: 0, cardPaid: 0, balance: 0 })
  })

  it('lets an account opened later join in its own month, converted at that month\'s rate', () => {
    const main = account({ name: 'Main', type: 'checking', openingBalance: 100_00, tracked: false })
    const usd = account({ name: 'Dollars', type: 'cash', currency: 'USD', openingBalance: 200_00, openingMonth: '2026-02', tracked: false, order: 'a1' })
    const t = tables({ household: [household()], accounts: [main, usd], fxRates: [fx('USD/EUR', '2026-01', 0.9)] })
    const s = computeMainAccount(t, computeEngine({ tables: t, months }))!
    expect(months.map((m) => s.months[m].balance)).toEqual([100_00, 280_00, 280_00])
    expect(s.missingRate).toBe(false)
    const noRate = computeMainAccount({ ...t, fxRates: [] }, computeEngine({ tables: { ...t, fxRates: [] }, months }))!
    expect(noRate.missingRate).toBe(true)
    expect(noRate.months['2026-02'].balance).toBe(300_00)
  })

  it('says nothing when the months do not reach back to the household\'s first month', () => {
    const t = tables({ household: [household()] })
    expect(computeMainAccount(t, computeEngine({ tables: t, months: [] }))).toBeNull()
    expect(computeMainAccount(tables({}), computeEngine({ tables: tables({}), months }))).toBeNull()
    const out = computeEngine({ tables: t, months })
    expect(computeMainAccount(t, { ...out, months: ['2026-02', '2026-03'] })).toBeNull()
  })
})
