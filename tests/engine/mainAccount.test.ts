import { describe, expect, it } from 'vitest'
import { buildStatement, computeEngine, currentAccountsIn, type StatementLine } from '@/engine'
import { FxRateSchema, monthRange } from '@/model'
import { T0, account, actual, cellValue, household, row, tables } from './helpers'

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
    const s = computeEngine({ tables: t, months }).main!
    expect(s.accountIds).toEqual([main.id, joint.id])
    for (const m of months) expect(s.months[m]).toEqual({ start: 1500_00, kept: 0, cardBought: 0, cardPaid: 0, computed: 1500_00, entered: false, adjustment: 0, balance: 1500_00 })
  })

  it('grows by the cash buffer every month under the savings plug', () => {
    const main = account({ name: 'Main', type: 'checking', openingBalance: 1000_00, tracked: false })
    const salary = row({ name: 'Salary', section: 'income' })
    const t = tables({ household: [household({ cashBuffer: 100_00 })], accounts: [main], rows: [salary], cells: [cellValue(salary.id, '2026-01', 2000_00)] })
    const s = computeEngine({ tables: t, months }).main!
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
    const s = computeEngine({ tables: t, months }).main!
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
    const s = out.main!
    expect(s.accountIds).toEqual([])
    // January: 150 bought and still to pay, 200 paid for what was owed before
    expect(s.months['2026-01']).toEqual({ start: 0, kept: 0, cardBought: 150_00, cardPaid: 200_00, computed: -50_00, entered: false, adjustment: 0, balance: -50_00 })
    // with the card's debt beside it, the two always net to what was owed at the start
    for (const m of months) expect(s.months[m].balance - out.accounts[card.id].months[m].balance).toBe(-200_00)
  })

  it('leaves a lump card alone: its payment is already an outflow of the month', () => {
    const card = account({ name: 'Amex', type: 'credit-card', openingBalance: 500_00, card: { cardMode: 'lump' } })
    const salary = row({ name: 'Salary', section: 'income' })
    const pay = row({ name: 'Pay Amex', section: 'transfer', kind: 'card-payment', accountId: card.id, order: 'c0' })
    const t = tables({ household: [household()], accounts: [card], rows: [salary, pay], cells: [cellValue(salary.id, '2026-01', 2000_00), cellValue(pay.id, '2026-01', 300_00)] })
    const s = computeEngine({ tables: t, months }).main!
    expect(s.months['2026-01']).toMatchObject({ cardBought: 0, cardPaid: 0, balance: 0 })
  })

  it('lets an account opened later join in its own month, converted at that month\'s rate', () => {
    const main = account({ name: 'Main', type: 'checking', openingBalance: 100_00, tracked: false })
    const usd = account({ name: 'Dollars', type: 'cash', currency: 'USD', openingBalance: 200_00, openingMonth: '2026-02', tracked: false, order: 'a1' })
    const t = tables({ household: [household()], accounts: [main, usd], fxRates: [fx('USD/EUR', '2026-01', 0.9)] })
    const s = computeEngine({ tables: t, months }).main!
    expect(months.map((m) => s.months[m].balance)).toEqual([100_00, 280_00, 280_00])
    expect(s.missingRate).toBe(false)
    const noRate = computeEngine({ tables: { ...t, fxRates: [] }, months }).main!
    expect(noRate.missingRate).toBe(true)
    expect(noRate.months['2026-02'].balance).toBe(300_00)
  })

  it('is there for every month asked for, counted from the household\'s first month; nothing without a household or a month', () => {
    const main = account({ name: 'Main', type: 'checking', openingBalance: 100000, tracked: false })
    const t = tables({ household: [household({ closingRule: 'savings-plug', cashBuffer: 5000 })], accounts: [main, account({ name: 'Savings', type: 'savings' })] })
    expect(computeEngine({ tables: t, months: [] }).main).toBeNull()
    expect(computeEngine({ tables: tables({}), months }).main).toBeNull()
    // asked for March alone, the balance still holds January's and February's buffer
    const march = computeEngine({ tables: t, months: ['2026-03'] }).main!
    expect(Object.keys(march.months)).toEqual(['2026-03'])
    expect(march.months['2026-03']).toMatchObject({ start: 110000, kept: 5000, balance: 115000 })
    expect(march.months['2026-03']).toEqual(computeEngine({ tables: t, months }).main!.months['2026-03'])
  })

  it('counts in net worth, beside the tracked accounts', () => {
    const main = account({ name: 'Main', type: 'checking', openingBalance: 100000, tracked: false })
    const savings = account({ name: 'Savings', type: 'savings', openingBalance: 300000 })
    const t = tables({ household: [household({ closingRule: 'savings-plug', cashBuffer: 5000 })], accounts: [main, savings] })
    const out = computeEngine({ tables: t, months })
    for (const m of months) expect(out.netWorth[m], m).toBe(out.accounts[savings.id].months[m].balance + out.main!.months[m].balance)
  })
})

describe('the main account: what the bank says', () => {
  /** Main holds 1,200 and Joint 300; 1,000 comes in and 700 goes out every month, and nothing takes the rest: 300 stays. */
  function world(over: { accounts?: ReturnType<typeof account>[]; accountMonths?: ReturnType<typeof actual>[]; fxRates?: ReturnType<typeof fx>[] } = {}) {
    const main = account({ name: 'Main', type: 'checking', openingBalance: 1200_00, tracked: false })
    const joint = account({ name: 'Joint', type: 'joint', openingBalance: 300_00, tracked: false, order: 'a1' })
    const salary = row({ name: 'Salary', section: 'income' })
    const rent = row({ name: 'Rent', section: 'expense', order: 'b0' })
    const t = tables({
      household: [household({ closingRule: 'leftover-plug' })], accounts: [main, joint, ...(over.accounts ?? [])], rows: [salary, rent],
      cells: [cellValue(salary.id, '2026-01', 1000_00), cellValue(rent.id, '2026-01', 700_00)], fxRates: over.fxRates ?? [],
    })
    return { t, main, joint }
  }

  it('takes the real balances once every current account has one, and later months continue from them', () => {
    const { t, main, joint } = world()
    t.accountMonths = [actual(main.id, '2026-01', 1400_00), actual(joint.id, '2026-01', 250_00)]
    const out = computeEngine({ tables: t, months })
    const s = out.main!
    // the plan says 1,500 + 300; the bank says 1,650
    expect(s.months['2026-01']).toEqual({ start: 1500_00, kept: 300_00, cardBought: 0, cardPaid: 0, computed: 1800_00, entered: true, adjustment: -150_00, balance: 1650_00 })
    expect(s.months['2026-02']).toEqual({ start: 1650_00, kept: 300_00, cardBought: 0, cardPaid: 0, computed: 1950_00, entered: false, adjustment: 0, balance: 1950_00 })
    expect(s.months['2026-03'].balance).toBe(2250_00)
    // net worth is the same figure
    expect(months.map((m) => out.netWorth[m])).toEqual([1650_00, 1950_00, 2250_00])
    // typed and equal to the plan: entered, nothing to explain
    t.accountMonths = [actual(main.id, '2026-01', 1500_00), actual(joint.id, '2026-01', 300_00)]
    expect(computeEngine({ tables: t, months }).main!.months['2026-01']).toMatchObject({ entered: true, adjustment: 0, balance: 1800_00 })
  })

  it('one account alone changes nothing: the plan only knows what they hold together', () => {
    const { t, main } = world()
    const calculated = computeEngine({ tables: t, months }).main!
    t.accountMonths = [actual(main.id, '2026-01', 9_00)]
    expect(computeEngine({ tables: t, months }).main).toEqual(calculated)
  })

  it('asks for an account only in the months it exists: opened later, archived from a month on', () => {
    const cash = account({ name: 'Wallet', type: 'cash', openingBalance: 50_00, openingMonth: '2026-02', tracked: false, order: 'a2' })
    const { t, main, joint } = world({ accounts: [cash] })
    Object.assign(t.accounts.find((a) => a.id === joint.id)!, { archivedMonth: '2026-03' })
    expect(months.map((m) => currentAccountsIn(t.accounts, m).map((a) => a.name))).toEqual([['Main', 'Joint'], ['Main', 'Joint', 'Wallet'], ['Main', 'Wallet']])
    // a savings account, a card and a deleted account are never asked for
    expect(currentAccountsIn([account({ name: 'S', type: 'savings' }), account({ name: 'V', type: 'credit-card' }), { ...main, deletedAt: T0 }], '2026-02')).toEqual([])
    t.accountMonths = [
      actual(main.id, '2026-01', 1400_00), actual(joint.id, '2026-01', 250_00), // January: both there
      actual(main.id, '2026-02', 1500_00), actual(joint.id, '2026-02', 250_00), // February: the wallet is missing
      actual(main.id, '2026-03', 1900_00), actual(cash.id, '2026-03', 20_00), // March: the joint account is gone
    ]
    const s = computeEngine({ tables: t, months }).main!
    expect(months.map((m) => s.months[m].entered)).toEqual([true, false, true])
    // February is worked out from January's real 1,650: 300 kept and the wallet's 50 joining
    expect(s.months['2026-02'].balance).toBe(2000_00)
    expect(s.months['2026-03']).toMatchObject({ computed: 2300_00, balance: 1920_00, adjustment: -380_00 })
  })

  it('counts a balance in another currency at that month\'s rate', () => {
    const usd = account({ name: 'Dollars', type: 'cash', currency: 'USD', openingBalance: 0, tracked: false, order: 'a2' })
    const { t, main, joint } = world({ accounts: [usd], fxRates: [fx('USD/EUR', '2026-01', 0.9)] })
    t.accountMonths = [actual(main.id, '2026-01', 1500_00), actual(joint.id, '2026-01', 300_00), actual(usd.id, '2026-01', 200_00)]
    const s = computeEngine({ tables: t, months }).main!
    expect(s.months['2026-01']).toMatchObject({ entered: true, balance: 1980_00, adjustment: 180_00 })
    expect(s.missingRate).toBe(false)
  })

  it('the Statement shows it as an entered balance whose parts still add up, and both halves balance', () => {
    const { t, main, joint } = world()
    const find = (lines: StatementLine[], id: string) => lines.find((l) => l.id === id)!
    const before = buildStatement(t, computeEngine({ tables: t, months }), '2026-01')!
    expect(find(before.position.left.lines, 'main')).toMatchObject({ label: 'Current accounts', amount: 1800_00, calculated: true, chip: 'calculated', currentAccountIds: [main.id, joint.id] })
    expect(find(before.position.left.lines, 'main').entered).toBeUndefined()

    t.accountMonths = [actual(main.id, '2026-01', 1400_00), actual(joint.id, '2026-01', 250_00)]
    const out = computeEngine({ tables: t, months })
    for (const m of months) {
      const s = buildStatement(t, out, m)!
      expect(s.flow.difference, `${m} month`).toBe(0)
      expect(s.position.difference, `${m} position`).toBe(0)
      const line = find(s.position.left.lines, 'main')
      expect(line.children.reduce((sum, c) => sum + c.amount, 0), m).toBe(line.amount)
      expect(find(s.position.right.lines, 'net-worth').amount).toBe(out.netWorth[m])
    }
    const jan = find(buildStatement(t, out, '2026-01')!.position.left.lines, 'main')
    expect(jan).toMatchObject({ amount: 1650_00, change: 150_00, entered: true, adjustment: -150_00 })
    expect(jan.chip).toBeUndefined()
    expect(jan.calculated).toBeUndefined()
    expect(jan.children.map((c) => [c.label, c.amount])).toEqual([['At the start of the month', 1500_00], ['Kept this month', 300_00], ['Not in the plan', -150_00]])
    // the month after is worked out again, from the real number
    expect(find(buildStatement(t, out, '2026-02')!.position.left.lines, 'main')).toMatchObject({ amount: 1950_00, calculated: true, chip: 'calculated' })
  })
})

