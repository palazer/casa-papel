import { describe, expect, it } from 'vitest'
import { buildDemoTables } from '@/demo/demoHousehold'
import { computeEngine } from '@/engine'
import { RecurringItemSchema, monthRange, newId, type Tables } from '@/model'
import { applyMutations, planCards } from '@/store'
import { T0, account, actual, cellValue, household, row, tables } from '../engine/helpers'

/**
 * Credit cards as they were stored before schema 23, written here as plain records: a card had a mode, a card whose
 * purchases were expense rows was paid by a row under Transfers, and an expense row named the card it was bought on.
 * `planCards` is what the app does with such data when it meets it.
 */
const months = monthRange('2026-01', '2026-03')
const upgraded = (t: Tables) => applyMutations(t, planCards(t))
const engine = (t: Tables) => computeEngine({ tables: t, months })
const salary = () => row({ name: 'Salary', section: 'income', order: 'a0' })

describe('cards from before schema 23', () => {
  it('a card that recorded only its payments and owes something is followed by them from what it owed; only its mode goes', () => {
    const card = account({ name: 'Amex', type: 'credit-card', openingBalance: 940_00, card: { cardMode: 'lump' } })
    const pay = row({ name: 'Amex – Payment', section: 'expense', kind: 'card-payment', accountId: card.id, order: 'a1' })
    const t = tables({ household: [household()], accounts: [card], rows: [salary(), pay], cells: [cellValue(pay.id, '2026-01', 50_00)] })
    const plan = planCards(t)
    expect(plan.map((m) => m.table)).toEqual(['accounts'])
    const after = applyMutations(t, plan)
    expect(after.accounts[0]).toMatchObject({ tracked: true, updatedAt: card.updatedAt + 1 })
    expect(after.accounts[0].card).toBeUndefined()
    expect(months.map((m) => engine(after).accounts[card.id].months[m].balance)).toEqual([890_00, 840_00, 790_00])
    // the same on every device, and nothing more the second time
    expect(planCards(t)).toEqual(plan)
    expect(planCards(after)).toEqual([])
  })

  it('a card that recorded only its bill and never owed anything stops being tracked, so the bill keeps counting as spending', () => {
    const card = account({ name: 'Visa', type: 'credit-card', openingBalance: 0, card: { cardMode: 'lump' } })
    const pay = row({ name: 'Visa – Payment', section: 'expense', kind: 'card-payment', accountId: card.id, order: 'a1' })
    const t = tables({ household: [household()], accounts: [card], rows: [salary(), pay], cells: [cellValue(pay.id, '2026-01', 120_00)] })
    // left as it is, the card owes nothing, and a payment stops at what is owed: the bill would count as nothing
    expect(engine(t).totals['2026-02'].expensesTotal).toBe(0)
    const after = upgraded(t)
    expect(after.accounts[0].tracked).toBe(false)
    expect(months.map((m) => engine(after).totals[m].expensesTotal)).toEqual([120_00, 120_00, 120_00])
    expect(engine(after).accounts[card.id]).toBeUndefined()
    // read once: tracked again by its owner, it stays tracked
    const again = { ...after, accounts: [{ ...after.accounts[0], tracked: true }] }
    expect(planCards(again)).toEqual([])
  })

  it('such a card stays tracked when a real balance was typed for it, or when it opened owing something', () => {
    const typed = account({ name: 'Visa', type: 'credit-card', openingBalance: 0, card: { cardMode: 'lump' } })
    const t = tables({ household: [household()], accounts: [typed], rows: [salary()], accountMonths: [actual(typed.id, '2026-02', 300_00)] })
    expect(upgraded(t).accounts[0]).toMatchObject({ tracked: true })
    expect(engine(upgraded(t)).accounts[typed.id].months['2026-03'].balance).toBe(300_00)
  })

  it('a card whose purchases were expense rows: the payment moves under Expenses and loses its category, and the rows and schedules lose the card', () => {
    const card = account({ name: 'Visa', type: 'credit-card', openingBalance: 0, card: { cardMode: 'itemized' } })
    const groceries = row({ name: 'Groceries', section: 'expense', accountId: card.id, order: 'a1' })
    const rent = row({ name: 'Rent', section: 'expense', order: 'a2' })
    const pay = row({ name: 'Visa – Payment', section: 'transfer', kind: 'card-payment', accountId: card.id, categoryId: newId(), order: 'a3' })
    const subscriptions = row({ name: 'Subscriptions', section: 'expense', order: 'a5' })
    const streaming = RecurringItemSchema.parse({ id: newId(), createdAt: T0, updatedAt: T0, name: 'Streaming', rowId: subscriptions.id, amount: 18_00, cadence: { intervalMonths: 1, anchorMonth: 1 }, accountId: card.id, startMonth: '2026-01' })
    const pay0 = salary()
    const t = tables({
      household: [household()], accounts: [card], rows: [pay0, groceries, rent, subscriptions, pay], recurringItems: [streaming],
      cells: [cellValue(pay0.id, '2026-01', 3000_00), cellValue(groceries.id, '2026-01', 400_00), cellValue(rent.id, '2026-01', 1200_00), cellValue(pay.id, '2026-01', 400_00)],
    })
    const after = upgraded(t)
    const named = (name: string) => after.rows.find((r) => r.name === name)!
    expect(named('Visa – Payment')).toMatchObject({ section: 'expense', kind: 'card-payment', categoryId: null, accountId: card.id, updatedAt: pay.updatedAt + 1 })
    // at the end of the expense rows without a category
    expect(named('Visa – Payment').order > named('Subscriptions').order).toBe(true)
    expect(named('Groceries')).toMatchObject({ accountId: null, updatedAt: groceries.updatedAt + 1 })
    expect(after.recurringItems[0]).toMatchObject({ accountId: null })
    expect(after.accounts[0].card).toBeUndefined()
    expect(after.accounts[0].tracked).toBe(true)
    // nothing was owed, so the payment counts as nothing: the month costs what was bought, as it did before
    const out = engine(after)
    expect(months.map((m) => out.totals[m].expensesTotal)).toEqual([1600_00, 1600_00, 1600_00])
    expect(months.map((m) => out.accounts[card.id].months[m].balance)).toEqual([0, 0, 0])
    expect(planCards(after)).toEqual([])
  })

  it('a card whose purchases were expense rows and that owed something: its payments now count as expenses and bring it down', () => {
    const card = account({ name: 'Visa', type: 'credit-card', openingBalance: 2000_00, card: { cardMode: 'itemized' } })
    const fuel = row({ name: 'Fuel', section: 'expense', accountId: card.id, order: 'a1' })
    const pay = row({ name: 'Visa – Payment', section: 'transfer', kind: 'card-payment', accountId: card.id, order: 'a3' })
    const t = tables({ household: [household()], accounts: [card], rows: [salary(), fuel, pay], cells: [cellValue(fuel.id, '2026-01', 150_00), cellValue(pay.id, '2026-01', 300_00)] })
    const out = engine(upgraded(t))
    // there is no exact conversion: what was bought is counted, and so is each payment (the report to the owner says so)
    expect(months.map((m) => out.totals[m].expensesTotal)).toEqual([450_00, 450_00, 450_00])
    expect(months.map((m) => out.accounts[card.id].months[m].balance)).toEqual([1700_00, 1400_00, 1100_00])
  })

  it('the payment rows of two cards move together and keep the order they had; an archived row and an archived card move too', () => {
    const a = account({ name: 'A', type: 'credit-card', card: { cardMode: 'itemized' } })
    const b = account({ name: 'B', type: 'credit-card', card: { cardMode: 'itemized' }, archivedMonth: '2026-02', order: 'a1' })
    const rent = row({ name: 'Rent', section: 'expense', order: 'a1' })
    const payB = row({ name: 'B – Payment', section: 'transfer', kind: 'card-payment', accountId: b.id, order: 'a3' })
    const payA = row({ name: 'A – Payment', section: 'transfer', kind: 'card-payment', accountId: a.id, order: 'a4', archivedMonth: '2026-03' })
    const after = upgraded(tables({ household: [household()], accounts: [a, b], rows: [salary(), rent, payB, payA] }))
    const expenses = after.rows.filter((r) => r.section === 'expense').sort((x, y) => (x.order < y.order ? -1 : 1)).map((r) => r.name)
    expect(expenses).toEqual(['Rent', 'B – Payment', 'A – Payment'])
    expect(new Set(after.rows.map((r) => r.order)).size).toBe(after.rows.length)
  })

  it('a payment row that names a loan and stood under Transfers moves too; one whose account is gone keeps its kind', () => {
    const loan = account({ name: 'Car loan', type: 'loan', openingBalance: 500_00 })
    const stale = row({ name: 'Car loan – Payment', section: 'transfer', kind: 'card-payment', accountId: loan.id, order: 'a3' })
    const orphan = row({ name: 'Old card – Payment', section: 'transfer', kind: 'card-payment', accountId: newId(), order: 'a4' })
    const after = upgraded(tables({ household: [household()], accounts: [loan], rows: [salary(), stale, orphan] }))
    expect(after.rows.find((r) => r.id === stale.id)).toMatchObject({ section: 'expense', kind: 'debt-payment' })
    expect(after.rows.find((r) => r.id === orphan.id)).toMatchObject({ section: 'expense', kind: 'card-payment' })
  })

  it('what has no mode and names no card is left alone: a card made since, a loan, an expense that names a savings account, the demo', () => {
    const card = account({ name: 'Visa', type: 'credit-card', openingBalance: 300_00 })
    const savings = account({ name: 'Savings', type: 'savings', order: 'a1' })
    const pay = row({ name: 'Visa – Payment', section: 'expense', kind: 'card-payment', accountId: card.id, order: 'a1' })
    const noted = row({ name: 'Repairs', section: 'expense', accountId: savings.id, order: 'a2' })
    expect(planCards(tables({ household: [household()], accounts: [card, savings], rows: [salary(), pay, noted] }))).toEqual([])
    expect(planCards(buildDemoTables())).toEqual([])
  })
})
