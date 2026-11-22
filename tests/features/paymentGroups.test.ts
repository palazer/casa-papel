import { describe, expect, it } from 'vitest'
import { buildPayments, computeEngine, type Payment, type PaymentState } from '@/engine'
import { GROUP_TITLE, groupPayments, inFilter, sameFilter, type PaymentFilter } from '@/features/payments/groups'
import { monthRange } from '@/model'
import { applyMutations, planRecurringPosts } from '@/store'
import { buildDemoTables } from '@/demo/demoHousehold'

const pay = (id: string, state: PaymentState, day: number | null, over: Partial<Payment> = {}): Payment => ({
  id, rowId: id, label: id, amount: 10_00, day, dayFrom: day != null ? 'row' : null, methodId: null, methodFrom: null, ask: null, tracked: state !== 'untracked', ownerId: null, memo: false,
  status: state === 'done' ? 'done' : 'projected', done: state === 'done', automatic: false, estimate: false, state, ...over,
})

describe('the Payments list: its headings', () => {
  it('what is late stands first, then today, what is coming, what has no day, and what is done last', () => {
    const groups = groupPayments([
      pay('done', 'done', 3), pay('none', 'no-day', null), pay('later', 'coming', 28), pay('now', 'today', 22), pay('late', 'overdue', 12),
    ])
    expect(groups.map((g) => g.key)).toEqual(['overdue', 'today', 'coming', 'no-day', 'done'])
    expect(groups.map((g) => GROUP_TITLE[g.key])).toEqual(['Overdue', 'Today', 'Coming', 'No day', 'Done'])
  })
  it('what is untracked stands under no heading: it has a list of its own', () => {
    expect(groupPayments([pay('a', 'untracked', null), pay('b', 'coming', 3)]).map((g) => [g.key, g.payments.map((p) => p.id)])).toEqual([['coming', ['b']]])
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
  it('every tracked payment of the demo household stands under exactly one heading', () => {
    const months = monthRange('2026-09', '2027-12')
    const base = buildDemoTables()
    const tables = applyMutations(base, planRecurringPosts(base, months))
    const engine = computeEngine({ tables, months })
    for (const month of ['2026-10', '2026-11', '2026-12']) {
      const data = buildPayments(tables, engine, month, '2026-11-22')!
      const groups = groupPayments(data.payments)
      const tracked = data.payments.filter((p) => p.tracked)
      expect(tracked.length).toBeGreaterThan(3)
      expect(groups.flatMap((g) => g.payments.map((p) => p.id)).sort()).toEqual(tracked.map((p) => p.id).sort())
      expect(groups.reduce((s, g) => s + g.total, 0)).toBe(data.toPay + data.paid)
    }
  })
})

describe('the Payments list: a pressed sum', () => {
  const list = [
    pay('a', 'coming', 1, { methodId: 'debit', ownerId: null }),
    pay('b', 'coming', 2, { methodId: null, ownerId: null }),
    pay('c', 'no-day', null, { methodId: 'paypal', ownerId: 'sam' }),
    pay('d', 'done', 4, { methodId: 'paypal', ownerId: 'sam' }),
    pay('e', 'untracked', null),
  ]
  const ids = (f: PaymentFilter | null) => list.filter((p) => inFilter(p, f)).map((p) => p.id)
  it('leaves the payments of that method, or of that person; nothing untracked is in any sum', () => {
    expect(ids(null)).toEqual(['a', 'b', 'c', 'd', 'e'])
    expect(ids({ kind: 'method', methodId: 'debit' })).toEqual(['a'])
    expect(ids({ kind: 'method', methodId: 'paypal' })).toEqual(['c', 'd'])
    // "No method" is what a day alone tracks, not what is untracked
    expect(ids({ kind: 'method', methodId: null })).toEqual(['b'])
    expect(ids({ kind: 'person', ownerId: 'sam' })).toEqual(['c', 'd'])
    expect(ids({ kind: 'person', ownerId: null })).toEqual(['a', 'b'])
  })
  it('pressed again it is the same sum', () => {
    expect(sameFilter({ kind: 'method', methodId: null }, { kind: 'method', methodId: null })).toBe(true)
    expect(sameFilter({ kind: 'method', methodId: 'debit' }, { kind: 'method', methodId: null })).toBe(false)
    expect(sameFilter({ kind: 'method', methodId: 'sam' }, { kind: 'person', ownerId: 'sam' })).toBe(false)
    expect(sameFilter(null, null)).toBe(true)
    expect(sameFilter(null, { kind: 'person', ownerId: null })).toBe(false)
  })
})
