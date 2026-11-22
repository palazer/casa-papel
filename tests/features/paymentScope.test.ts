import { describe, expect, it } from 'vitest'
import { paymentScopes, scopeValues, startScope } from '@/features/payments/scope'
import { PaymentMethodSchema, RecurringItemSchema, newId } from '@/model'
import { T0, account, cellItems, cellValue, household, row, tables } from '../engine/helpers'

/** Where the "Payment" dialog can save a day and a method, and what each place shows. */

const MONTH = '2026-11'
const method = (name: string) => PaymentMethodSchema.parse({ id: newId(), createdAt: T0, updatedAt: T0, name, kind: 'other' })

describe('the places a payment\'s day and method can be saved in', () => {
  it('a row\'s one amount has only the row', () => {
    expect(paymentScopes({})).toEqual(['row'])
    expect(startScope({ dayFrom: 'row', methodFrom: null })).toBe('row')
  })
  it('an item its schedule posted: the schedule from this month on, or this month alone', () => {
    expect(paymentScopes({ itemId: 'i', scheduleId: 's' })).toEqual(['schedule', 'item'])
    // also where the month's line is the row's, with that one item behind it
    expect(paymentScopes({ soleItemId: 'i', scheduleId: 's' })).toEqual(['schedule', 'item'])
    expect(startScope({ soleItemId: 'i', scheduleId: 's', dayFrom: 'schedule', methodFrom: 'row' })).toBe('schedule')
  })
  it('one item of several has itself; a month that is one item of its own has the row and itself', () => {
    expect(paymentScopes({ itemId: 'i' })).toEqual(['item'])
    expect(paymentScopes({ soleItemId: 'i' })).toEqual(['row', 'item'])
    expect(startScope({ soleItemId: 'i', dayFrom: null, methodFrom: null })).toBe('row')
  })
  it('it opens on the item where the item already says something of its own', () => {
    expect(startScope({ itemId: 'i', scheduleId: 's', dayFrom: 'item', methodFrom: 'schedule' })).toBe('item')
    expect(startScope({ soleItemId: 'i', dayFrom: 'row', methodFrom: 'item' })).toBe('item')
  })
})

describe('what a place holds, and what counts when it holds nothing', () => {
  const sepa = method('SEPA')
  const paypal = method('PayPal')
  const card = method('Card')
  const subs = row({ name: 'Subscriptions', section: 'expense', payDay: 1, payMethodId: sepa.id })
  const plain = row({ name: 'Plain', section: 'expense', order: 'a1' })
  const films = RecurringItemSchema.parse({ id: newId(), createdAt: T0, updatedAt: T0, name: 'Films', rowId: subs.id, amount: 14_00, startMonth: '2026-10', payDay: 5, methodId: paypal.id })
  const bare = RecurringItemSchema.parse({ id: newId(), createdAt: T0, updatedAt: T0, name: 'Bare', rowId: plain.id, amount: 5_00, startMonth: '2026-10' })
  const posted = cellItems(subs.id, MONTH, [
    { label: 'Films', amount: 14_00, recurringItemId: films.id, date: `${MONTH}-09`, methodId: card.id },
    { label: 'Music', amount: 11_00 },
  ])
  const plainCell = cellItems(plain.id, MONTH, [{ label: 'Bare', amount: 5_00, recurringItemId: bare.id }])
  const t = tables({
    household: [household({ startMonth: '2026-10' })], accounts: [account({ name: 'Main', type: 'checking', openingMonth: '2026-10' })],
    paymentMethods: [sepa, paypal, card], rows: [subs, plain], recurringItems: [films, bare], cells: [posted, plainCell, cellValue(plain.id, '2026-10', 5_00)],
  })
  const [filmsItem, musicItem] = posted.items

  it('the row: its usual day and method, with nothing behind them', () => {
    expect(scopeValues('row', {}, subs, MONTH, t)).toEqual({ day: 1, methodId: sepa.id, noDay: 'No day', noMethod: 'No method', behindDay: null, behindMethodId: null })
  })
  it('the schedule: its own, and behind it the row\'s usual ones', () => {
    expect(scopeValues('schedule', { itemId: filmsItem.id }, subs, MONTH, t)).toEqual({
      day: 5, methodId: paypal.id, noDay: "The row's usual day: 1st", noMethod: "The row's usual method: SEPA", behindDay: 1, behindMethodId: sepa.id,
    })
  })
  it('the item: its own, and behind it its schedule, else the row', () => {
    expect(scopeValues('item', { itemId: filmsItem.id }, subs, MONTH, t)).toEqual({
      day: 9, methodId: card.id, noDay: 'As scheduled: 5th', noMethod: 'As scheduled: PayPal', behindDay: 5, behindMethodId: paypal.id,
    })
    expect(scopeValues('item', { itemId: musicItem.id }, subs, MONTH, t)).toEqual({
      day: null, methodId: null, noDay: 'Usual: 1st', noMethod: 'Usual: SEPA', behindDay: 1, behindMethodId: sepa.id,
    })
  })
  it('where nothing stands behind a place, its first choice says "No day" and "No method"', () => {
    const one = { soleItemId: plainCell.items[0].id }
    expect(scopeValues('schedule', one, plain, MONTH, t)).toMatchObject({ day: null, methodId: null, noDay: 'No day', noMethod: 'No method', behindDay: null, behindMethodId: null })
    expect(scopeValues('item', one, plain, MONTH, t)).toMatchObject({ noDay: 'No day', noMethod: 'No method', behindDay: null, behindMethodId: null })
  })
})
