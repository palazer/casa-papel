import { describe, expect, it } from 'vitest'
import { buildStatement, computeEngine, mainAccountsIn, type StatementLine } from '@/engine'
import { FxRateSchema, monthRange } from '@/model'
import { T0, account, actual, cellValue, household, row, tables } from './helpers'

const months = monthRange('2026-01', '2026-03')
const fx = (pair: string, month: string, rate: number) => FxRateSchema.parse({ pair, month, rate, source: 'manual', updatedAt: T0 })

describe('the main account: what stays behind', () => {
  it('starts from its opening balance and stays put when the month passes everything on; an other current account keeps its own (rule B9)', () => {
    const main = account({ name: 'Main', type: 'checking', openingBalance: 1200_00, tracked: false })
    const joint = account({ name: 'Joint', type: 'joint', openingBalance: 300_00, tracked: false, order: 'a1' })
    const savings = account({ name: 'Savings', type: 'savings', openingBalance: 5000_00, order: 'a2' })
    const salary = row({ name: 'Salary', section: 'income' })
    const rent = row({ name: 'Rent', section: 'expense', order: 'b0' })
    const toSavings = row({ name: 'To savings', section: 'transfer', kind: 'to-savings', accountId: savings.id, order: 'c0' })
    const t = tables({ household: [household()], accounts: [joint, savings, main], rows: [salary, rent, toSavings], cells: [cellValue(salary.id, '2026-01', 3000_00), cellValue(rent.id, '2026-01', 1000_00)] })
    const out = computeEngine({ tables: t, months })
    const s = out.main!
    expect(s.accountIds).toEqual([main.id])
    for (const m of months) expect(s.months[m]).toEqual({ start: 1200_00, kept: 0, computed: 1200_00, entered: false, adjustment: 0, balance: 1200_00 })
    // its flag says untracked, as every current account was stored: it has a balance all the same, counted in net worth
    expect(months.map((m) => out.accounts[joint.id].months[m].balance)).toEqual([300_00, 300_00, 300_00])
    for (const m of months) expect(out.netWorth[m]).toBe(1200_00 + 300_00 + out.accounts[savings.id].months[m].balance)
  })

  it('an other current account rises with a transfer row into it and falls with an expense that comes out of it, and the main account the other way', () => {
    const main = account({ name: 'Main', type: 'checking', openingBalance: 1000_00, tracked: false })
    const joint = account({ name: 'Joint', type: 'joint', openingBalance: 100_00, tracked: false, order: 'a1' })
    const salary = row({ name: 'Salary', section: 'income' })
    const toJoint = row({ name: 'To Joint', section: 'transfer', kind: 'plain', accountId: joint.id, order: 'c0' })
    const groceries = row({ name: 'Groceries', section: 'expense', order: 'b0', defaultFundedBy: `account:${joint.id}` })
    const t = tables({
      household: [household({ closingRule: 'leftover-plug' })], accounts: [main, joint], rows: [salary, toJoint, groceries],
      cells: [cellValue(salary.id, '2026-01', 2000_00), cellValue(toJoint.id, '2026-01', 500_00), cellValue(groceries.id, '2026-01', 200_00)],
    })
    const out = computeEngine({ tables: t, months: ['2026-01'] })
    expect(out.accounts[joint.id].months['2026-01']).toMatchObject({ start: 100_00, inflow: 500_00, outflow: 200_00, balance: 400_00 })
    // the month kept what was not moved: 2,000 in, 500 moved, the groceries paid by the joint account
    expect(out.main!.months['2026-01']).toMatchObject({ kept: 1500_00, balance: 2500_00 })
    expect(out.netWorth['2026-01']).toBe(2900_00)
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

  it('a card takes nothing out of the main account but its payment, which is an outflow of the month like any other', () => {
    const card = account({ name: 'Visa', type: 'credit-card', openingBalance: 500_00 })
    const salary = row({ name: 'Salary', section: 'income' })
    // a row that still names the card, as "Paid by card" did before schema 23: it comes out of the month like any expense
    const shopping = row({ name: 'Shopping', section: 'expense', accountId: card.id, order: 'b0' })
    const pay = row({ name: 'Pay Visa', section: 'expense', kind: 'card-payment', accountId: card.id, order: 'c0' })
    const t = tables({ household: [household()], accounts: [card], rows: [salary, shopping, pay], cells: [cellValue(salary.id, '2026-01', 2000_00), cellValue(shopping.id, '2026-01', 150_00), cellValue(pay.id, '2026-01', 200_00)] })
    const out = computeEngine({ tables: t, months })
    const s = out.main!
    expect(s.accountIds).toEqual([])
    // the plug takes what the month leaves after the shopping and the payment: nothing waits in the account for a bill
    expect(s.months['2026-01']).toEqual({ start: 0, kept: 0, computed: 0, entered: false, adjustment: 0, balance: 0 })
    expect(out.totals['2026-01'].toSavings).toBe(2000_00 - 150_00 - 200_00)
    expect(out.accounts[card.id].months['2026-01'].balance).toBe(300_00)
  })

  it('in data from before rule B9, a second main account opened later joins in its own month, converted at that month\'s rate, until the upgrade puts it right', () => {
    const main = account({ name: 'Main', type: 'checking', openingBalance: 100_00, tracked: false })
    const usd = account({ name: 'Dollars', type: 'checking', currency: 'USD', openingBalance: 200_00, openingMonth: '2026-02', tracked: false, order: 'a1' })
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
  /** Main holds 1,200 and Joint, an other current account, 300; 1,000 comes in and 700 goes out every month, and nothing takes the rest: 300 stays. */
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

  it('takes the main account\'s real balance, and later months continue from it; an other current account takes its own, and net worth is what both together gave before rule B9', () => {
    const { t, main, joint } = world()
    t.accountMonths = [actual(main.id, '2026-01', 1400_00), actual(joint.id, '2026-01', 250_00)]
    const out = computeEngine({ tables: t, months })
    const s = out.main!
    // the plan says 1,500; the bank says 1,400
    expect(s.months['2026-01']).toEqual({ start: 1200_00, kept: 300_00, computed: 1500_00, entered: true, adjustment: -100_00, balance: 1400_00, real: { [main.id]: { own: 1400_00, base: 1400_00 } } })
    expect(s.months['2026-02']).toEqual({ start: 1400_00, kept: 300_00, computed: 1700_00, entered: false, adjustment: 0, balance: 1700_00 })
    expect(s.months['2026-03'].balance).toBe(2000_00)
    expect(out.accounts[joint.id].months['2026-01']).toMatchObject({ computed: 300_00, entered: true, adjustment: -50_00, balance: 250_00 })
    expect(out.accounts[joint.id].months['2026-03'].balance).toBe(250_00)
    expect(months.map((m) => out.netWorth[m])).toEqual([1650_00, 1950_00, 2250_00])
    // typed and equal to the plan: entered, nothing to explain
    t.accountMonths = [actual(main.id, '2026-01', 1500_00)]
    expect(computeEngine({ tables: t, months }).main!.months['2026-01']).toMatchObject({ entered: true, adjustment: 0, balance: 1500_00 })
  })

  it('an other current account\'s real balance is its own: the main account\'s line stays as it was', () => {
    const { t, joint } = world()
    const calculated = computeEngine({ tables: t, months }).main!
    t.accountMonths = [actual(joint.id, '2026-01', 9_00)]
    const out = computeEngine({ tables: t, months })
    expect(out.main).toEqual(calculated)
    expect(out.accounts[joint.id].months['2026-02'].balance).toBe(9_00)
  })

  it('asks for a main account only in the months it is open; where an archived one and the one that replaced it were both open, it needs both', () => {
    const second = account({ name: 'Second', type: 'checking', openingBalance: 50_00, openingMonth: '2026-02', tracked: false, order: 'a2' })
    const { t, main } = world({ accounts: [second] })
    Object.assign(t.accounts.find((a) => a.id === main.id)!, { archivedMonth: '2026-03' })
    expect(months.map((m) => mainAccountsIn(t.accounts, m).map((a) => a.name))).toEqual([['Main'], ['Main', 'Second'], ['Second']])
    // an other current account, a savings account, a card, cash and a deleted account are never asked for here
    expect(mainAccountsIn([account({ name: 'J', type: 'joint' }), account({ name: 'S', type: 'savings' }), account({ name: 'V', type: 'credit-card' }), account({ name: 'Wallet', type: 'cash' }), { ...main, deletedAt: T0 }], '2026-02')).toEqual([])
    t.accountMonths = [
      actual(main.id, '2026-01', 1400_00), // January: the one there
      actual(main.id, '2026-02', 1500_00), // February: the one that replaced it is missing
      actual(second.id, '2026-03', 1900_00), // March: the old one is archived
    ]
    const s = computeEngine({ tables: t, months }).main!
    expect(months.map((m) => s.months[m].entered)).toEqual([true, false, true])
    // February is worked out from January's real 1,400: 300 kept and the new account's 50 joining
    expect(s.months['2026-02'].balance).toBe(1750_00)
    expect(s.months['2026-03']).toMatchObject({ computed: 2050_00, balance: 1900_00, adjustment: -150_00 })
    // the line is named after the open one; in February both stand under it, counted together
    const feb = buildStatement(t, computeEngine({ tables: t, months }), '2026-02')!.position.left.lines.find((l) => l.id === 'main')!
    expect(feb.label).toBe('Second')
    expect(feb.children.filter((c) => c.memo).map((c) => [c.label, c.chip])).toEqual([['Main', 'counted together'], ['Second', 'counted together']])
  })

  it('in data from before rule B9, a main account in another currency counts at that month\'s rate', () => {
    const usd = account({ name: 'Dollars', type: 'checking', currency: 'USD', openingBalance: 0, tracked: false, order: 'a2' })
    const { t, main } = world({ accounts: [usd], fxRates: [fx('USD/EUR', '2026-01', 0.9)] })
    t.accountMonths = [actual(main.id, '2026-01', 1500_00), actual(usd.id, '2026-01', 200_00)]
    const s = computeEngine({ tables: t, months }).main!
    expect(s.months['2026-01']).toMatchObject({ entered: true, balance: 1680_00, adjustment: 180_00 })
    expect(s.missingRate).toBe(false)
  })

  it('an other current account in another currency keeps its balance in that currency, worth what each month\'s rate makes of it (rule X6)', () => {
    const usd = account({ name: 'Dollars', type: 'joint', currency: 'USD', openingBalance: 1100_00, tracked: false, order: 'a2' })
    const { t } = world({ accounts: [usd], fxRates: [fx('USD/EUR', '2026-01', 0.9), fx('USD/EUR', '2026-02', 0.8), fx('USD/EUR', '2026-03', 0.85)] })
    const s = computeEngine({ tables: t, months }).accounts[usd.id]
    expect(months.map((m) => [s.months[m].balance, s.months[m].balanceBase])).toEqual([[1100_00, 990_00], [1100_00, 880_00], [1100_00, 935_00]])
  })

  it('the Statement shows it as an entered balance whose parts still add up, and both halves balance', () => {
    const { t, main, joint } = world()
    const find = (lines: StatementLine[], id: string) => lines.find((l) => l.id === id)!
    const before = buildStatement(t, computeEngine({ tables: t, months }), '2026-01')!
    expect(find(before.position.left.lines, 'main')).toMatchObject({ label: 'Main', accountKind: 'main account', amount: 1500_00, calculated: true, chip: 'calculated', currentAccountIds: [main.id] })
    expect(find(before.position.left.lines, 'main').entered).toBeUndefined()
    // the lines under it explain the figure; no account stands under it
    expect(find(before.position.left.lines, 'main').children.map((c) => [c.label, c.kind])).toEqual([['At the start of the month', 'note'], ['Kept this month', 'note']])
    // the other current account stands among the other assets, and says what it is
    expect(find(find(before.position.left.lines, 'other-assets').children, `acc:${joint.id}`)).toMatchObject({ label: 'Joint', accountKind: 'current account', amount: 300_00, accountId: joint.id })

    t.accountMonths = [actual(main.id, '2026-01', 1400_00), actual(joint.id, '2026-01', 250_00)]
    const out = computeEngine({ tables: t, months })
    for (const m of months) {
      const s = buildStatement(t, out, m)!
      expect(s.flow.difference, `${m} month`).toBe(0)
      expect(s.position.difference, `${m} position`).toBe(0)
      const line = find(s.position.left.lines, 'main')
      // the lines that explain the figure add up to it; the accounts are listed beside them and counted once
      expect(line.children.reduce((sum, c) => (c.memo ? sum : sum + c.amount), 0), m).toBe(line.amount)
      expect(find(s.position.right.lines, 'net-worth').amount).toBe(out.netWorth[m])
    }
    const jan = find(buildStatement(t, out, '2026-01')!.position.left.lines, 'main')
    expect(jan).toMatchObject({ amount: 1400_00, change: 200_00, entered: true, adjustment: -100_00 })
    expect(jan.chip).toBeUndefined()
    expect(jan.calculated).toBeUndefined()
    expect(jan.children.map((c) => [c.label, c.amount])).toEqual([['At the start of the month', 1200_00], ['Kept this month', 300_00], ['Not in the plan', -100_00]])
    // the month after is worked out again, from the real number
    expect(find(buildStatement(t, out, '2026-02')!.position.left.lines, 'main')).toMatchObject({ amount: 1700_00, calculated: true, chip: 'calculated' })
    // a main account named for what it is says no kind after its name
    const named = { ...t, accounts: t.accounts.map((a) => (a.id === main.id ? { ...a, name: 'Main account' } : a)) }
    expect(find(buildStatement(named, computeEngine({ tables: named, months }), '2026-01')!.position.left.lines, 'main').accountKind).toBeUndefined()
  })
})

