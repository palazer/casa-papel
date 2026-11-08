import { describe, expect, it } from 'vitest'
import { computeEngine, computeGoals } from '@/engine'
import { GoalSchema, monthRange, newId, poolRef } from '@/model'
import { T0, account, cellItems, cellValue, household, pool, row, tables } from './helpers'

const months = monthRange('2026-01', '2026-06')

describe('archived accounts and pool accounts', () => {
  const h = household()
  const savings = account({ name: 'Savings', type: 'savings', openingBalance: 100000, archivedMonth: '2026-04' })
  const fund = account({ name: 'Fund', type: 'investment', openingBalance: 50000, investment: { projectionMode: 'fixed-rate', annualRate: 0, depositTiming: 'start', depositFxMode: 'monthly-rate', fixedRate: null } })
  const alloc = row({ name: 'Travel pool', section: 'transfer', kind: 'pool-allocation', accountId: savings.id, order: 'b0' })
  const travel = pool({ name: 'Travel', accountId: savings.id, allocationRowId: alloc.id, openingBalance: 10000, archivedMonth: '2026-03' })
  const salary = row({ name: 'Salary', section: 'income', order: 'a0' })
  const spend = row({ name: 'Travel', section: 'expense', defaultFundedBy: poolRef(travel.id), order: 'a1' })
  const t = tables({
    household: [h], accounts: [savings, fund], pools: [travel], rows: [salary, spend, alloc],
    cells: [cellValue(salary.id, '2026-01', 300000), cellValue(alloc.id, '2026-01', 5000), cellItems(spend.id, '2026-02', [{ amount: 2000, fundedBy: poolRef(travel.id) }])],
  })
  const out = computeEngine({ tables: t, months })

  it('stop their series at the archive month', () => {
    expect(Object.keys(out.accounts[savings.id].months)).toEqual(['2026-01', '2026-02', '2026-03'])
    expect(Object.keys(out.pools[travel.id].months)).toEqual(['2026-01', '2026-02'])
    expect(out.pools[travel.id].months['2026-02'].balance).toBe(10000 + 5000 + 5000 - 2000)
  })

  it('drop out of net worth from then on while the other accounts carry on', () => {
    expect(out.netWorth['2026-03']).toBe(out.accounts[savings.id].months['2026-03'].balance + 50000)
    expect(out.netWorth['2026-04']).toBe(50000)
    expect(out.netWorth['2026-06']).toBe(50000)
  })

  it('break the goals that watch them once the month reaches the archive', () => {
    const goal = GoalSchema.parse({ id: newId(), createdAt: T0, updatedAt: T0, name: 'Cushion', kind: 'account-balance', accountId: savings.id, target: 999999999, startMonth: '2026-01' })
    const poolGoal = GoalSchema.parse({ id: newId(), createdAt: T0, updatedAt: T0, name: 'Trip', kind: 'pool-balance', poolId: travel.id, target: 999999999, startMonth: '2026-01' })
    const withGoals = { ...t, goals: [goal, poolGoal] }
    const before = computeGoals(withGoals, out, '2026-02')
    expect(before.map((g) => g.status)).toEqual(['no-projection', 'no-projection'])
    const after = computeGoals(withGoals, out, '2026-05')
    expect(after.map((g) => [g.status, g.problem])).toEqual([
      ['broken', '"Savings" is archived. Restore it under Household or edit the goal.'],
      ['broken', 'The pool account "Travel" is archived. Restore it under Household or edit the goal.'],
    ])
  })
})
