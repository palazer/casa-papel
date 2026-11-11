import { describe, expect, it } from 'vitest'
import { computeEngine, computeGoals } from '@/engine'
import { GoalSchema, monthRange, newId, type Goal } from '@/model'
import { goalStatusLine } from '@/features/goals/goalText'
import { T0, account, cellValue, household, pool, row, tables } from './helpers'

const goal = (over: Partial<Goal> & { name: string; kind: Goal['kind'] }): Goal => GoalSchema.parse({ id: newId(), createdAt: T0, updatedAt: T0, order: 'a0', startMonth: '2026-01', ...over })

/** Savings opening 1000, salary 1000 a month, nothing spent: the plug adds 1000 a month. */
function savingsWorld(goals: Goal[], months = monthRange('2026-01', '2026-06')) {
  const savings = account({ name: 'Savings', type: 'savings', openingBalance: 1000_00 })
  const salary = row({ name: 'Salary', section: 'income' })
  const toSavings = row({ name: 'To savings', section: 'transfer', kind: 'to-savings', accountId: savings.id, order: 'c0' })
  const t = tables({ household: [household()], accounts: [savings], rows: [salary, toSavings], cells: [cellValue(salary.id, '2026-01', 1000_00)], goals })
  return { t, savings, out: computeEngine({ tables: t, months }) }
}

describe('goals', () => {
  it('account balance: progress, projected month, deadlines', () => {
    const base = { name: 'Cushion', kind: 'account-balance' as const }
    const { t, savings, out } = savingsWorld([])
    const read = (g: Goal) => computeGoals({ ...t, goals: [g] }, out, '2026-02')[0]
    const g = read(goal({ ...base, accountId: savings.id, target: 3500_00 }))
    expect(g).toMatchObject({ current: 3000_00, target: 3500_00, reachedMonth: '2026-03', status: 'on-track', currency: 'EUR' })
    expect(g.progress).toBeCloseTo(3000 / 3500, 6)
    expect(read(goal({ ...base, accountId: savings.id, target: 3500_00, targetMonth: '2026-06' })).status).toBe('on-track')
    expect(read(goal({ ...base, accountId: savings.id, target: 3500_00, targetMonth: '2026-02' })).status).toBe('late')
    expect(read(goal({ ...base, accountId: savings.id, target: 1_000_000_00 })).status).toBe('no-projection')
    expect(read(goal({ ...base, accountId: savings.id, target: 1_000_000_00, targetMonth: '2026-05' })).status).toBe('late')
    expect(read(goal({ ...base, accountId: savings.id, target: 1500_00 }))).toMatchObject({ status: 'reached', reachedMonth: '2026-01', progress: 1 })
  })
  it('pay off: counts down from what was owed when the goal was set', () => {
    const loan = account({ name: 'Car loan', type: 'loan', openingBalance: 5000_00 })
    const salary = row({ name: 'Salary', section: 'income' })
    const pay = row({ name: 'Instalment', section: 'expense', kind: 'debt-payment', accountId: loan.id, order: 'b0' })
    const g = goal({ name: 'Clear the car', kind: 'pay-off', accountId: loan.id, startMonth: '2026-01' })
    const t = tables({ household: [household()], accounts: [loan], rows: [salary, pay], cells: [cellValue(salary.id, '2026-01', 1000_00), cellValue(pay.id, '2026-01', 250_00)], goals: [g] })
    const short = computeGoals(t, computeEngine({ tables: t, months: monthRange('2026-01', '2026-03') }), '2026-03')[0]
    expect(short).toMatchObject({ startValue: 5000_00, current: 4250_00, status: 'no-projection', reachedMonth: null })
    expect(short.progress).toBeCloseTo(0.15, 6)
    const long = computeGoals(t, computeEngine({ tables: t, months: monthRange('2026-01', '2027-12') }), '2026-03')[0]
    expect(long).toMatchObject({ reachedMonth: '2027-08', status: 'on-track' })
    // a goal set later starts from that month's owed amount
    const later = computeGoals({ ...t, goals: [{ ...g, startMonth: '2026-03' }] }, computeEngine({ tables: t, months: monthRange('2026-01', '2026-06') }), '2026-04')[0]
    expect(later.startValue).toBe(4500_00)
  })
  it('pay down: a debt brought down to an amount above zero is reached there, and progress runs between the two', () => {
    const loan = account({ name: 'Car loan', type: 'loan', openingBalance: 5000_00 })
    const salary = row({ name: 'Salary', section: 'income' })
    const pay = row({ name: 'Instalment', section: 'expense', kind: 'debt-payment', accountId: loan.id, order: 'b0' })
    const g = goal({ name: 'Car loan under 4k', kind: 'pay-off', accountId: loan.id, startMonth: '2026-01', target: 4000_00 })
    const t = tables({ household: [household()], accounts: [loan], rows: [salary, pay], cells: [cellValue(salary.id, '2026-01', 1000_00), cellValue(pay.id, '2026-01', 250_00)], goals: [g] })
    const out = computeEngine({ tables: t, months: monthRange('2026-01', '2026-06') })
    // 5,000 owed, 250 a month: 4,250 in March, 4,000 in April
    const march = computeGoals(t, out, '2026-03')[0]
    expect(march).toMatchObject({ startValue: 5000_00, current: 4250_00, target: 4000_00, reachedMonth: '2026-04', status: 'on-track' })
    expect(march.progress).toBeCloseTo(0.75, 6)
    expect(goalStatusLine(march, 'en-IE', 3).text).toMatch(/^€4,250\.00 still owed, going down from €5,000\.00 to €4,000\.00 · reached by /)
    const april = computeGoals(t, out, '2026-04')[0]
    expect(april).toMatchObject({ status: 'reached', progress: 1 })
    expect(goalStatusLine(april, 'en-IE', 2).text).toMatch(/^Down to €4,000\.00\. Reached in /)
    // the same debt with no amount named is cleared at zero, and reads as it always did
    const clear = computeGoals({ ...t, goals: [{ ...g, target: 0 }] }, out, '2026-03')[0]
    expect(clear).toMatchObject({ target: 0, reachedMonth: null, status: 'no-projection' })
    expect(clear.progress).toBeCloseTo(0.15, 6)
    expect(goalStatusLine(clear, 'en-IE', 3).text).toBe('€4,250.00 still owed, down from €5,000.00 · not reached in the next 3 months')
    // already at or under the amount when the goal is set: done from the start
    const under = computeGoals({ ...t, goals: [{ ...g, target: 6000_00 }] }, out, '2026-03')[0]
    expect(under).toMatchObject({ status: 'reached', progress: 1, reachedMonth: '2026-01' })
  })
  it('virtual account and net worth goals read the pool series and the net worth', () => {
    const savings = account({ name: 'Savings', type: 'savings', openingBalance: 1000_00 })
    const travel = pool({ name: 'Travel', accountId: savings.id, openingBalance: 600_00 })
    const alloc = row({ name: 'To Travel', section: 'transfer', kind: 'pool-allocation', accountId: savings.id })
    travel.allocationRowId = alloc.id
    const salary = row({ name: 'Salary', section: 'income', order: 'a0' })
    const toSavings = row({ name: 'To savings', section: 'transfer', kind: 'to-savings', accountId: savings.id, order: 'c1' })
    const goals = [
      goal({ name: 'Trip', kind: 'pool-balance', poolId: travel.id, target: 1000_00, order: 'a1' }),
      goal({ name: 'Worth', kind: 'net-worth', target: 2500_00, order: 'a0' }),
    ]
    const t = tables({ household: [household()], accounts: [savings], pools: [travel], rows: [salary, alloc, toSavings], cells: [cellValue(salary.id, '2026-01', 1000_00), cellValue(alloc.id, '2026-01', 200_00)], goals })
    const res = computeGoals(t, computeEngine({ tables: t, months: monthRange('2026-01', '2026-04') }), '2026-01')
    expect(res.map((r) => r.goal.name)).toEqual(['Worth', 'Trip']) // sorted by order
    const trip = res[1]
    expect(trip).toMatchObject({ current: 800_00, reachedMonth: '2026-02', status: 'on-track', currency: 'EUR' })
    const worth = res[0]
    expect(worth.current).toBe(1000_00 + 1000_00) // savings 1000 + plug 1000 (allocation moves inside savings)
    expect(worth.reachedMonth).toBe('2026-02')
  })
  it('explains goals it cannot measure', () => {
    const { t, savings, out } = savingsWorld([])
    const gone = computeGoals({ ...t, goals: [goal({ name: 'x', kind: 'account-balance', accountId: newId(), target: 1 })] }, out, '2026-01')[0]
    expect(gone.status).toBe('broken')
    expect(gone.problem).toMatch(/gone/)
    const untracked = { ...savings, tracked: false }
    const t2 = { ...t, accounts: [untracked], goals: [goal({ name: 'y', kind: 'account-balance', accountId: savings.id, target: 1 })] }
    const u = computeGoals(t2, computeEngine({ tables: t2, months: out.months }), '2026-01')[0]
    expect(u.status).toBe('broken')
    expect(u.problem).toMatch(/not tracked/)
    const p = computeGoals({ ...t, goals: [goal({ name: 'z', kind: 'pool-balance', poolId: newId(), target: 1 })] }, out, '2026-01')[0]
    expect(p.problem).toMatch(/virtual account/)
    expect(computeGoals({ ...t, goals: [{ ...goal({ name: 'd', kind: 'net-worth', target: 1 }), deletedAt: T0 }] }, out, '2026-01')).toEqual([])
  })
})
