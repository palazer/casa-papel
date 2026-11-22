import { describe, expect, it } from 'vitest'
import { buildPayments, computeEngine, type Payment, type PaymentState } from '@/engine'
import { GROUP_TITLE, groupPayments, inFilter, sameFilter, type PaymentFilter } from '@/features/payments/groups'
import { monthRange } from '@/model'
import { applyMutations, planRecurringPosts } from '@/store'
import { buildDemoTables } from '@/demo/demoHousehold'

const pay = (id: string, state: PaymentState, day: number | null, over: Partial<Payment> = {}): Payment => ({
  id, rowId: id, label: id, amount: 10_00, day, methodId: null, ask: null, accountId: 'main', ownerId: null, onCard: false, memo: false,
  status: state === 'done' ? 'done' : 'projected', done: state === 'done', automatic: false, estimate: false, state, ...over,
})

describe('the Payments list: its headings', () => {
  it('what is late stands first, then today, what is coming, what has no day, and what is done last', () => {
    const groups = groupPayments([
      pay('done', 'done', 3), pay('none', 'no-day', null), pay('later', 'coming', 28), pay('now', 'today', 22), pay('late', 'overdue', 12),
    ])
    expect(groups.map((g) => g.key)).toEqual(['overdue', 'today', 'coming', 'no-day', 'done'])
    expect(groups.map((g) => GROUP_TITLE[g.key])).toEqual(['Overdue', 'Today', 'Coming', 'No day yet', 'Done'])
  })
  it('under a heading the payments go by day, and those of one day keep the Statement\'s order', () => {
    const [coming] = groupPayments([pay('c', 'coming', 28), pay('a', 'coming', 25), pay('d', 'coming', 28), pay('b', 'coming', 25)])
    expect(coming.payments.map((p) => p.id)).toEqual(['a', 'b', 'c', 'd'])
    expect(coming.total).toBe(40_00)
    // what is done without a day comes after what is done with one
    const [done] = groupPayments([pay('x', 'done', null), pay('y', 'done', 30)])
    expect(done.payments.map((p) => p.id)).toEqual(['y', 'x'])
  })
  it('a heading with nothing under it is left out, and another month has one heading for what is not done', () => {
    expect(groupPayments([])).toEqual([])
    expect(groupPayments([pay('a', 'open', 5), pay('b', 'open', 1)]).map((g) => [g.key, g.payments.map((p) => p.id)])).toEqual([['open', ['b', 'a']]])
  })
  it('every payment of the demo household stands under exactly one heading', () => {
    const months = monthRange('2026-09', '2027-12')
    const base = buildDemoTables()
    const tables = applyMutations(base, planRecurringPosts(base, months))
    const engine = computeEngine({ tables, months })
    for (const month of ['2026-10', '2026-11', '2026-12']) {
      const data = buildPayments(tables, engine, month, '2026-11-22')!
      const groups = groupPayments(data.payments)
      expect(groups.flatMap((g) => g.payments.map((p) => p.id)).sort()).toEqual(data.payments.map((p) => p.id).sort())
      expect(groups.reduce((s, g) => s + g.total, 0)).toBe(data.payments.reduce((s, p) => s + p.amount, 0))
    }
  })
})

describe('the Payments list: a pressed total', () => {
  const list = [
    pay('a', 'coming', 1, { accountId: 'main', methodId: 'debit', ownerId: null }),
    pay('b', 'coming', 2, { accountId: 'main', methodId: null, ownerId: 'sam' }),
    pay('c', 'coming', 3, { accountId: 'card', methodId: 'visa', ownerId: 'sam', onCard: true }),
    pay('d', 'coming', 4, { accountId: null, methodId: null, ownerId: null }),
  ]
  const ids = (f: PaymentFilter | null) => list.filter((p) => inFilter(p, f)).map((p) => p.id)
  it('leaves the payments of that account, of that method on that account, or of that person', () => {
    expect(ids(null)).toEqual(['a', 'b', 'c', 'd'])
    expect(ids({ kind: 'account', accountId: 'main' })).toEqual(['a', 'b'])
    expect(ids({ kind: 'account', accountId: null })).toEqual(['d'])
    expect(ids({ kind: 'method', accountId: 'main', methodId: null })).toEqual(['b'])
    expect(ids({ kind: 'method', accountId: 'card', methodId: 'visa' })).toEqual(['c'])
    expect(ids({ kind: 'person', ownerId: 'sam' })).toEqual(['b', 'c'])
    expect(ids({ kind: 'person', ownerId: null })).toEqual(['a', 'd'])
  })
  it('pressed again it is the same total: "no method" on one account is not "no method" on another', () => {
    expect(sameFilter({ kind: 'method', accountId: 'main', methodId: null }, { kind: 'method', accountId: 'main', methodId: null })).toBe(true)
    expect(sameFilter({ kind: 'method', accountId: 'main', methodId: null }, { kind: 'method', accountId: null, methodId: null })).toBe(false)
    expect(sameFilter({ kind: 'account', accountId: 'main' }, { kind: 'person', ownerId: 'main' })).toBe(false)
    expect(sameFilter(null, null)).toBe(true)
    expect(sameFilter(null, { kind: 'person', ownerId: null })).toBe(false)
  })
})
