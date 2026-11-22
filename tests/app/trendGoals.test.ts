import { describe, expect, it } from 'vitest'
import { computeEngine, computeGoals } from '@/engine'
import { FxRateSchema, GoalSchema, monthRange, newId, type Goal, type Tables } from '@/model'
import { goalMarks } from '@/features/trends/goalMarks'
import { T0, account, cellValue, household, pool, row, tables } from '../engine/helpers'

const months = monthRange('2026-01', '2026-12')
const goal = (over: Partial<Goal> & { name: string; kind: Goal['kind'] }): Goal => GoalSchema.parse({ id: newId(), createdAt: T0, updatedAt: T0, order: 'a0', startMonth: '2026-03', ...over })

function marksOf(t: Tables, range = months) {
  const engine = computeEngine({ tables: t, months: range })
  return goalMarks(computeGoals(t, engine, '2026-03'), t, engine, range, 'en-IE')
}

/** A household that moves 1,000.00 a month into its savings, from 2,000.00, and keeps nothing else. */
function saving(): { t: Tables; savingsId: string } {
  const h = household({ closingRule: 'leftover-plug' })
  const main = account({ name: 'Main account', type: 'checking', tracked: false })
  const savings = account({ name: 'Rainy day', type: 'savings', openingBalance: 2000_00 })
  const salary = row({ name: 'Salary', section: 'income', order: 'a0' })
  const toSavings = row({ name: 'To savings', section: 'transfer', kind: 'to-savings', accountId: savings.id, order: 'b0' })
  const t = tables({ household: [h], accounts: [main, savings], rows: [salary, toSavings], cells: [cellValue(salary.id, '2026-01', 1000_00), cellValue(toSavings.id, '2026-01', 1000_00)] })
  return { t, savingsId: savings.id }
}

describe('a goal on the Trends chart', () => {
  it('a net worth goal is drawn on the net worth line: from the month it was set, with the month it is due and the month the plan gets there', () => {
    const { t } = saving()
    const [m] = marksOf({ ...t, goals: [goal({ name: 'Cushion', kind: 'net-worth', target: 9000_00, targetMonth: '2026-10' })] })
    expect(m.undrawn).toBeNull()
    expect(m.line).toBeNull()
    // 3,000.00 at the end of January and 1,000.00 more each month: 9,000.00 at the end of July
    expect(m.target).toEqual({ id: m.progress.goal.id, label: 'Cushion: €9,000 by Oct 2026', value: 9000_00, from: 2, due: 9, reached: 6, line: 'netWorth' })
  })

  it('what lies outside the months in view is left out: a goal set before them starts at their first month, a due month after them has no flag', () => {
    const { t } = saving()
    const g = goal({ name: 'Far', kind: 'net-worth', target: 50_000_00, targetMonth: '2028-06', startMonth: '2025-06' })
    const [m] = marksOf({ ...t, goals: [g] })
    expect(m.target).toMatchObject({ from: 0, due: null, reached: null, label: 'Far: €50,000 by Jun 2028' })
    // a longer look ahead finds the month
    const [far] = marksOf({ ...t, goals: [g] }, monthRange('2026-01', '2030-12'))
    expect(far.target?.due).toBe(29)
    expect(far.target?.reached).toBe(47)
    // set after the last month in view: nothing to draw yet
    const [later] = marksOf({ ...t, goals: [goal({ name: 'Later', kind: 'net-worth', target: 1, startMonth: '2027-02' })] })
    expect(later.target).toBeNull()
  })

  it('a goal on an account brings that balance as a line of its own, named after the account', () => {
    const { t, savingsId } = saving()
    const [m] = marksOf({ ...t, goals: [goal({ name: 'Six months', kind: 'account-balance', accountId: savingsId, target: 6000_00 })] })
    expect(m.line).toMatchObject({ id: `goal:${m.progress.goal.id}`, label: 'Rainy day' })
    expect(m.line?.values.slice(0, 4)).toEqual([3000_00, 4000_00, 5000_00, 6000_00])
    expect(m.target).toMatchObject({ value: 6000_00, from: 2, due: null, reached: 3, line: `goal:${m.progress.goal.id}`, label: 'Six months: €6,000' })
  })

  it('a virtual account and a loan to clear work the same way', () => {
    const { t, savingsId } = saving()
    const travel = pool({ name: 'Travel', accountId: savingsId, openingBalance: 300_00 })
    const loan = account({ name: 'Car loan', type: 'loan', openingBalance: 5000_00 })
    const all: Tables = { ...t, accounts: [...t.accounts, loan], pools: [travel], goals: [
      goal({ name: 'Trip', kind: 'pool-balance', poolId: travel.id, target: 300_00 }),
      goal({ name: 'Clear the car', kind: 'pay-off', accountId: loan.id, target: 0 }),
    ] }
    const [trip, clear] = marksOf(all)
    expect(trip.line).toMatchObject({ label: 'Travel' })
    expect(trip.line?.values[2]).toBe(300_00)
    expect(trip.target).toMatchObject({ value: 300_00, reached: 2 })
    expect(clear.line).toMatchObject({ label: 'Car loan' })
    expect(clear.line?.values[0]).toBe(5000_00)
    // nothing pays it off: the plan does not get there
    expect(clear.target).toMatchObject({ value: 0, reached: null, label: 'Clear the car: €0' })
  })

  it('a goal in another currency is not drawn, and says why', () => {
    const { t } = saving()
    const dollars = account({ name: 'Dollar savings', type: 'savings', currency: 'USD', openingBalance: 1000_00 })
    const rate = FxRateSchema.parse({ pair: 'EUR/USD', month: '2026-01', rate: 1.1, source: 'manual', updatedAt: T0 })
    const [m] = marksOf({ ...t, accounts: [...t.accounts, dollars], fxRates: [rate], goals: [goal({ name: 'Dollars', kind: 'account-balance', accountId: dollars.id, target: 5000_00 })] })
    expect(m.undrawn).toBe('It is in USD; the charts are in EUR, so it is not drawn.')
    expect(m.line).toBeNull()
    expect(m.target).toBeNull()
  })

  it('a goal that cannot be measured is not drawn, and says what is wrong', () => {
    const { t, savingsId } = saving()
    const archived: Tables = { ...t, accounts: t.accounts.map((a) => (a.id === savingsId ? { ...a, archivedMonth: '2026-02' } : a)), goals: [goal({ name: 'Six months', kind: 'account-balance', accountId: savingsId, target: 6000_00 })] }
    const [m] = marksOf(archived)
    expect(m.undrawn).toMatch(/archived/)
    expect(m.line).toBeNull()
    expect(m.target).toBeNull()
  })
})
