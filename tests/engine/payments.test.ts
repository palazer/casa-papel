import { describe, expect, it } from 'vitest'
import { buildPayments, buildStatement, computeEngine, type StatementLine } from '@/engine'
import { EntitySchema, PaymentMethodSchema, PoolSchema, RecurringItemSchema, accountRef, monthRange, newId, poolRef, type Account, type PaymentKind, type Tables } from '@/model'
import { applyMutations, planRecurringPosts } from '@/store'
import { buildDemoTables } from '@/demo/demoHousehold'
import { T0, account, cellItems, cellValue, household, row, tables } from './helpers'

const MONTH = '2026-11'
const TODAY = '2026-11-22'
const method = (name: string, acc: Account, kind: PaymentKind, ownerEntityId: string | null = null) =>
  PaymentMethodSchema.parse({ id: newId(), createdAt: T0, updatedAt: T0, name, kind, note: acc.name, ownerEntityId })
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

  it('what is tracked and what is not add up to the list; "to pay", "done" and the sums per method and person are over what is tracked', () => {
    const { pay } = of(demo)
    const tracked = pay.payments.filter((p) => p.tracked)
    const loose = pay.payments.filter((p) => !p.tracked)
    expect(tracked.length).toBeGreaterThan(3)
    expect(loose.length).toBeGreaterThan(3)
    expect(pay.untracked).toEqual({ count: loose.length, total: sum(loose) })
    expect(sum(tracked) + pay.untracked.total).toBe(sum(pay.payments))
    for (const p of loose) expect(p, p.label).toMatchObject({ day: null, methodId: null, dayFrom: null, methodFrom: null, state: 'untracked' })
    for (const p of tracked) expect(p.day != null || p.methodId != null, p.label).toBe(true)
    expect(pay.toPay + pay.paid).toBe(sum(tracked))
    expect(pay.methods.reduce((s, m) => s + m.total, 0)).toBe(sum(tracked))
    expect(pay.methods.reduce((s, m) => s + m.count, 0)).toBe(tracked.length)
    expect(pay.methods.reduce((s, m) => s + m.left, 0)).toBe(pay.toPay)
    expect(pay.people.reduce((s, a) => s + a.total, 0)).toBe(sum(tracked))
    expect(pay.people.reduce((s, a) => s + a.left, 0)).toBe(pay.toPay)
    // a row that is "Paid by card" counts like any other once it is tracked: a method is a label
    expect(tracked.find((p) => p.label === 'Subscriptions')).toMatchObject({ day: null, tracked: true })
  })
})

describe('where a payment stands, and what says its day and its method', () => {
  const h = household({ startMonth: '2026-10' })
  const sam = person('Sam')
  const main = account({ name: 'Main', type: 'checking', tracked: false, openingMonth: '2026-10' })
  const own = account({ name: "Sam's account", type: 'joint', openingMonth: '2026-10', openingBalance: 500_00, ownerEntityId: sam.id })
  const savings = account({ name: 'Savings', type: 'savings', openingMonth: '2026-10', openingBalance: 5000_00 })
  const visa = account({ name: 'Visa', type: 'credit-card', openingMonth: '2026-10', openingBalance: 300_00 })
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
  const subs = row({ name: 'Subscriptions', section: 'expense', order: 'b6', payDay: 3 })
  const cardBill = row({ name: 'Visa – Payment', section: 'expense', kind: 'card-payment', accountId: visa.id, order: 'b9', payDay: 28, payMethodId: sepa.id })
  const toSavings = row({ name: 'To savings', section: 'transfer', kind: 'to-savings', accountId: savings.id, order: 'c1' })
  // a method and no day; and neither, ticked on the Statement
  const water = row({ name: 'Water', section: 'expense', order: 'b7', payMethodId: sepa.id })
  const cleaning = row({ name: 'Cleaning', section: 'expense', order: 'b8' })
  const t = tables({
    household: [h], entities: [sam], accounts: [main, own, savings, visa], pools: [travel], paymentMethods: [sepa, byHand, visaCard],
    rows: [salary, phone, gym, rent, groceries, insurance, flights, subs, cardBill, toSavings, water, cleaning],
    cells: [
      cellValue(water.id, '2026-10', 30_00), cellItems(cleaning.id, '2026-11', [{ amount: 60_00, status: 'done' }]),
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

  it('in the current month: overdue, today, coming, without a day, done; with neither a day nor a method, untracked', () => {
    expect(named('Phone')).toMatchObject({ day: 12, state: 'overdue', done: false, tracked: true })
    expect(named('Gym')).toMatchObject({ day: 22, state: 'today' })
    expect(named('Flights')).toMatchObject({ day: 30, state: 'coming' })
    // a method tracks an amount by itself: it has no day to stand on
    expect(named('Water')).toMatchObject({ day: null, methodId: sepa.id, state: 'no-day', tracked: true })
    expect(named('Rent')).toMatchObject({ day: 25, state: 'done', done: true })
    expect(named('Groceries')).toMatchObject({ day: null, methodId: null, state: 'untracked', tracked: false })
    // ticked on the Statement and still untracked: that list says nothing about done
    expect(named('Cleaning')).toMatchObject({ done: true, state: 'untracked', tracked: false })
    expect(named('To savings')).toMatchObject({ automatic: true, state: 'untracked' })
    expect(pay.overdue).toBe(pay.payments.filter((p) => p.state === 'overdue').length)
    expect(pay.untracked).toEqual({ count: 3, total: 600_00 + 60_00 + named('To savings').amount })
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
    // Films follows its row; Music says both for itself
    expect(named('Films')).toMatchObject({ methodId: null, ask: null, dayFrom: 'row', methodFrom: null, tracked: true })
    expect(named('Music')).toMatchObject({ methodId: byHand.id, ask: 'hand', dayFrom: 'item', methodFrom: 'item' })
    expect(named('Films').soleItemId).toBeUndefined()
  })

  it('a row\'s one amount says where its day and method come from, and names the one item behind it', () => {
    expect(named('Phone')).toMatchObject({ dayFrom: 'row', methodFrom: 'row' })
    expect([named('Phone').itemId, named('Phone').soleItemId, named('Phone').scheduleId]).toEqual([undefined, undefined, undefined])
    // the rent's month is a list with one item: the line is the row's, and the item can hold a day of its own
    const rentItem = t.cells.find((c) => c.rowId === rent.id && c.month === MONTH)!.items[0]
    expect(named('Rent')).toMatchObject({ soleItemId: rentItem.id, dayFrom: 'row', methodFrom: null })
    expect(named('Rent').itemId).toBeUndefined()
    // carried from October: the amount is not this month's own, so there is no item of this month to write to
    expect(named('Gym').soleItemId).toBeUndefined()
  })

  it('an item its schedule posted follows the schedule, and names it while it runs', () => {
    const schedule = (over: object) => RecurringItemSchema.parse({ id: newId(), createdAt: T0, updatedAt: T0, name: 'Plan', rowId: phone.id, amount: 45_00, startMonth: '2026-10', payDay: 5, methodId: byHand.id, ...over })
    const running = schedule({})
    const ended = schedule({ endMonth: '2026-10' })
    const withItem = (s: { id: string }, own: object = {}): Tables => ({
      ...t, recurringItems: [running, ended],
      cells: [...t.cells, cellItems(phone.id, MONTH, [{ label: 'Plan', amount: 45_00, recurringItemId: s.id, ...own }])],
    })
    const phoneOf = (tb: Tables) => of(tb).pay.payments.find((p) => p.rowId === phone.id)!
    // the schedule's day and method count before the row's (the 12th by direct debit)
    expect(phoneOf(withItem(running))).toMatchObject({ day: 5, methodId: byHand.id, dayFrom: 'schedule', methodFrom: 'schedule', scheduleId: running.id })
    expect(phoneOf(withItem(running)).soleItemId).toBeDefined()
    // the item's own day counts before both; the method is still the schedule's
    expect(phoneOf(withItem(running, { date: `${MONTH}-09` }))).toMatchObject({ day: 9, dayFrom: 'item', methodFrom: 'schedule', scheduleId: running.id })
    // what an ended schedule posted still follows it, but there is no schedule left to change from this month on
    expect(phoneOf(withItem(ended))).toMatchObject({ day: 5, dayFrom: 'schedule' })
    expect(phoneOf(withItem(ended)).scheduleId).toBeUndefined()
  })

  it('a tracked amount counts in "to pay" whatever its row is: what is paid with a card, and the payment to that card, both', () => {
    expect(named('Visa – Payment')).toMatchObject({ day: 28, methodId: sepa.id, tracked: true })
    const open = pay.payments.filter((p) => p.tracked && !p.done)
    expect(open.map((p) => p.label)).toEqual(expect.arrayContaining(['Films', 'Music', 'Visa – Payment']))
    expect(pay.toPay).toBe(sum(open))
    expect(pay.paid).toBe(1200_00)
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

  it('the sums per method: in the methods\' own order, what names no method last; a method nothing is paid with has no line', () => {
    expect(pay.methods.map((m) => m.label)).toEqual(['Direct debit', 'Transfer', 'No method'])
    // the phone, the water and the card's payment
    expect(pay.methods[0]).toMatchObject({ methodId: sepa.id, total: 45_00 + 30_00 + 25_00, left: 45_00 + 30_00 + 25_00, count: 3 })
    // the gym and one of the subscriptions
    expect(pay.methods[1]).toMatchObject({ methodId: byHand.id, total: 40_00 + 11_00, count: 2 })
    // tracked by a day alone: the rent (done), the insurance, the flights, the other subscription
    expect(pay.methods[2]).toMatchObject({ methodId: null, total: 1200_00 + 90_00 + 300_00 + 14_00, left: 90_00 + 300_00 + 14_00, count: 4 })
    expect(pay.methods.some((m) => m.methodId === visaCard.id)).toBe(false)
  })

  it('who pays: the method\'s owner; the household for a shared method and for what names none', () => {
    expect(named('Gym').ownerId).toBe(sam.id)
    expect(named('Music').ownerId).toBe(sam.id)
    // it comes out of Sam's account, and that says nothing about who makes the payment
    expect(named('Insurance').ownerId).toBeNull()
    expect(named('Phone').ownerId).toBeNull()
    expect(pay.people.map((p) => [p.label, p.total, p.count])).toEqual([['Household', pay.toPay + pay.paid - 51_00, 7], ['Sam', 40_00 + 11_00, 2]])
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
