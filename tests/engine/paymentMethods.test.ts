import { describe, expect, it } from 'vitest'
import { computeEngine } from '@/engine'
import { PaymentMethodSchema, RecurringItemSchema, newId, type Row, type Tables } from '@/model'
import { T0, account, cellItems, cellValue, household, row, tables } from './helpers'

/**
 * Rule W1: a day and a payment method move no figure. What is bought on a card is said by the row ("Paid by card…",
 * rule C2), for the row as a whole, whatever its items are paid with.
 */
const months = ['2026-01', '2026-02', '2026-03']
const method = (name: string, over: Record<string, unknown> = {}) => PaymentMethodSchema.parse({ id: newId(), createdAt: T0, updatedAt: T0, name, kind: 'other', ...over })
const schedule = (r: Row, name: string, amount: number, over: Record<string, unknown> = {}) =>
  RecurringItemSchema.parse({ id: newId(), createdAt: T0, updatedAt: T0, name, rowId: r.id, amount, startMonth: '2026-01', ...over })
const figures = (t: Tables) => {
  const e = computeEngine({ tables: t, months })
  return { totals: e.totals, accounts: e.accounts, main: e.main, cells: Object.fromEntries(Object.entries(e.cells).map(([k, c]) => [k, [c.value, c.valueBase, c.funding]])) }
}

function setting() {
  const h = household()
  const main = account({ name: 'Main', type: 'checking', tracked: false, openingBalance: 1000_00 })
  const own = account({ name: "Sam's account", type: 'joint', openingBalance: 500_00 })
  const visa = account({ name: 'Visa', type: 'credit-card', card: { cardMode: 'itemized' } })
  const salary = row({ name: 'Salary', section: 'income', order: 'a0' })
  const subs = row({ name: 'Subscriptions', section: 'expense', order: 'b0' })
  const rent = row({ name: 'Rent', section: 'expense', order: 'b1' })
  // a method as schema 21 stored one: tied to the card. The tie is read by nothing.
  const visaCard = method('Visa card', { kind: 'credit-card', accountId: visa.id })
  const samSepa = method("Sam's SEPA", { kind: 'direct-debit', accountId: own.id })
  const paypal = method('PayPal', { kind: 'wallet', note: 'main account' })
  return { h, main, own, visa, salary, subs, rent, visaCard, samSepa, paypal }
}

describe('a day and a method move no figure', () => {
  it('items and a schedule that name methods, one of them once tied to a card, count as they would without', () => {
    const s = setting()
    const films = schedule(s.subs, 'Films', 14_00, { payDay: 5, methodId: s.visaCard.id })
    const plain = tables({
      household: [s.h], accounts: [s.main, s.own, s.visa], rows: [s.salary, s.subs, s.rent],
      recurringItems: [RecurringItemSchema.parse({ ...films, payDay: null, methodId: null })],
      cells: [
        cellValue(s.salary.id, '2026-01', 2000_00), cellValue(s.rent.id, '2026-01', 900_00),
        cellItems(s.subs.id, '2026-01', [{ label: 'Films', amount: 14_00, recurringItemId: films.id }, { label: 'Games', amount: 30_00 }, { label: 'Music', amount: 11_00 }]),
      ],
    })
    const paid: Tables = {
      ...plain, paymentMethods: [s.visaCard, s.samSepa, s.paypal], recurringItems: [films],
      rows: plain.rows.map((r) => (r.id === s.rent.id ? { ...r, payDay: 31, payMethodId: s.samSepa.id } : r.id === s.subs.id ? { ...r, payDay: 1, payMethodId: s.paypal.id } : r)),
      cells: plain.cells.map((c) => (c.rowId !== s.subs.id ? c : {
        ...c, items: c.items.map((i) => (i.label === 'Games' ? { ...i, methodId: s.visaCard.id, date: '2026-01-20' } : i.label === 'Music' ? { ...i, methodId: s.samSepa.id } : i)),
      })),
    }
    expect(figures(paid)).toEqual(figures(plain))
    const out = computeEngine({ tables: paid, months })
    // nothing is owed on the card, and Sam's account holds what it held
    expect(out.accounts[s.visa.id].months['2026-01'].balance).toBe(0)
    expect(out.accounts[s.own.id].months['2026-01'].balance).toBe(500_00)
    expect(out.main!.months['2026-01'].cardBought).toBe(0)
  })

  it('a row that is "Paid by card" is on the card as a whole, whatever its items are paid with', () => {
    const s = setting()
    const onCard = { ...s.subs, accountId: s.visa.id }
    const t = tables({
      household: [s.h], accounts: [s.main, s.own, s.visa], rows: [s.salary, onCard], paymentMethods: [s.visaCard, s.samSepa, s.paypal],
      cells: [cellValue(s.salary.id, '2026-01', 2000_00), cellItems(s.subs.id, '2026-01', [
        { label: 'Films', amount: 14_00 }, { label: 'Music', amount: 11_00, methodId: s.paypal.id }, { label: 'Paper', amount: 9_00, methodId: s.samSepa.id }, { label: 'Old', amount: 5_00, skipped: true },
      ])],
    })
    const out = computeEngine({ tables: t, months })
    expect(out.accounts[s.visa.id].months['2026-01'].balance).toBe(34_00)
    expect(out.main!.months['2026-01'].cardBought).toBe(34_00)
    expect(out.accounts[s.own.id].months['2026-01'].balance).toBe(500_00)
    // the same row without a single method: the same figures
    const bare: Tables = { ...t, paymentMethods: [], cells: t.cells.map((c) => ({ ...c, items: c.items.map((i) => ({ ...i, methodId: null })) })) }
    expect(figures(t)).toEqual(figures(bare))
  })
})
