import { describe, expect, it } from 'vitest'
import { cellKey, computeEngine, typedAmount } from '@/engine'
import { FxRateSchema, monthRange } from '@/model'
import { account, actual, cellItems, cellValue, household, row, tables } from './helpers'

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
    // net worth: the 150 on the card, and the main account, which paid 200 while the month set 150 against the card
    expect(out.main!.months['2026-01'].balance).toBe(-50_00)
    expect(out.netWorth['2026-01']).toBe(-150_00 - 50_00)
  })
  it('lump card: the payment is the expense; what is owed only comes from real balances', () => {
    const card = account({ name: 'Amex', type: 'credit-card', openingBalance: 500_00, card: { cardMode: 'lump' } })
    const salary = row({ name: 'Salary', section: 'income' })
    const pay = row({ name: 'Pay Amex', section: 'transfer', kind: 'card-payment', accountId: card.id, order: 'c0' })
    const t = tables({ household: [household()], accounts: [card], rows: [salary, pay], cells: [cellValue(salary.id, '2026-01', 2000_00), cellValue(pay.id, '2026-01', 300_00)], accountMonths: [actual(card.id, '2026-02', 420_00)] })
    const out = computeEngine({ tables: t, months })
    expect(out.totals['2026-01'].debt).toBe(300_00)
    expect(out.totals['2026-01'].toSavings).toBe(1700_00)
    // the payment does not bring down what is owed: nothing says what was bought, so only a real balance can say it
    const s = out.accounts[card.id]
    expect(s.months['2026-01']).toMatchObject({ balance: 500_00, inflow: 0, outflow: 0 })
    expect(s.months['2026-02']).toMatchObject({ balance: 420_00, projected: false })
    expect(s.months['2026-03'].balance).toBe(420_00) // the carried payment of 300 is March's spending, and 420 is still owed
    // so the payment costs net worth what it is: with the 500 paid down as before, January would end 300 higher
    expect(out.netWorth['2026-01']).toBe(-500_00)
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

describe('a payment to a loan stops at what is owed', () => {
  const half = monthRange('2026-01', '2026-06')
  const rate = (month: string, r: number) => FxRateSchema.parse({ pair: 'EUR/USD', month, rate: r, source: 'manual', updatedAt: 0 })
  /** A salary of 1,000 and a payment row of 250 a month from January, on the loan given. */
  function world(loan: ReturnType<typeof account>, more: Partial<Parameters<typeof tables>[0]> = {}) {
    const salary = row({ name: 'Salary', section: 'income' })
    const pay = row({ name: 'Car loan – Payment', section: 'expense', kind: 'debt-payment', accountId: loan.id, order: 'b0' })
    const t = tables({
      household: [household()], accounts: [loan, ...(more.accounts ?? [])], rows: [salary, pay, ...(more.rows ?? [])],
      cells: [cellValue(salary.id, '2026-01', 1000_00), cellValue(pay.id, '2026-01', 250_00), ...(more.cells ?? [])],
      accountMonths: more.accountMonths ?? [], fxRates: more.fxRates ?? [], categories: more.categories ?? [],
    })
    return { t, pay, salary, out: computeEngine({ tables: t, months: half }) }
  }
  const cellsOf = (out: ReturnType<typeof computeEngine>, rowId: string) => half.map((m) => out.cells[cellKey(rowId, m)])

  it('600 at 250 a month counts 250, 250, 100, then nothing, and every figure of the month uses what counts', () => {
    const loan = account({ name: 'Car loan', type: 'loan', openingBalance: 600_00 })
    const { out, pay } = world(loan)
    const cs = cellsOf(out, pay.id)
    expect(cs.map((c) => c.value)).toEqual([250_00, 250_00, 100_00, 0, 0, 0])
    expect(cs.map((c) => c.valueBase)).toEqual([250_00, 250_00, 100_00, 0, 0, 0])
    // what was planned stays known, and is what the store writes down
    expect(cs.map((c) => c.asked)).toEqual([undefined, undefined, 250_00, 250_00, 250_00, 250_00])
    expect(cs.map((c) => typedAmount(c))).toEqual(half.map(() => 250_00))
    expect(half.map((m) => out.accounts[loan.id].months[m].balance)).toEqual([350_00, 100_00, 0, 0, 0, 0])
    expect(half.map((m) => out.accounts[loan.id].months[m].outflow)).toEqual([250_00, 250_00, 100_00, 0, 0, 0])
    // the month's sums: what the payment no longer takes is left for the rest of the month
    expect(half.map((m) => out.totals[m].debt)).toEqual([250_00, 250_00, 100_00, 0, 0, 0])
    expect(half.map((m) => out.totals[m].toSavings)).toEqual([750_00, 750_00, 900_00, 1000_00, 1000_00, 1000_00])
    expect(half.map((m) => out.totals[m].expensesTotal)).toEqual([250_00, 250_00, 100_00, 0, 0, 0])
    // net worth: nothing is owed any more, and nothing below nothing
    expect(half.map((m) => out.netWorth[m])).toEqual([-350_00, -100_00, 0, 0, 0, 0])
  })

  it('a real balance that says more is owed makes the payments count again', () => {
    const loan = account({ name: 'Car loan', type: 'loan', openingBalance: 600_00 })
    const { out, pay } = world(loan, { accountMonths: [actual(loan.id, '2026-04', 400_00)] })
    expect(cellsOf(out, pay.id).map((c) => c.value)).toEqual([250_00, 250_00, 100_00, 0, 250_00, 150_00])
    expect(half.map((m) => out.accounts[loan.id].months[m].balance)).toEqual([350_00, 100_00, 0, 400_00, 150_00, 0])
    expect(out.accounts[loan.id].months['2026-04']).toMatchObject({ entered: true, computed: 0, adjustment: 400_00 })
  })

  it('several rows take what is owed in the Grid\'s order', () => {
    const loan = account({ name: 'Car loan', type: 'loan', openingBalance: 600_00 })
    const extra = row({ name: 'Car loan – Extra', section: 'expense', kind: 'debt-payment', accountId: loan.id, order: 'b1' })
    const { out, pay } = world(loan, { rows: [extra], cells: [cellValue(extra.id, '2026-01', 200_00)] })
    expect(cellsOf(out, pay.id).map((c) => c.value).slice(0, 3)).toEqual([250_00, 150_00, 0])
    expect(cellsOf(out, extra.id).map((c) => c.value).slice(0, 3)).toEqual([200_00, 0, 0])
    expect(half.map((m) => out.accounts[loan.id].months[m].balance).slice(0, 3)).toEqual([150_00, 0, 0])
  })

  it('a loan in another currency lands on exactly nothing, and the payment is what that cost', () => {
    const loan = account({ name: 'Dollar loan', type: 'loan', currency: 'USD', openingBalance: 330_00 })
    const { out, pay } = world(loan, { fxRates: [rate('2026-01', 1.1), rate('2026-02', 1.25), rate('2026-03', 1)] })
    // January: 250 EUR are 275 USD. February: 250 EUR would be 312.50 USD, 55 USD are owed, and they cost 44 EUR
    expect(half.map((m) => out.accounts[loan.id].months[m].balance).slice(0, 3)).toEqual([55_00, 0, 0])
    expect(cellsOf(out, pay.id).map((c) => [c.value, c.valueBase]).slice(0, 3)).toEqual([[250_00, 250_00], [44_00, 44_00], [0, 0]])
    expect(out.cells[cellKey(pay.id, '2026-02')]).toMatchObject({ asked: 250_00, askedBase: 250_00, currency: 'EUR' })
  })

  it('an amount below zero is money drawn again: it raises what is owed and is never cut', () => {
    const loan = account({ name: 'Credit line', type: 'loan', openingBalance: 100_00 })
    const salary = row({ name: 'Salary', section: 'income' })
    const draw = row({ name: 'Drawn', section: 'expense', kind: 'debt-payment', accountId: loan.id, order: 'b0' })
    const pay = row({ name: 'Paid back', section: 'expense', kind: 'debt-payment', accountId: loan.id, order: 'b1' })
    const t = tables({ household: [household()], accounts: [loan], rows: [salary, draw, pay], cells: [cellValue(salary.id, '2026-01', 1000_00), cellValue(draw.id, '2026-01', -50_00), cellValue(pay.id, '2026-01', 400_00)] })
    const out = computeEngine({ tables: t, months })
    // 100 owed and 50 drawn: 150 can be paid back in January, then 50 a month, which is what is drawn each month
    expect(months.map((m) => out.cells[cellKey(draw.id, m)].value)).toEqual([-50_00, -50_00, -50_00])
    expect(months.map((m) => out.cells[cellKey(draw.id, m)].asked)).toEqual([undefined, undefined, undefined])
    expect(months.map((m) => out.cells[cellKey(pay.id, m)].value)).toEqual([150_00, 50_00, 50_00])
    expect(months.map((m) => out.accounts[loan.id].months[m].balance)).toEqual([0, 0, 0])
  })

  it('is not cut where nothing says what is owed: a loan without a balance, a row without a loan, the months before the loan', () => {
    const untracked = world(account({ name: 'Car loan', type: 'loan', openingBalance: 0, tracked: false }))
    expect(cellsOf(untracked.out, untracked.pay.id).map((c) => [c.value, c.asked])).toEqual(half.map(() => [250_00, undefined]))
    expect(untracked.out.accounts[untracked.pay.accountId!]).toBeUndefined()

    const later = world(account({ name: 'Car loan', type: 'loan', openingBalance: 300_00, openingMonth: '2026-03' }))
    // January and February are before the loan: paid in full. From March 300 is owed: 250, then 50, then nothing
    expect(cellsOf(later.out, later.pay.id).map((c) => c.value)).toEqual([250_00, 250_00, 250_00, 50_00, 0, 0])

    const salary = row({ name: 'Salary', section: 'income' })
    const loose = row({ name: 'Some debt', section: 'expense', kind: 'debt-payment', order: 'b0' })
    const t = tables({ household: [household()], rows: [salary, loose], cells: [cellValue(salary.id, '2026-01', 1000_00), cellValue(loose.id, '2026-01', 250_00)] })
    expect(months.map((m) => computeEngine({ tables: t, months }).cells[cellKey(loose.id, m)].value)).toEqual([250_00, 250_00, 250_00])
  })

  it('the items of a cut month give way in their order, and still add up to what counts', () => {
    const loan = account({ name: 'Car loan', type: 'loan', openingBalance: 150_00 })
    const salary = row({ name: 'Salary', section: 'income' })
    const pay = row({ name: 'Car loan – Payment', section: 'expense', kind: 'debt-payment', accountId: loan.id, order: 'b0' })
    const t = tables({ household: [household()], accounts: [loan], rows: [salary, pay], cells: [cellValue(salary.id, '2026-01', 1000_00), cellItems(pay.id, '2026-01', [{ amount: 100_00, label: 'Instalment' }, { amount: 200_00, label: 'Extra' }])] })
    const c = computeEngine({ tables: t, months }).cells[cellKey(pay.id, '2026-01')]
    expect(c).toMatchObject({ value: 150_00, asked: 300_00 })
    expect(c.items.map((i) => [i.label, i.amount, i.effectiveAmount])).toEqual([['Instalment', 100_00, 100_00], ['Extra', 200_00, 50_00]])
  })

  it('a row that follows a payment mirrors what counted', () => {
    const loan = account({ name: 'Car loan', type: 'loan', openingBalance: 600_00 })
    const fee = row({ name: 'Handling fee', section: 'expense', followShare: 0.1, order: 'b5' })
    const w = world(loan)
    const follower = { ...fee, followsRowId: w.pay.id }
    const out = computeEngine({ tables: { ...w.t, rows: [...w.t.rows, follower] }, months: half })
    expect(half.map((m) => out.cells[cellKey(follower.id, m)].value)).toEqual([25_00, 25_00, 10_00, 0, 0, 0])
    // and the month's expenses count the fee as it shows
    expect(half.map((m) => out.totals[m].cashExpense)).toEqual([25_00, 25_00, 10_00, 0, 0, 0])
  })
})
