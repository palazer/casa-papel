import { describe, expect, it } from 'vitest'
import { computeEngine } from '@/engine'
import { FxRateSchema, PaymentMethodSchema, RecurringItemSchema, newId, type Account, type PaymentKind, type Row } from '@/model'
import { T0, account, cellItems, cellValue, household, row, tables } from './helpers'

/**
 * Rule C2 per item: an amount is bought on a card where its row is on that card, or where the item names a payment
 * method that draws on it. A month in which no item names a method is the row's amount as a whole, on the row's card.
 */
const months = ['2026-01', '2026-02']
const method = (name: string, acc: Account, kind: PaymentKind = acc.type === 'credit-card' ? 'credit-card' : 'direct-debit') =>
  PaymentMethodSchema.parse({ id: newId(), createdAt: T0, updatedAt: T0, name, kind, accountId: acc.id })
const schedule = (r: Row, name: string, amount: number, over: Record<string, unknown> = {}) =>
  RecurringItemSchema.parse({ id: newId(), createdAt: T0, updatedAt: T0, name, rowId: r.id, amount, startMonth: '2026-01', ...over })
const rate = (month: string, value: number) => FxRateSchema.parse({ pair: 'EUR/USD', month, rate: value, source: 'manual', updatedAt: T0 })

function setting() {
  const h = household()
  const main = account({ name: 'Main', type: 'checking', tracked: false, openingBalance: 1000_00 })
  const visa = account({ name: 'Visa', type: 'credit-card', card: { cardMode: 'itemized' } })
  const amex = account({ name: 'Amex', type: 'credit-card', card: { cardMode: 'itemized' } })
  const salary = row({ name: 'Salary', section: 'income', order: 'a0' })
  const subs = row({ name: 'Subscriptions', section: 'expense', order: 'b0' })
  return { h, main, visa, amex, salary, subs, visaCard: method('Visa card', visa), amexCard: method('Amex card', amex), paypal: method('PayPal', main, 'wallet') }
}

describe('what is bought on a card, item by item', () => {
  it('two items of one row on two cards, a third paid from the main account', () => {
    const s = setting()
    const t = tables({
      household: [s.h], accounts: [s.main, s.visa, s.amex], rows: [s.salary, s.subs], paymentMethods: [s.visaCard, s.amexCard, s.paypal],
      cells: [cellValue(s.salary.id, '2026-01', 2000_00), cellItems(s.subs.id, '2026-01', [
        { label: 'Films', amount: 14_00, methodId: s.visaCard.id }, { label: 'Games', amount: 30_00, methodId: s.amexCard.id }, { label: 'Music', amount: 11_00, methodId: s.paypal.id },
      ])],
    })
    const out = computeEngine({ tables: t, months })
    expect(out.accounts[s.visa.id].months['2026-01']).toMatchObject({ inflow: 14_00, balance: 14_00 })
    expect(out.accounts[s.amex.id].months['2026-01']).toMatchObject({ inflow: 30_00, balance: 30_00 })
    // spent on paper: all 55.00; the cash for what is on the cards is still in the main account
    expect(out.totals['2026-01'].expensesTotal).toBe(55_00)
    // (no row takes the rest of the month here, so the month keeps nothing: the balance moves by the card term alone)
    expect(out.main!.months['2026-01']).toMatchObject({ kept: 0, cardBought: 44_00, cardPaid: 0, balance: 1000_00 + 44_00 })
    // net worth: the main account less what is owed
    expect(out.netWorth['2026-01']).toBe(1000_00)
    // items carry no further: February has nothing typed, so nothing new is owed
    expect(out.accounts[s.visa.id].months['2026-02'].balance).toBe(14_00)
  })

  it('an item that names no method is on the row\'s card; one whose method draws elsewhere is not', () => {
    const s = setting()
    const onVisa = { ...s.subs, accountId: s.visa.id }
    const t = tables({
      household: [s.h], accounts: [s.main, s.visa, s.amex], rows: [s.salary, onVisa], paymentMethods: [s.visaCard, s.amexCard, s.paypal],
      cells: [cellItems(onVisa.id, '2026-01', [{ label: 'Films', amount: 14_00 }, { label: 'Games', amount: 30_00, methodId: s.amexCard.id }, { label: 'Music', amount: 11_00, methodId: s.paypal.id }])],
    })
    const out = computeEngine({ tables: t, months })
    expect(out.accounts[s.visa.id].months['2026-01'].balance).toBe(14_00)
    expect(out.accounts[s.amex.id].months['2026-01'].balance).toBe(30_00)
    expect(out.main!.months['2026-01'].cardBought).toBe(44_00)
  })

  it('a month in which no item names a method is the row\'s whole amount on the row\'s card, as it always was', () => {
    const s = setting()
    const onVisa = { ...s.subs, accountId: s.visa.id }
    const base = { household: [s.h], accounts: [s.main, s.visa], rows: [s.salary, onVisa], cells: [cellItems(onVisa.id, '2026-01', [{ label: 'Films', amount: 14_00 }, { label: 'Music', amount: 11_00 }]), cellValue(onVisa.id, '2026-02', 40_00)] }
    const before = computeEngine({ tables: tables(base), months })
    const after = computeEngine({ tables: tables({ ...base, paymentMethods: [s.visaCard, s.paypal] }), months })
    expect(after.accounts[s.visa.id]).toEqual(before.accounts[s.visa.id])
    expect(after.main).toEqual(before.main)
    expect(after.accounts[s.visa.id].months['2026-01'].balance).toBe(25_00)
    expect(after.accounts[s.visa.id].months['2026-02'].balance).toBe(65_00)
  })

  it('the method of the schedule that posted an item counts for it; the item\'s own method counts first', () => {
    const s = setting()
    const films = schedule(s.subs, 'Films', 14_00, { methodId: s.visaCard.id })
    const music = schedule(s.subs, 'Music', 11_00, { methodId: s.visaCard.id })
    const t = tables({
      household: [s.h], accounts: [s.main, s.visa], rows: [s.salary, s.subs], paymentMethods: [s.visaCard, s.paypal], recurringItems: [films, music],
      cells: [cellItems(s.subs.id, '2026-01', [
        { label: 'Films', amount: 14_00, recurringItemId: films.id }, { label: 'Music', amount: 11_00, recurringItemId: music.id, methodId: s.paypal.id },
      ])],
    })
    expect(computeEngine({ tables: t, months }).accounts[s.visa.id].months['2026-01'].balance).toBe(14_00)
  })

  it('an item that is skipped is bought nowhere, and a card that records only its payments is moved by no item', () => {
    const s = setting()
    const lump = account({ name: 'Old card', type: 'credit-card', openingBalance: 500_00, card: { cardMode: 'lump' } })
    const lumpCard = method('Old card', lump)
    const t = tables({
      household: [s.h], accounts: [s.main, s.visa, lump], rows: [s.salary, s.subs], paymentMethods: [s.visaCard, lumpCard],
      cells: [cellItems(s.subs.id, '2026-01', [{ label: 'Films', amount: 14_00, methodId: s.visaCard.id, skipped: true }, { label: 'Games', amount: 30_00, methodId: lumpCard.id }, { label: 'Music', amount: 11_00, methodId: s.visaCard.id }])],
    })
    const out = computeEngine({ tables: t, months })
    expect(out.accounts[s.visa.id].months['2026-01'].balance).toBe(11_00)
    expect(out.accounts[lump.id].months['2026-01'].balance).toBe(500_00)
    expect(out.main!.months['2026-01'].cardBought).toBe(11_00)
  })

  it('a card in another currency owes what was recorded for its item, and the rest at the month\'s rate', () => {
    const s = setting()
    const dollar = account({ name: 'Dollar card', type: 'credit-card', currency: 'USD', card: { cardMode: 'itemized' } })
    const dollarCard = method('Dollar card', dollar)
    const t = tables({
      household: [s.h], accounts: [s.main, dollar, s.visa], rows: [s.salary, s.subs], paymentMethods: [dollarCard, s.visaCard], fxRates: [rate('2026-01', 1.1), rate('2026-02', 1.25)],
      cells: [cellItems(s.subs.id, '2026-01', [
        { label: 'Hotel', amount: 200_00, status: 'done', methodId: dollarCard.id, conversion: { foreign: 'USD', foreignAmount: 228_00, homeAmount: 200_00, rate: 1.14, date: null } },
        { label: 'Taxi', amount: 50_00, methodId: dollarCard.id },
        { label: 'Films', amount: 14_00, methodId: s.visaCard.id },
        { label: 'Music', amount: 11_00 },
      ])],
    })
    const out = computeEngine({ tables: t, months })
    // 228.00 as recorded, and 50.00 euros at 1.1000
    expect(out.accounts[dollar.id].months['2026-01'].balance).toBe(228_00 + 55_00)
    expect(out.accounts[s.visa.id].months['2026-01'].balance).toBe(14_00)
    expect(out.main!.months['2026-01'].cardBought).toBe(200_00 + 50_00 + 14_00)
    expect(out.warnings).toEqual([])
  })
})
