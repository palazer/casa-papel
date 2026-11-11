import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { buildStatement, computeEngine, type EngineOutput, type Statement, type StatementLine } from '@/engine'
import { CategorySchema, FxRateSchema, GoalSchema, monthRange, newId, poolRef, type Goal, type MonthKey, type Tables } from '@/model'
import { applyMutations, planRecurringPosts, ruleMutations, type RuleChoice, type RuleTarget } from '@/store'
import { buildDemoTables } from '@/demo/demoHousehold'
import type { RawFixture } from './fixtures/rawFixture'
import { v2ToTables } from './fixtures/v2Adapter'
import { T0, account, actual, cellItems, cellValue, household, pool, row, tables } from './helpers'

const months = monthRange('2026-01', '2026-03')
const fixture = JSON.parse(readFileSync(new URL('./golden/v2-raw.json', import.meta.url), 'utf8')) as RawFixture
const fx = (pair: string, month: string, rate: number) => FxRateSchema.parse({ pair, month, rate, source: 'manual', updatedAt: T0 })
const goal = (over: Partial<Goal> & { name: string; kind: Goal['kind'] }): Goal => GoalSchema.parse({ id: newId(), createdAt: T0, updatedAt: T0, order: 'a0', startMonth: '2026-01', ...over })

const walk = (lines: StatementLine[]): StatementLine[] => lines.flatMap((l) => [l, ...walk(l.children)])
const all = (s: Statement) => walk([...s.flow.left.lines, ...s.flow.right.lines, ...s.position.left.lines, ...s.position.right.lines])
const find = (s: Statement, id: string) => all(s).find((l) => l.id === id)
const topLine = (s: Statement, sideKey: 'in' | 'out' | 'assets' | 'claims', id: string) =>
  [s.flow.left, s.flow.right, s.position.left, s.position.right].find((x) => x.key === sideKey)!.lines.find((l) => l.id === id)

function statementFor(t: Tables, m: MonthKey, range: MonthKey[] = months): { s: Statement; out: EngineOutput } {
  const out = computeEngine({ tables: t, months: range })
  return { s: buildStatement(t, out, m)!, out }
}

/** Both halves agree, every heading is the sum of what sits under it, and the figures match the engine's own totals. */
function expectSound(t: Tables, range: MonthKey[]) {
  const out = computeEngine({ tables: t, months: range })
  for (const m of range) {
    const s = buildStatement(t, out, m)!
    const tot = out.totals[m]
    expect(s.flow.difference, `${m} month`).toBe(0)
    expect(s.position.difference, `${m} position`).toBe(0)
    expect(s.position.left.change, `${m} change`).toBe(s.position.right.change)
    for (const side of [s.flow.left, s.flow.right, s.position.left, s.position.right]) {
      expect(side.total, `${m} ${side.key}`).toBe(side.lines.reduce((a, l) => a + l.amount, 0))
    }
    for (const l of all(s)) {
      // a row's children are its items, in the row's own currency
      if (l.children.length === 0 || l.kind === 'row') continue
      expect(l.amount, `${m} ${l.label}`).toBe(l.children.reduce((a, c) => (c.memo ? a : a + c.amount), 0))
      if (l.change != null && l.kind !== 'account') expect(l.change, `${m} ${l.label} change`).toBe(l.children.reduce((a, c) => a + (c.change ?? 0), 0))
    }
    const amountOf = (sideKey: 'in' | 'out', id: string) => topLine(s, sideKey, id)?.amount ?? 0
    expect(amountOf('in', 'income') + amountOf('in', 'from-accounts'), `${m} income`).toBe(tot.income)
    expect(amountOf('in', 'from-accounts'), `${m} taken from accounts`).toBe(tot.fromAccounts)
    expect(amountOf('in', 'sources'), `${m} from savings`).toBe(tot.fromSavingsDerived)
    // what covers a short month sits on the left; taken back out, the right side is the engine's outflows and closing figures
    expect(s.flow.right.total - amountOf('in', 'cover'), `${m} outflows`).toBe(tot.expensesTotal + tot.allocations + tot.toInvestment + tot.toSavings + tot.leftover)
    // one net worth: the Statement's is the engine's, and both count what stays in the main account
    expect(find(s, 'main')?.amount ?? 0, `${m} main account`).toBe(out.main?.months[m]?.balance ?? 0)
    expect(topLine(s, 'claims', 'net-worth')!.amount, `${m} net worth`).toBe(out.netWorth[m] ?? 0)
  }
}

describe('the Statement balances', () => {
  const demo = buildDemoTables()
  const demoMonths = monthRange('2026-09', '2027-12')
  const posted = applyMutations(demo, planRecurringPosts(demo, demoMonths))
  const v2 = v2ToTables(fixture)
  const withRule = (t: Tables, closingRule: 'savings-plug' | 'leftover-plug'): Tables => ({ ...t, household: t.household.map((h) => ({ ...h, closingRule })) })

  it.each(['savings-plug', 'leftover-plug'] as const)('for every month of the demo household (%s)', (rule) => {
    expectSound(withRule(demo, rule), demoMonths)
    expectSound(withRule(posted, rule), demoMonths)
  })

  it.each(['savings-plug', 'leftover-plug'] as const)('for every month of the public fixture (%s)', (rule) => {
    expectSound(withRule(v2.tables, rule), v2.months)
  })

  it.each(['savings-plug', 'leftover-plug'] as const)('with a rule on every account from a month on, and the months before it as they were (%s)', (rule) => {
    const rainy = account({ name: 'Rainy day', type: 'savings', openingMonth: '2026-09', order: 'zz' })
    const start: Tables = { ...withRule(posted, rule), accounts: [...posted.accounts, rainy] }
    const from: MonthKey = '2027-01'
    const named = (name: string) => start.rows.find((r) => r.name === name)!
    let t = start
    const set = (target: RuleTarget, choice: RuleChoice) => { t = applyMutations(t, ruleMutations(t, target, choice, from).mutations) }
    set({ rowId: named('To investments').id }, { kind: 'share-of-income', share: 0.1 })
    set({ rowId: named('To Travel').id }, { kind: 'share-of-rest', share: 0.25 })
    set({ rowId: named('To Clothing').id }, { kind: 'fixed', amount: 9000 })
    // the rest moves to a second savings account (or is taken for the first time), and the first one gets half of what is left
    set({ accountId: rainy.id }, { kind: 'rest' })
    set({ rowId: named('To savings').id }, { kind: 'share-of-rest', share: 0.5 })
    expect(t.household[0].closingRule).toBe('savings-plug')
    expectSound(t, demoMonths)
    const was = computeEngine({ tables: start, months: demoMonths })
    const now = computeEngine({ tables: t, months: demoMonths })
    expect(now.totals['2027-02'].rest).not.toBeNull()
    for (const m of demoMonths.filter((x) => x < from)) {
      expect(now.netWorth[m], m).toBe(was.netWorth[m])
      expect({ ...now.totals[m], rest: null, leftForShares: 0 }, m).toEqual({ ...was.totals[m], rest: null, leftForShares: 0 })
    }
  })

  it.each(['savings-plug', 'leftover-plug'] as const)('and the change in net worth is the month: income minus spending plus what investments earned (%s)', (rule) => {
    const t = withRule(posted, rule)
    const out = computeEngine({ tables: t, months: demoMonths })
    for (const m of demoMonths) {
      const s = buildStatement(t, out, m)!
      const tot = out.totals[m]
      const growth = t.accounts.filter((a) => a.type === 'investment').reduce((g, a) => {
        const line = find(s, `acc:${a.id}`)!
        const r = out.accounts[a.id].months[m]
        return g + line.change! - r.inflow + r.outflow
      }, 0)
      // money taken out of your own accounts comes in without being earned
      expect(topLine(s, 'claims', 'net-worth')!.change, m).toBe(tot.income - tot.fromAccounts - (tot.expensesTotal - tot.debt) + growth)
    }
  })
})

describe('the Statement, the month', () => {
  it('sorts the demo\'s September into its two sides', () => {
    const t = buildDemoTables()
    const { s } = statementFor(t, '2026-09', monthRange('2026-09', '2026-12'))
    expect(s.closed).toBe(true)
    expect(s.flow.left.lines.map((l) => l.label)).toEqual(['Income', 'Taken from accounts'])
    // the section for money taken out of accounts by hand is always there, empty until a row is added in it
    expect(topLine(s, 'in', 'from-accounts')).toMatchObject({ amount: 0, empty: true, children: [] })
    expect(s.flow.left.total).toBe(725500)
    expect(s.flow.right.lines.map((l) => l.label)).toEqual(['Expenses', 'Set aside, pay off'])
    const expenses = topLine(s, 'out', 'expenses')!
    expect(expenses.children.map((c) => c.label)).toEqual(['Housing', 'Living', 'Transport', 'Family & pets', 'Fun', 'Personal', 'Pocket money'])
    expect(expenses.children.find((c) => c.label === 'Housing')).toMatchObject({ kind: 'category', amount: 186000 })
    expect(expenses.children.find((c) => c.label === 'Pocket money')!.children.map((c) => [c.label, c.amount, c.automatic])).toEqual([['Sam – Pocket', 50000, false], ['Alex – Pocket', 50000, false]])
    // an itemized row opens to its items
    expect(find(s, expenses.children.find((c) => c.label === 'Personal')!.children[0].id)!.children.map((c) => [c.label, c.amount, c.status])).toEqual([['Concert tickets', 9000, 'done'], ['Books', 3200, 'done']])
    const setAside = topLine(s, 'out', 'set-aside')!
    expect(setAside.children.map((c) => c.label)).toEqual(['To savings', 'To investments', 'To Travel', 'To Clothing'])
    // the rest: income − expenses − pocket money − the three typed transfers
    expect(setAside.children[0]).toMatchObject({ balancing: true, automatic: true, amount: 725500 - 335700 - 100000 - 80000 })
    expect(expenses.amount).toBe(335700 + 100000)
  })

  it('shows spending from a virtual account on both sides', () => {
    const { s } = statementFor(buildDemoTables(), '2026-10', monthRange('2026-09', '2026-12'))
    const sources = topLine(s, 'in', 'sources')!
    expect(sources).toMatchObject({ label: 'From savings and virtual accounts', amount: 48000 })
    expect(sources.children.map((c) => [c.kind, c.label, c.amount])).toEqual([['source', 'Travel', 48000]])
    expect(sources.children[0].children.map((c) => [c.kind, c.label])).toEqual([['note', 'Travel']])
    expect(find(s, 'cat:expense:' + sources.children[0].children[0].rowId)).toBeUndefined()
    expect(all(s).find((l) => l.kind === 'row' && l.label === 'Travel')!.amount).toBe(48000)
  })

  it('marks an estimate on its line and on the category above it', () => {
    const { s } = statementFor(buildDemoTables(), '2026-11', monthRange('2026-09', '2026-12'))
    const coat = all(s).find((l) => l.kind === 'row' && l.label === 'Clothing')!
    expect(coat).toMatchObject({ estimate: true, status: 'projected', amount: 18000 })
    expect(all(s).find((l) => l.kind === 'category' && l.label === 'Fun')!.estimate).toBe(true)
    // an amount carried forward on a row that defaults to an estimate is one too; a certain row is not
    expect(all(s).find((l) => l.kind === 'row' && l.label === 'The flat – Utilities')).toMatchObject({ estimate: true, amount: 21000 })
    expect(all(s).find((l) => l.kind === 'row' && l.label === 'Robin – Childcare')).toMatchObject({ estimate: false, amount: 38000 })
    expect(all(s).find((l) => l.kind === 'category' && l.label === 'Housing')!.estimate).toBe(true)
    expect(all(s).find((l) => l.kind === 'row' && l.label === 'Other income')).toMatchObject({ estimate: true, amount: 15000 })
    expect(all(s).find((l) => l.kind === 'row' && l.label === 'Sam – Salary')!.estimate).toBe(false)
  })

  it('a short month under the savings plug takes from savings on the left', () => {
    const savings = account({ name: 'Savings', type: 'savings', openingBalance: 2000_00 })
    const salary = row({ name: 'Salary', section: 'income' })
    const rent = row({ name: 'Rent', section: 'expense', order: 'b0' })
    const toSavings = row({ name: 'To savings', section: 'transfer', kind: 'to-savings', accountId: savings.id, order: 'c0' })
    const t = tables({ household: [household({ cashBuffer: 50_00 })], accounts: [savings], rows: [salary, rent, toSavings], cells: [cellValue(salary.id, '2026-01', 1000_00), cellValue(rent.id, '2026-01', 1500_00)] })
    const { s } = statementFor(t, '2026-01')
    const cover = topLine(s, 'in', 'cover')!
    expect(cover.label).toBe('To cover the month')
    expect(cover.children.map((c) => [c.label, c.amount, c.balancing, c.rowId])).toEqual([['From Savings', 550_00, true, toSavings.id]])
    expect(topLine(s, 'out', 'set-aside')!.children.map((c) => [c.label, c.amount])).toEqual([['Kept in account', 50_00]])
    expect([s.flow.left.total, s.flow.right.total]).toEqual([1550_00, 1550_00])
    expect(find(s, `acc:${savings.id}`)).toMatchObject({ amount: 1450_00, change: -550_00 })
    expectSound(t, months)
  })

  it('a short month with a typed savings amount takes from the account on the left', () => {
    const main = account({ name: 'Main', type: 'checking', openingBalance: 500_00, tracked: false })
    const salary = row({ name: 'Salary', section: 'income' })
    const rent = row({ name: 'Rent', section: 'expense', order: 'b0' })
    const toSavings = row({ name: 'To savings', section: 'transfer', kind: 'to-savings', order: 'c0' })
    const t = tables({ household: [household({ closingRule: 'leftover-plug' })], accounts: [main], rows: [salary, rent, toSavings], cells: [cellValue(salary.id, '2026-01', 1000_00), cellValue(rent.id, '2026-01', 1200_00), cellValue(toSavings.id, '2026-01', 100_00), cellValue(rent.id, '2026-02', 600_00)] })
    const { s } = statementFor(t, '2026-01')
    expect(topLine(s, 'in', 'cover')!.children.map((c) => [c.label, c.amount, c.balancing])).toEqual([['From the account', 300_00, true]])
    expect(topLine(s, 'out', 'set-aside')!.children.map((c) => [c.label, c.amount, c.balancing])).toEqual([['To savings', 100_00, undefined]])
    expect(find(s, 'main')).toMatchObject({ label: 'Main', amount: 200_00, change: -300_00, calculated: true })
    // a good month closes on the right with the leftover
    const feb = statementFor(t, '2026-02').s
    expect(topLine(feb, 'in', 'cover')).toBeUndefined()
    expect(topLine(feb, 'out', 'set-aside')!.children.map((c) => [c.label, c.amount, c.balancing])).toEqual([['To savings', 100_00, undefined], ['Leftover', 300_00, true]])
    expectSound(t, months)
  })

  it('keeps the rest in the sum when the plug has no row to land in, and says so', () => {
    const salary = row({ name: 'Salary', section: 'income' })
    const t = tables({ household: [household()], rows: [salary], cells: [cellValue(salary.id, '2026-01', 1000_00)] })
    const { s } = statementFor(t, '2026-01')
    expect(topLine(s, 'out', 'set-aside')!.children.map((c) => [c.label, c.amount, c.balancing])).toEqual([['To savings', 1000_00, true]])
    expect(s.warnings).toEqual(['The rest of the month has no "To savings" row to go to.'])
    expectSound(t, months)
  })

  it('carries a foreign amount in the household currency and remembers the original', () => {
    const savings = account({ name: 'Savings', type: 'savings', openingBalance: 1000_00 })
    const salary = row({ name: 'Salary', section: 'income', currency: 'USD' })
    const hotel = row({ name: 'Hotel', section: 'expense', currency: 'USD', order: 'b0' })
    const lost = row({ name: 'Fees', section: 'expense', currency: 'GBP', order: 'b1' })
    const toSavings = row({ name: 'To savings', section: 'transfer', kind: 'to-savings', accountId: savings.id, order: 'c0' })
    const t = tables({
      household: [household()], accounts: [savings], rows: [salary, hotel, lost, toSavings], fxRates: [fx('USD/EUR', '2026-01', 0.9137)],
      // three parts that each round on their own: cash, savings, and no rounding luck
      cells: [cellValue(salary.id, '2026-01', 3000_00), cellItems(hotel.id, '2026-01', [{ label: 'Night one', amount: 33_33 }, { label: 'Night two', amount: 33_33, fundedBy: 'savings' }, { label: 'Tax', amount: 1_11 }]), cellValue(lost.id, '2026-01', 10_00)],
    })
    const { s, out } = statementFor(t, '2026-01')
    expect(all(s).find((l) => l.label === 'Salary')).toMatchObject({ amount: 2741_10, native: { amount: 3000_00, currency: 'USD' } })
    const hotelLine = all(s).find((l) => l.kind === 'row' && l.label === 'Hotel')!
    const f = out.cells[`${hotel.id}|2026-01`].funding
    expect(hotelLine.amount).toBe(f.cash + f.savings)
    // the items stay in the row's own currency
    expect(hotelLine.children.map((c) => [c.label, c.amount, c.currency])).toEqual([['Night one', 33_33, 'USD'], ['Night two', 33_33, 'USD'], ['Tax', 1_11, 'USD']])
    expect(all(s).find((l) => l.label === 'Fees')).toMatchObject({ missingRate: true, amount: 10_00, native: { amount: 10_00, currency: 'GBP' } })
    expect(topLine(s, 'in', 'sources')!.children.map((c) => [c.label, c.amount])).toEqual([['Savings', f.savings]])
    expectSound(t, months)
  })

  it('keeps an itemized card\'s payment out of the sum and counts a lump card\'s', () => {
    const visa = account({ name: 'Visa', type: 'credit-card', openingBalance: 200_00, card: { cardMode: 'itemized' } })
    const amex = account({ name: 'Amex', type: 'credit-card', openingBalance: 500_00, card: { cardMode: 'lump' }, order: 'a1' })
    const salary = row({ name: 'Salary', section: 'income' })
    const shopping = row({ name: 'Shopping', section: 'expense', accountId: visa.id, order: 'b0' })
    const payVisa = row({ name: 'Pay Visa', section: 'transfer', kind: 'card-payment', accountId: visa.id, order: 'c0' })
    const payAmex = row({ name: 'Pay Amex', section: 'transfer', kind: 'card-payment', accountId: amex.id, order: 'c1' })
    const t = tables({ household: [household()], accounts: [visa, amex], rows: [salary, shopping, payVisa, payAmex], cells: [cellValue(salary.id, '2026-01', 2000_00), cellValue(shopping.id, '2026-01', 150_00), cellValue(payVisa.id, '2026-01', 200_00), cellValue(payAmex.id, '2026-01', 300_00)] })
    const { s } = statementFor(t, '2026-01')
    const setAside = topLine(s, 'out', 'set-aside')!
    expect(setAside.children.map((c) => [c.label, c.amount, !!c.memo])).toEqual([['Pay Visa', 200_00, true], ['Pay Amex', 300_00, false], ['To savings', 1550_00, false]])
    expect(setAside.amount).toBe(1850_00)
    expect(topLine(s, 'claims', 'debts')!.children.map((c) => [c.label, c.amount, c.change])).toEqual([['Visa', 150_00, -50_00], ['Amex', 200_00, -300_00]])
    // the main account holds the 150 still to pay and gave 200 for what was owed before
    expect(find(s, 'main')).toMatchObject({ label: 'Main account', amount: -50_00, change: -50_00 })
    expect(find(s, 'main')!.children.map((c) => [c.label, c.amount])).toEqual([['At the start of the month', 0], ['Bought on the card, not yet paid', 150_00], ['Paid to the card', -200_00]])
    expectSound(t, months)
  })

  it('gives plain transfers, withdrawals and deductions their own places', () => {
    const invest = account({ name: 'Fund', type: 'investment', openingBalance: 5000_00 })
    const salary = row({ name: 'Salary', section: 'income' })
    const tax = row({ name: 'Tax', section: 'expense', deductedFromRowId: salary.id, followsRowId: salary.id, followShare: 0.25, order: 'b0' })
    const gift = row({ name: 'To grandma', section: 'transfer', order: 'c0' })
    const sell = row({ name: 'Sell fund', section: 'transfer', kind: 'from-investment', accountId: invest.id, order: 'c1' })
    const t = tables({ household: [household()], accounts: [invest], rows: [salary, tax, gift, sell], cells: [cellValue(salary.id, '2026-01', 4000_00), cellValue(gift.id, '2026-01', 100_00), cellValue(sell.id, '2026-01', 500_00)] })
    const { s } = statementFor(t, '2026-01')
    expect(s.flow.left.lines.map((l) => [l.label, l.amount])).toEqual([['Income', 4000_00], ['Taken from accounts', 500_00]])
    expect(all(s).find((l) => l.label === 'Salary')!.net).toBe(3000_00)
    expect(all(s).find((l) => l.label === 'Tax')).toMatchObject({ amount: 1000_00, automatic: true })
    expect(s.flow.right.lines.map((l) => [l.label, l.amount])).toEqual([['Expenses', 1000_00], ['Moved elsewhere', 100_00], ['Set aside, pay off', 3400_00]])
    expectSound(t, months)
  })

  it('lists rows without a heading when the section has no categories, and under "No category" when it has some', () => {
    const salary = row({ name: 'Salary', section: 'income' })
    const rent = row({ name: 'Rent', section: 'expense', order: 'b0' })
    const food = row({ name: 'Food', section: 'expense', order: 'b1' })
    const cells = [cellValue(salary.id, '2026-01', 3000_00), cellValue(rent.id, '2026-01', 1000_00), cellValue(food.id, '2026-01', 400_00)]
    const plain = statementFor(tables({ household: [household()], rows: [salary, rent, food], cells }), '2026-01').s
    expect(topLine(plain, 'out', 'expenses')!.children.map((c) => [c.kind, c.label])).toEqual([['row', 'Rent'], ['row', 'Food']])
    const housing = CategorySchema.parse({ id: newId(), createdAt: T0, updatedAt: T0, name: 'Housing', section: 'expense', order: 'a0' })
    const grouped = statementFor(tables({ household: [household()], categories: [housing], rows: [salary, { ...rent, categoryId: housing.id }, food], cells }), '2026-01').s
    expect(topLine(grouped, 'out', 'expenses')!.children.map((c) => [c.kind, c.label, c.amount])).toEqual([['category', 'Housing', 1000_00], ['category', 'No category', 400_00]])
    expect(topLine(grouped, 'in', 'income')!.children.map((c) => c.kind)).toEqual(['row'])
    // a category shows before it has a row, in its own place, so its first row can be added to it
    const hobbies = CategorySchema.parse({ id: newId(), createdAt: T0, updatedAt: T0, name: 'Hobbies', section: 'expense', order: 'a1' })
    const pay = CategorySchema.parse({ id: newId(), createdAt: T0, updatedAt: T0, name: 'Pay', section: 'income', order: 'a0' })
    const t = tables({ household: [household()], categories: [hobbies, housing, pay], rows: [salary, { ...rent, categoryId: housing.id }, food], cells })
    const withEmpty = statementFor(t, '2026-01').s
    expect(topLine(withEmpty, 'out', 'expenses')!.children.map((c) => [c.label, c.amount, !!c.empty, c.children.length])).toEqual([['Housing', 1000_00, false, 1], ['Hobbies', 0, true, 0], ['No category', 400_00, false, 1]])
    expect(topLine(withEmpty, 'in', 'income')!.children.map((c) => [c.label, c.amount, !!c.empty])).toEqual([['Pay', 0, true], ['No category', 3000_00, false]])
    expect(find(withEmpty, `cat:expense:${hobbies.id}`)).toMatchObject({ kind: 'category', estimate: false })
    expectSound(t, months)
  })
})

describe('the Statement, a category with an estimate', () => {
  const cat = (name: string, order: string) => CategorySchema.parse({ id: newId(), createdAt: T0, updatedAt: T0, name, section: 'expense', order })

  it('closes the category with what is not broken down yet, names the estimate, and lets the rows win', () => {
    const housing = cat('Housing', 'a0')
    const hobbies = cat('Hobbies', 'a1')
    const salary = row({ name: 'Salary', section: 'income' })
    const housingEstimate = row({ name: 'Housing – Not broken down yet', section: 'expense', kind: 'category-estimate', categoryId: housing.id, order: 'b0' })
    const rent = row({ name: 'Rent', section: 'expense', categoryId: housing.id, defaultStatus: 'committed', order: 'b1' })
    const power = row({ name: 'Electricity', section: 'expense', categoryId: housing.id, defaultStatus: 'committed', order: 'b2' })
    const hobbiesEstimate = row({ name: 'Hobbies – Not broken down yet', section: 'expense', kind: 'category-estimate', categoryId: hobbies.id, order: 'b3' })
    const t = tables({
      household: [household()], categories: [housing, hobbies], rows: [salary, housingEstimate, rent, power, hobbiesEstimate],
      cells: [
        cellValue(salary.id, '2026-01', 4000_00), cellValue(housingEstimate.id, '2026-01', 1450_00), cellValue(rent.id, '2026-01', 1100_00), cellValue(power.id, '2026-01', 90_00),
        cellValue(hobbiesEstimate.id, '2026-01', 60_00),
        // February: the rows explain Housing to the cent; March: they pass it
        cellValue(power.id, '2026-02', 350_00), cellValue(power.id, '2026-03', 440_00),
      ],
    })
    const jan = statementFor(t, '2026-01').s
    const housingLine = find(jan, `cat:expense:${housing.id}`)!
    expect(housingLine).toMatchObject({ amount: 1450_00, budget: 1450_00, estimate: true })
    // the rest comes last, whatever the rows' own order
    expect(housingLine.children.map((c) => [c.label, c.amount, !!c.estimate, c.estimateFor])).toEqual([['Rent', 1100_00, false, undefined], ['Electricity', 90_00, false, undefined], ['Not broken down yet', 260_00, true, housing.id]])
    expect(housingLine.children[2]).toMatchObject({ kind: 'row', rowId: housingEstimate.id, automatic: true, chip: 'automatic' })
    // a category that is only a name and a number counts on its own
    expect(find(jan, `cat:expense:${hobbies.id}`)).toMatchObject({ amount: 60_00, budget: 60_00, estimate: true })
    expect(find(jan, `cat:expense:${hobbies.id}`)!.empty).toBeUndefined()
    expect(topLine(jan, 'out', 'expenses')!.amount).toBe(1510_00)

    const feb = find(statementFor(t, '2026-02').s, `cat:expense:${housing.id}`)!
    expect(feb).toMatchObject({ amount: 1450_00, budget: 1450_00, estimate: false })
    expect(feb.children.map((c) => c.label)).toEqual(['Rent', 'Electricity'])

    const mar = find(statementFor(t, '2026-03').s, `cat:expense:${housing.id}`)!
    expect(mar).toMatchObject({ amount: 1540_00, budget: 1450_00 })
    expect(mar.children.map((c) => c.label)).toEqual(['Rent', 'Electricity'])
    expectSound(t, months)
  })

  it('stops counting the rest as an estimate once it is ticked, and drops an estimate whose category is gone', () => {
    const housing = cat('Housing', 'a0')
    const salary = row({ name: 'Salary', section: 'income' })
    const estimate = row({ name: 'Housing – Not broken down yet', section: 'expense', kind: 'category-estimate', categoryId: housing.id, order: 'b0' })
    const base = { household: [household()], rows: [salary, estimate], cells: [cellValue(salary.id, '2026-01', 4000_00), { ...cellValue(estimate.id, '2026-01', 500_00), markedDone: true }] }
    const ticked = statementFor(tables({ ...base, categories: [housing] }), '2026-01').s
    expect(find(ticked, `cat:expense:${housing.id}`)).toMatchObject({ amount: 500_00, estimate: false })
    expect(find(ticked, `cat:expense:${housing.id}`)!.children[0]).toMatchObject({ label: 'Not broken down yet', status: 'done', estimate: false })
    const gone = tables({ ...base, categories: [{ ...housing, deletedAt: T0 }] })
    const orphan = statementFor(gone, '2026-01').s
    expect(topLine(orphan, 'out', 'expenses')).toMatchObject({ amount: 0, children: [] })
    expectSound(gone, months)
  })
})

describe('the Statement, the position', () => {
  function world(goals: Goal[] = []) {
    const main = account({ name: 'Main', type: 'checking', openingBalance: 1200_00, tracked: false })
    const savings = account({ name: 'Savings', type: 'savings', openingBalance: 8000_00, order: 'a1' })
    const fund = account({ name: 'Fund', type: 'investment', openingBalance: 5000_00, order: 'a2' })
    const visa = account({ name: 'Visa', type: 'credit-card', openingBalance: 1200_00, card: { cardMode: 'lump' }, order: 'a3' })
    const loan = account({ name: 'Car loan', type: 'loan', openingBalance: 8400_00, order: 'a4' })
    const travel = pool({ name: 'Travel', accountId: savings.id, openingBalance: 2000_00 })
    const salary = row({ name: 'Salary', section: 'income' })
    const rent = row({ name: 'Rent', section: 'expense', order: 'b0' })
    const trip = row({ name: 'Trip', section: 'expense', defaultFundedBy: poolRef(travel.id), order: 'b1' })
    const payLoan = row({ name: 'Car loan payment', section: 'expense', kind: 'debt-payment', accountId: loan.id, order: 'b2' })
    const payVisa = row({ name: 'Pay Visa', section: 'expense', kind: 'card-payment', accountId: visa.id, order: 'b3' })
    const toSavings = row({ name: 'To savings', section: 'transfer', kind: 'to-savings', accountId: savings.id, order: 'c0' })
    const toFund = row({ name: 'To fund', section: 'transfer', kind: 'to-investment', accountId: fund.id, order: 'c1' })
    const fill = row({ name: 'To Travel', section: 'transfer', kind: 'pool-allocation', accountId: savings.id, order: 'c2' })
    const t = tables({
      household: [household()], accounts: [main, savings, fund, visa, loan], pools: [{ ...travel, allocationRowId: fill.id }], goals,
      rows: [salary, rent, trip, payLoan, payVisa, toSavings, toFund, fill],
      cells: [
        cellValue(salary.id, '2026-01', 5400_00), cellValue(rent.id, '2026-01', 3350_00), cellValue(trip.id, '2026-01', 300_00), cellValue(payLoan.id, '2026-01', 350_00),
        cellValue(payVisa.id, '2026-01', 120_00), cellValue(toFund.id, '2026-01', 400_00), cellValue(fill.id, '2026-01', 150_00),
      ],
    })
    return { t, main, savings, fund, visa, loan, travel }
  }

  it('lists what there is on the left and whose it is on the right, with the month\'s change beside each', () => {
    const { t, savings, fund, visa, loan, travel } = world()
    const { s } = statementFor(t, '2026-01')
    // the rest: 5400 − 3350 − 350 − 120 − 400 − 150 = 1030
    expect(s.position.left.lines.map((l) => [l.label, l.amount, l.change])).toEqual([['Main', 1200_00, 0], ['Savings', 8880_00, 880_00], ['Fund', 5400_00, 400_00]])
    expect(find(s, `acc:${savings.id}`)).toMatchObject({ open: true })
    expect(find(s, `acc:${savings.id}`)!.children.map((c) => [c.kind, c.label, c.amount, c.change])).toEqual([['pool', 'Travel', 1850_00, -150_00], ['figure', 'Not set aside', 7030_00, 1030_00]])
    expect(find(s, `acc:${fund.id}`)!.children).toEqual([])
    expect(s.position.right.lines.map((l) => [l.label, l.amount, l.change])).toEqual([['Debts', 9130_00, -470_00], ['Net worth', 6350_00, 1750_00]])
    expect(topLine(s, 'claims', 'debts')!.children.map((c) => [c.accountId, c.amount, c.change])).toEqual([[visa.id, 1080_00, -120_00], [loan.id, 8050_00, -350_00]])
    expect(topLine(s, 'claims', 'net-worth')!.children.map((c) => [c.label, c.amount, c.change, !!c.balancing])).toEqual([['Set aside', 1850_00, -150_00, false], ['Free', 4500_00, 1900_00, true]])
    expect([s.position.left.total, s.position.right.total, s.position.left.change, s.position.right.change]).toEqual([15480_00, 15480_00, 1280_00, 1280_00])
    // the month's result, 5400 in and 3650 spent, is what net worth gained
    expect(topLine(s, 'claims', 'net-worth')!.change).toBe(5400_00 - 3650_00)
    expect(find(s, `pool:${travel.id}`)!.goals).toBeUndefined()
    expectSound(t, months)
  })

  it('puts a goal on the line it measures', () => {
    const w = world()
    const goals = [
      goal({ name: 'Trip of a lifetime', kind: 'pool-balance', poolId: w.travel.id, target: 10000_00 }),
      goal({ name: 'Card cleared', kind: 'pay-off', accountId: w.visa.id, targetMonth: '2026-02' }),
      goal({ name: 'Rainy day', kind: 'account-balance', accountId: w.savings.id, target: 9000_00 }),
      goal({ name: 'Comfortable', kind: 'net-worth', target: 20000_00 }),
    ]
    const { s } = statementFor({ ...w.t, goals }, '2026-01')
    expect(find(s, `pool:${w.travel.id}`)!.goals!.map((g) => [g.goal.name, g.current, g.target])).toEqual([['Trip of a lifetime', 1850_00, 10000_00]])
    expect(find(s, `acc:${w.visa.id}`)!.goals!.map((g) => [g.goal.name, g.current, g.startValue, g.status])).toEqual([['Card cleared', 1080_00, 1200_00, 'late']])
    expect(find(s, `acc:${w.savings.id}`)!.goals!.map((g) => g.goal.name)).toEqual(['Rainy day'])
    expect(topLine(s, 'claims', 'net-worth')!.goals!.map((g) => g.goal.name)).toEqual(['Comfortable'])
    expect(find(s, `acc:${w.fund.id}`)!.goals).toBeUndefined()
  })

  it('shows a foreign account in the household currency with its own balance beside it', () => {
    const usd = account({ name: 'Dollar savings', type: 'savings', currency: 'USD', openingBalance: 1000_00 })
    const t = tables({ household: [household()], accounts: [usd], fxRates: [fx('USD/EUR', '2026-01', 0.9), fx('USD/EUR', '2026-02', 0.8)] })
    const jan = statementFor(t, '2026-01').s
    expect(find(jan, `acc:${usd.id}`)).toMatchObject({ amount: 900_00, change: 0, native: { amount: 1000_00, currency: 'USD' } })
    // nothing moved in February; the rate did
    expect(find(statementFor(t, '2026-02').s, `acc:${usd.id}`)).toMatchObject({ amount: 800_00, change: -100_00 })
    const noRate = statementFor({ ...t, fxRates: [] }, '2026-01').s
    expect(find(noRate, `acc:${usd.id}`)).toMatchObject({ missingRate: true, amount: 1000_00 })
  })

  it('marks a balance someone entered, and how far it is from the plan', () => {
    const savings = account({ name: 'Savings', type: 'savings', openingBalance: 1000_00 })
    const visa = account({ name: 'Visa', type: 'credit-card', openingBalance: 300_00, card: { cardMode: 'lump' }, order: 'a1' })
    const usd = account({ name: 'Dollars', type: 'savings', currency: 'USD', openingBalance: 500_00, order: 'a2' })
    const t = tables({
      household: [household()], accounts: [savings, visa, usd], fxRates: [fx('USD/EUR', '2026-01', 0.9)],
      accountMonths: [actual(savings.id, '2026-01', 1000_00), actual(visa.id, '2026-01', 700_00), actual(usd.id, '2026-01', 600_00)],
    })
    const jan = statementFor(t, '2026-01').s
    // entered and equal to the plan: nothing to explain (a savings account cannot tell that case from no entry)
    expect(find(jan, `acc:${savings.id}`)).toMatchObject({ amount: 1000_00, change: 0 })
    expect(find(jan, `acc:${savings.id}`)!.adjustment).toBeUndefined()
    // a card that records only its payments: the new debt arrives with the entered balance
    expect(find(jan, `acc:${visa.id}`)).toMatchObject({ amount: 700_00, change: 400_00, entered: true, adjustment: 400_00 })
    // another currency: the difference is told in the household currency
    expect(find(jan, `acc:${usd.id}`)).toMatchObject({ amount: 540_00, entered: true, adjustment: 90_00 })
    // the month after carries on from the real number, with nothing entered
    const feb = statementFor(t, '2026-02').s
    expect(find(feb, `acc:${visa.id}`)).toMatchObject({ amount: 700_00, change: 0 })
    expect(find(feb, `acc:${visa.id}`)!.entered).toBeUndefined()
    expectSound(t, months)
  })

  it('has nothing to say about a month the engine did not compute', () => {
    const t = tables({ household: [household()] })
    expect(buildStatement(t, computeEngine({ tables: t, months }), '2027-01')).toBeNull()
    expect(buildStatement(tables({}), computeEngine({ tables: tables({}), months }), '2026-01')).toBeNull()
  })
})
