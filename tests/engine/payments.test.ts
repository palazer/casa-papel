import { describe, expect, it } from 'vitest'
import { buildPayments, buildStatement, computeEngine, type StatementLine } from '@/engine'
import { EntitySchema, PaymentMethodSchema, PoolSchema, accountRef, monthRange, newId, poolRef, type Account, type PaymentKind, type Tables } from '@/model'
import { applyMutations, planRecurringPosts } from '@/store'
import { buildDemoTables } from '@/demo/demoHousehold'
import { T0, account, cellItems, cellValue, household, row, tables } from './helpers'

const MONTH = '2026-11'
const TODAY = '2026-11-22'
const method = (name: string, acc: Account, kind: PaymentKind, ownerEntityId: string | null = null) =>
  PaymentMethodSchema.parse({ id: newId(), createdAt: T0, updatedAt: T0, name, kind, accountId: acc.id, ownerEntityId })
const person = (name: string) => EntitySchema.parse({ id: newId(), createdAt: T0, updatedAt: T0, kind: 'adult', name })

function of(t: Tables, month = MONTH, today = TODAY) {
  const months = monthRange(t.household[0].startMonth, month > '2026-12' ? month : '2026-12')
  const engine = computeEngine({ tables: t, months })
  return { engine, statement: buildStatement(t, engine, month)!, pay: buildPayments(t, engine, month, today)! }
}
/** Every line of a side, at every depth. */
const flat = (lines: StatementLine[]): StatementLine[] => lines.flatMap((l) => [l, ...flat(l.children)])
const sum = (list: Array<{ amount: number }>) => list.reduce((s, x) => s + x.amount, 0)

describe('a month\'s payments are its Statement\'s money out', () => {
  const months = monthRange('2026-09', '2027-12')
  const base = buildDemoTables()
  const demo = applyMutations(base, planRecurringPosts(base, months))

  it('every row of "Money out" with an amount is listed, and its payments add up to its line', () => {
    for (const month of ['2026-09', '2026-11', '2027-03']) {
      const { statement, pay } = of(demo, month)
      const rows = flat(statement.flow.right.lines).filter((l) => l.kind === 'row' && l.rowId && l.amount !== 0)
      expect(rows.length).toBeGreaterThan(5)
      for (const line of rows) {
        const mine = pay.payments.filter((p) => p.rowId === line.rowId)
        expect(mine.length, `${line.label} ${month}`).toBeGreaterThan(0)
        expect(sum(mine), `${line.label} ${month}`).toBe(line.amount)
      }
      expect(new Set(pay.payments.map((p) => p.rowId)).size).toBe(rows.length)
      // no income is on the list
      const incoming = new Set(flat(statement.flow.left.lines.filter((l) => l.id === 'income')).map((l) => l.rowId).filter(Boolean))
      expect(incoming.size).toBeGreaterThan(0)
      expect(pay.payments.some((p) => incoming.has(p.rowId))).toBe(false)
    }
  })

  it('with what the Statement works out besides (kept, the leftover), the list is the whole of "Money out"', () => {
    const { statement, pay } = of(demo)
    const figures = flat(statement.flow.right.lines).filter((l) => l.kind === 'figure' && !l.memo)
    expect(sum(pay.payments.filter((p) => !p.memo)) + sum(figures)).toBe(statement.flow.right.total)
  })

  it('the totals per account and per person each add up to the list; "to pay" and "paid" leave out what is bought on a card', () => {
    const { pay } = of(demo)
    const all = sum(pay.payments)
    expect(pay.accounts.reduce((s, a) => s + a.total, 0)).toBe(all)
    expect(pay.people.reduce((s, a) => s + a.total, 0)).toBe(all)
    for (const a of pay.accounts) {
      expect(a.methods.reduce((s, m) => s + m.total, 0), a.label).toBe(a.total)
      expect(a.methods.reduce((s, m) => s + m.left, 0), a.label).toBe(a.left)
    }
    const onCard = pay.payments.filter((p) => p.onCard)
    expect(onCard.map((p) => p.label)).toContain('Subscriptions')
    expect(pay.toPay + pay.paid).toBe(all - sum(onCard))
    const card = pay.accounts.find((a) => a.card)!
    expect(card.total).toBe(sum(onCard))
    expect(card.owed?.amount).toBeGreaterThan(0)
    // the demo has no row that pays the card
    expect(card.paidBy).toEqual([])
  })
})

describe('where a payment stands, and where it leaves', () => {
  const h = household({ startMonth: '2026-10' })
  const sam = person('Sam')
  const main = account({ name: 'Main', type: 'checking', tracked: false, openingMonth: '2026-10' })
  const own = account({ name: "Sam's account", type: 'joint', openingMonth: '2026-10', openingBalance: 500_00, ownerEntityId: sam.id })
  const savings = account({ name: 'Savings', type: 'savings', openingMonth: '2026-10', openingBalance: 5000_00 })
  const visa = account({ name: 'Visa', type: 'credit-card', openingMonth: '2026-10', card: { cardMode: 'itemized' } })
  const travel = PoolSchema.parse({ id: newId(), createdAt: T0, updatedAt: T0, name: 'Travel', accountId: savings.id, openingBalance: 800_00 })
  const sepa = method('Direct debit', main, 'direct-debit')
  const byHand = method('Transfer', main, 'transfer', sam.id)
  const visaCard = method('Visa card', visa, 'credit-card', sam.id)
  const salary = row({ name: 'Salary', section: 'income', order: 'a0' })
  const phone = row({ name: 'Phone', section: 'expense', order: 'b0', payDay: 12, payMethodId: sepa.id })
  const gym = row({ name: 'Gym', section: 'expense', order: 'b1', payDay: 22, payMethodId: byHand.id })
  const rent = row({ name: 'Rent', section: 'expense', order: 'b2', payDay: 25 })
  const groceries = row({ name: 'Groceries', section: 'expense', order: 'b3' })
  const insurance = row({ name: 'Insurance', section: 'expense', order: 'b4', payDay: 1, defaultFundedBy: accountRef(own.id) })
  const flights = row({ name: 'Flights', section: 'expense', order: 'b5', payDay: 31, defaultFundedBy: poolRef(travel.id) })
  const subs = row({ name: 'Subscriptions', section: 'expense', order: 'b6', payDay: 3, accountId: visa.id })
  const cardBill = row({ name: 'Visa – Payment', section: 'transfer', kind: 'card-payment', accountId: visa.id, order: 'c0', payDay: 28, payMethodId: sepa.id })
  const toSavings = row({ name: 'To savings', section: 'transfer', kind: 'to-savings', accountId: savings.id, order: 'c1' })
  const t = tables({
    household: [h], entities: [sam], accounts: [main, own, savings, visa], pools: [travel], paymentMethods: [sepa, byHand, visaCard],
    rows: [salary, phone, gym, rent, groceries, insurance, flights, subs, cardBill, toSavings],
    cells: [
      cellValue(salary.id, '2026-10', 3000_00), cellValue(phone.id, '2026-10', 45_00), cellValue(gym.id, '2026-10', 40_00), cellValue(rent.id, '2026-10', 1200_00),
      cellValue(groceries.id, '2026-10', 600_00), cellValue(insurance.id, '2026-10', 90_00), cellValue(flights.id, '2026-11', 300_00), cellValue(cardBill.id, '2026-11', 25_00),
      cellItems(rent.id, '2026-11', [{ amount: 1200_00, status: 'done' }]),
      cellItems(subs.id, '2026-11', [
        { label: 'Films', amount: 14_00 }, { label: 'Music', amount: 11_00, methodId: byHand.id, date: '2026-11-18' }, { label: 'Paper', amount: 9_00, skipped: true },
      ]),
    ],
  })
  const { pay } = of(t)
  const named = (label: string) => pay.payments.find((p) => p.label === label)!

  it('in the current month: overdue, today, coming, without a day, done', () => {
    expect(named('Phone')).toMatchObject({ day: 12, state: 'overdue', done: false })
    expect(named('Gym')).toMatchObject({ day: 22, state: 'today' })
    expect(named('Flights')).toMatchObject({ day: 30, state: 'coming' })
    expect(named('Groceries')).toMatchObject({ day: null, state: 'no-day' })
    expect(named('Rent')).toMatchObject({ day: 25, state: 'done', done: true })
    expect(pay.overdue).toBe(pay.payments.filter((p) => p.state === 'overdue').length)
  })

  it('in any other month a payment with a day is open, whenever today is', () => {
    const october = of(t, '2026-10').pay
    expect(october.payments.find((p) => p.label === 'Phone')).toMatchObject({ day: 12, state: 'open' })
    expect(october.overdue).toBe(0)
    expect(of(t, '2026-12').pay.payments.find((p) => p.label === 'Phone')?.state).toBe('open')
  })

  it('a row that lists items gives a payment per item, each with its own day and method; a skipped one is not a payment', () => {
    expect(pay.payments.filter((p) => p.rowId === subs.id).map((p) => [p.label, p.rowLabel, p.amount, p.day, p.itemId != null])).toEqual([
      ['Films', 'Subscriptions', 14_00, 3, true], ['Music', 'Subscriptions', 11_00, 18, true],
    ])
    // Films follows the row onto the card; Music is paid by hand from the main account
    expect(named('Films')).toMatchObject({ accountId: visa.id, onCard: true, methodId: visaCard.id, ask: 'buying' })
    expect(named('Music')).toMatchObject({ accountId: main.id, onCard: false, methodId: byHand.id, ask: 'hand' })
  })

  it('without a method the account is the one the amount comes out of; a transfer leaves the main account', () => {
    expect(named('Groceries')).toMatchObject({ accountId: main.id, methodId: null, ask: null })
    expect(named('Insurance')).toMatchObject({ accountId: own.id })
    expect(named('Flights')).toMatchObject({ accountId: savings.id })
    expect(named('To savings')).toMatchObject({ accountId: main.id, automatic: true })
    // the card's payment is real money leaving the main account, though the Statement counts it in no sum
    expect(named('Visa – Payment')).toMatchObject({ accountId: main.id, memo: true, onCard: false, day: 28, methodId: sepa.id })
    expect(pay.toPay).toBe(sum(pay.payments.filter((p) => !p.onCard && !p.done)))
    expect(pay.toPay).toBeGreaterThan(25_00)
  })

  it('the Statement says a line\'s day while payments are planned by day, the same day as the list; off, no line has one', () => {
    const every = (tb: Tables) => {
      const { statement } = of(tb)
      return flat([...statement.flow.left.lines, ...statement.flow.right.lines, ...statement.position.left.lines, ...statement.position.right.lines])
    }
    expect(every(t).some((l) => l.day != null)).toBe(false)

    const on: Tables = { ...t, household: [{ ...h, payments: true }] }
    const lines = new Map(every(on).map((l) => [l.id, l]))
    const list = of(on).pay
    expect(list.payments.length).toBe(pay.payments.length)
    for (const p of list.payments) expect(lines.get(p.id)?.day ?? null, p.label).toBe(p.day)
    expect(lines.get(phone.id)?.day).toBe(12)
    // "Flights" is paid on the 31st, and November has thirty days
    expect(lines.get(flights.id)?.day).toBe(30)
    // the subscriptions go out on different days (the 3rd and the 18th): each item says its own, the row says none
    const items = lines.get(subs.id)!.children
    expect(items.map((l) => [l.label, l.day])).toEqual([['Films', 3], ['Music', 18], ['Paper', undefined]])
    expect(lines.get(subs.id)?.day).toBeUndefined()
    // money that comes in has no day yet
    expect(lines.get(salary.id)?.day).toBeUndefined()
    expect(flat(of(on).statement.flow.left.lines).some((l) => l.day != null)).toBe(false)
  })

  it('a row whose items all go out on one day says that day itself, and a row without an amount says none', () => {
    const on: Tables = {
      ...t, household: [{ ...h, payments: true }],
      cells: [...t.cells, cellItems(gym.id, '2026-11', [{ label: 'Membership', amount: 30_00 }, { label: 'Sauna', amount: 10_00 }]), cellValue(phone.id, '2026-11', 0)],
    }
    const lines = new Map(flat(of(on).statement.flow.right.lines).map((l) => [l.id, l]))
    expect(lines.get(gym.id)?.day).toBe(22)
    expect(lines.get(gym.id)!.children.map((l) => l.day)).toEqual([22, 22])
    // typed as zero for the month: nothing to pay, so it is not on the list and has no day
    expect(lines.get(phone.id)?.amount).toBe(0)
    expect(lines.get(phone.id)?.day).toBeUndefined()
    expect(of(on).pay.payments.some((p) => p.rowId === phone.id)).toBe(false)
  })

  it('the account totals: the main account first, a method at a time, the card with what is owed and what pays it', () => {
    expect(pay.accounts.map((a) => a.label)).toEqual(['Main', "Sam's account", 'Savings', 'Visa'])
    const first = pay.accounts[0]
    expect(first.methods.map((m) => m.label)).toEqual(['Direct debit', 'Transfer', 'No method yet'])
    expect(first.methods[0]).toMatchObject({ total: 45_00 + 25_00, count: 2 })
    const card = pay.accounts[3]
    expect(card).toMatchObject({ card: true, total: 14_00, owed: { amount: 14_00 - 25_00, currency: 'EUR' }, paidBy: [cardBill.id] })
  })

  it('who pays: the method\'s owner, else the owner of the account it leaves, else the household', () => {
    expect(named('Gym').ownerId).toBe(sam.id)
    expect(named('Insurance').ownerId).toBe(sam.id)
    expect(named('Phone').ownerId).toBeNull()
    expect(pay.people.map((p) => p.label)).toEqual(['Household', 'Sam'])
    expect(pay.people[1].total).toBe(40_00 + 90_00 + 14_00 + 11_00)
  })

  it('a row kept in another currency: its items take their share of the row\'s amount in the household\'s currency', () => {
    const dollars = row({ name: 'Software', section: 'expense', order: 'b9', currency: 'USD' })
    const withRate = tables({
      ...t, rows: [...t.rows, dollars],
      cells: [...t.cells, cellItems(dollars.id, '2026-11', [{ label: 'Editor', amount: 10_00 }, { label: 'Hosting', amount: 23_33 }, { label: 'Fonts', amount: 7_77 }])],
      fxRates: [{ pair: 'EUR/USD', month: '2026-11', rate: 1.17, source: 'manual', date: null, updatedAt: T0 }, { pair: 'EUR/USD', month: '2026-10', rate: 1.17, source: 'manual', date: null, updatedAt: T0 }, { pair: 'EUR/USD', month: '2026-12', rate: 1.17, source: 'manual', date: null, updatedAt: T0 }],
    })
    const r = of(withRate)
    const line = flat(r.statement.flow.right.lines).find((l) => l.rowId === dollars.id && l.kind === 'row')!
    const mine = r.pay.payments.filter((p) => p.rowId === dollars.id)
    expect(mine.map((p) => p.native)).toEqual([{ amount: 10_00, currency: 'USD' }, { amount: 23_33, currency: 'USD' }, { amount: 7_77, currency: 'USD' }])
    expect(sum(mine)).toBe(line.amount)
  })
})
