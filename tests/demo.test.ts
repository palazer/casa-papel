import { describe, expect, it } from 'vitest'
import { computeEngine } from '@/engine'
import { monthRange, newId } from '@/model'
import { CasaDb, Store, planCards, planUsualPayment } from '@/store'
import { buildDemoTables } from '@/demo/demoHousehold'
import { loadDemo } from '@/demo/loadDemo'

describe('demo household', () => {
  it('validates and is internally consistent', () => {
    const t = buildDemoTables()
    const ids = new Set<string>()
    for (const list of Object.values(t)) for (const r of list as Array<{ id?: string }>) if (r.id) {
      expect(ids.has(r.id)).toBe(false)
      ids.add(r.id)
    }
    const rowIds = new Set(t.rows.map((r) => r.id))
    for (const c of t.cells) expect(rowIds.has(c.rowId)).toBe(true)
    for (const r of t.recurringItems) expect(rowIds.has(r.rowId)).toBe(true)
    const accountIds = new Set(t.accounts.map((a) => a.id))
    for (const p of t.pools) expect(accountIds.has(p.accountId)).toBe(true)
    // a row's category belongs to the row's own section
    for (const r of t.rows) if (r.categoryId) expect(t.categories.find((c) => c.id === r.categoryId)?.section).toBe(r.section)
  })
  it('has payment methods and days, with the switch still off, and its rows are as "Usually paid…" would leave them', () => {
    const t = buildDemoTables()
    expect(t.household[0].payments ?? false).toBe(false)
    expect(t.paymentMethods.map((m) => m.name)).toEqual(['Direct debit', 'Standing order', 'Transfer by hand', 'Credit card'])
    const methodIds = new Set(t.paymentMethods.map((m) => m.id))
    // a method is a label: none is tied to an account
    for (const m of t.paymentMethods) expect(m.accountId ?? null, m.name).toBeNull()
    for (const r of t.recurringItems) if (r.methodId) expect(methodIds.has(r.methodId), r.name).toBe(true)
    const usual = t.rows.filter((r) => r.payMethodId)
    expect(usual.map((r) => [r.name, r.payDay ?? null])).toEqual([['The flat – Utilities', 12], ['Robin – Childcare', 25], ['Subscriptions', null], ['To savings', 28]])
    // setting the same day and method through the store changes nothing but the time of the change
    for (const r of usual) {
      const written = planUsualPayment(t, r.id, { payDay: r.payDay ?? null, payMethodId: r.payMethodId ?? null }, 1)
      expect(written.map((m) => m.table), r.name).toEqual(['rows'])
      expect(written[0].op === 'put' && { ...written[0].record, updatedAt: r.updatedAt }, r.name).toEqual(r)
    }
    expect(t.recurringItems.filter((r) => r.payDay != null).map((r) => [r.name, r.payDay])).toEqual([['Rent', 1], ['Car insurance', 15], ['Dog tax', 10]])
    // with the switch off and on, with the methods and without them, the figures are the same (rule W1)
    const months = monthRange('2026-09', '2027-12')
    const on: typeof t = { ...t, household: [{ ...t.household[0], payments: true }] }
    const without: typeof t = { ...t, paymentMethods: [], rows: t.rows.map((r) => ({ ...r, payDay: null, payMethodId: null })), recurringItems: t.recurringItems.map((r) => ({ ...r, payDay: null, methodId: null })) }
    const figures = (x: typeof t) => { const e = computeEngine({ tables: x, months }); return { totals: e.totals, accounts: e.accounts, main: e.main } }
    expect(figures(on)).toEqual(figures(t))
    expect(figures(without)).toEqual(figures(t))
  })
  it('has a card that carries a debt: its payment brings it down, and October ends on what the statement said', () => {
    const t = buildDemoTables()
    const months = monthRange('2026-09', '2026-12')
    const out = computeEngine({ tables: t, months })
    const card = t.accounts.find((a) => a.type === 'credit-card')!
    expect(months.map((m) => out.accounts[card.id].months[m].balance)).toEqual([1740_00, 1695_00, 1635_00, 1575_00])
    // the plan had 1,680.00 for the end of October; the statement at the start of November said 15.00 more
    expect(out.accounts[card.id].months['2026-10']).toMatchObject({ computed: 1680_00, entered: true, adjustment: 15_00 })
    // the payment is an expense of its month, among Sam's own
    const pay = t.rows.find((r) => r.kind === 'card-payment')!
    expect(pay).toMatchObject({ name: 'Credit card – Payment', section: 'expense', accountId: card.id, scope: t.entities.find((e) => e.name === 'Sam')!.id })
    expect(months.map((m) => out.totals[m].debt)).toEqual([60_00, 60_00, 60_00, 60_00])
    // no expense names the card, and nothing in the demo is as it was before schema 23
    expect(t.rows.filter((r) => r.accountId === card.id).map((r) => r.name)).toEqual(['Credit card – Payment'])
    expect(planCards(t)).toEqual([])
  })
  it('loads into a store', async () => {
    const s = new Store(new CasaDb(`test-${newId()}`))
    await loadDemo(s)
    expect(await s.db.household.count()).toBe(1)
    expect(await s.db.rows.count()).toBeGreaterThan(15)
    expect(await s.db.paymentMethods.count()).toBe(4)
    expect(await s.db.events.count()).toBeGreaterThan(15)
  })
})
