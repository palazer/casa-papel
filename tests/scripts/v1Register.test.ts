import { describe, expect, it } from 'vitest'
import { computeEngine, cellKey } from '@/engine'
import { monthRange } from '@/model'
import { planRecurringPosts } from '@/store'
import { mapV1, parseAccount, parseCadenceNote } from '../../scripts/lib/v1Register'

describe('v1 register mapper', () => {
  it('parses cadence notes', () => {
    expect(parseCadenceNote('Quarterly (Jan-Apr-Jul-Oct) = 420')).toEqual({ intervalMonths: 3, anchorMonth: 1, amount: 420, currency: 'EUR' })
    expect(parseCadenceNote('Yearly (Sep) = 699 TL')).toEqual({ intervalMonths: 12, anchorMonth: 9, amount: 699, currency: 'TRY' })
    expect(parseCadenceNote('Quarterly (Mar-Jun-Sep-Dec) = 56')).toMatchObject({ intervalMonths: 3, anchorMonth: 3 })
    expect(parseCadenceNote('Cancelled as of Aug')).toBeNull()
    expect(parseCadenceNote('')).toBeNull()
  })
  it('parses paying accounts', () => {
    expect(parseAccount('Ada - Bank Main')).toEqual({ owner: 'Ada', name: 'Bank Main', type: 'checking' })
    expect(parseAccount('Ada - Amex')).toMatchObject({ type: 'credit-card' })
    expect(parseAccount('Paypal')).toEqual({ owner: null, name: 'Paypal', type: 'checking' })
  })
  it('maps a synthetic register into a valid import with schedule-aware items', () => {
    const file = mapV1({
      householdName: 'Synthetic', startMonth: '2026-11', pocketTotal: 1000,
      expenses: [
        { name: 'Rent (Elm Street)', category: 'Accomodation', amount: 1500, from: 'Ada - Bank Main', notes: '' },
        { name: 'Car Credit', category: 'Transportation', amount: 400, from: 'Ada - Bank Main', notes: '' },
        { name: 'Insurer', category: 'Insurance', amount: 0, from: 'Ada - Bank Main', notes: 'Quarterly (Jan-Apr-Jul-Oct) = 420' },
        { name: 'Getsafe - Dog', category: 'Insurance', amount: 5, from: 'Ada - Bank Main', notes: '' },
        { name: 'Streaming', category: 'Subscription', amount: 0, from: 'Ada - Paypal', notes: 'Yearly (Sep) = 699 TL' },
        { name: 'Transit (Bo)', category: 'Transportation', amount: 30, from: 'Bo - Bank', notes: '' },
        { name: 'Old thing', category: 'Cancelled', amount: 0, from: 'Ada - Paypal', notes: 'Cancelled as of Aug' },
        { name: 'TR', category: 'Ada', amount: 400, from: 'Ada - Bank Main', notes: '' },
      ],
      joint: [{ category: 'Groceries', amount: 1200, account: 'Monthly Joint' }, { category: 'Tesla', amount: 100, account: 'Monthly Joint' }],
      savings: [
        { purpose: 'Instant Access', category: 'Saving', amount: 1700, account: 'Savings Joint', notes: '' },
        { purpose: 'Travel', category: 'Saving', amount: 0, account: 'Savings Joint', notes: '' },
        { purpose: 'Home', category: 'Investment', amount: 1750, account: 'Ada - Etoro', notes: '' },
        { purpose: 'Kindergeld', category: 'Kid LT', amount: 259, account: 'Bo - Etoro (NSDQ100)', notes: 'Direct contribution from Kindergeld' },
      ],
    })
    const t = file.tables
    expect(t.entities.map((e) => `${e.kind}:${e.name}`)).toEqual(expect.arrayContaining(['adult:Ada', 'adult:Bo', 'pet:Dog', 'vehicle:Tesla', 'property:Elm Street', 'child:Kid']))
    expect(t.accounts.map((a) => a.type)).toEqual(expect.arrayContaining(['checking', 'joint', 'savings', 'investment']))
    const names = t.rows.map((r) => r.name)
    expect(names).toEqual(expect.arrayContaining(['Rent', 'Transport', 'Insurance', 'Subscriptions (TRY)', 'Ada – Personal', 'Groceries', 'Tesla', 'To savings', 'To investments', 'Kid – Long-term savings', 'Kindergeld', 'Ada – Salary', 'Ada – Pocket', 'Travel', 'To Travel']))
    expect(t.recurringItems.find((i) => i.name === 'Insurer')).toMatchObject({ amount: 42000, cadence: { intervalMonths: 3, anchorMonth: 1 } })
    expect(t.recurringItems.find((i) => i.name === 'Streaming')).toMatchObject({ amount: 69900, currency: 'TRY', cadence: { intervalMonths: 12, anchorMonth: 9 } })
    expect(t.recurringItems.find((i) => i.name === 'Old thing')).toBeUndefined()
    expect(t.recurringItems.find((i) => i.name === 'Transit (Bo)')?.scope).toBe(t.entities.find((e) => e.name === 'Bo')?.id)
    expect(t.rows.find((r) => r.name === 'Insurance')?.entityTags).toContain(t.entities.find((e) => e.name === 'Dog')?.id)

    // posting + engine: quarterly lands in January, monthly rent everywhere
    const months = monthRange('2026-11', '2027-02')
    const mutations = planRecurringPosts(t, months)
    const cells = mutations.map((m) => (m as { record: never }).record)
    const out = computeEngine({ tables: { ...t, cells }, months })
    const insurance = t.rows.find((r) => r.name === 'Insurance')!
    expect(out.cells[cellKey(insurance.id, '2026-11')].value).toBe(500) // dog only
    expect(out.cells[cellKey(insurance.id, '2027-01')].value).toBe(42500) // + quarterly
    expect(out.totals['2026-11'].income).toBe(25900) // Kindergeld
  })
})
