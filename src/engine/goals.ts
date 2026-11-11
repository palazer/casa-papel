/**
 * Goals: a finish line the household chose, read against numbers the engine already computes.
 * No new maths: a goal watches an account balance, a virtual account, a debt or the net worth.
 */
import { addMonths, compareMonths, type Goal, type Money, type MonthKey, type Tables } from '@/model'
import type { EngineOutput } from './types'

export type GoalStatus = 'reached' | 'on-track' | 'late' | 'no-projection' | 'broken'

export interface GoalProgress {
  goal: Goal
  /** Reading this month. */
  current: Money
  /** The amount to reach; for a debt the amount to bring it down to (zero clears it). */
  target: Money
  /** Pay-off goals: what was owed when the goal was set. */
  startValue: Money
  /** 0..1 */
  progress: number
  /** First month in the computed range (from the goal's start) that meets the target, or null. */
  reachedMonth: MonthKey | null
  status: GoalStatus
  currency: string
  /** Why a goal cannot be measured, in plain words. */
  problem: string | null
}

function reader(goal: Goal, tables: Tables, out: EngineOutput, month: MonthKey): { read: (m: MonthKey) => Money | null; currency: string; problem: string | null; opening: Money; openingMonth: MonthKey | null } {
  const base = tables.household.find((h) => !h.deletedAt)?.baseCurrency ?? 'EUR'
  if (goal.kind === 'net-worth') return { read: (m) => out.netWorth[m] ?? null, currency: base, problem: null, opening: 0, openingMonth: null }
  if (goal.kind === 'pool-balance') {
    const pool = goal.poolId ? tables.pools.find((p) => p.id === goal.poolId && !p.deletedAt) : undefined
    const series = goal.poolId ? out.pools[goal.poolId] : undefined
    if (!pool || !series) return { read: () => null, currency: base, problem: 'The virtual account this goal watched is gone. Edit the goal and pick another.', opening: 0, openingMonth: null }
    if (pool.archivedMonth && compareMonths(pool.archivedMonth, month) <= 0) return { read: () => null, currency: base, problem: `The virtual account "${pool.name}" is archived. Restore it under Household or edit the goal.`, opening: pool.openingBalance, openingMonth: null }
    return { read: (m) => series.months[m]?.balance ?? null, currency: base, problem: null, opening: pool.openingBalance, openingMonth: null }
  }
  const acc = goal.accountId ? tables.accounts.find((a) => a.id === goal.accountId && !a.deletedAt) : undefined
  const series = goal.accountId ? out.accounts[goal.accountId] : undefined
  if (!acc) return { read: () => null, currency: base, problem: 'The account this goal watched is gone. Edit the goal and pick another.', opening: 0, openingMonth: null }
  if (acc.archivedMonth && compareMonths(acc.archivedMonth, month) <= 0) return { read: () => null, currency: acc.currency, problem: `"${acc.name}" is archived. Restore it under Household or edit the goal.`, opening: acc.openingBalance, openingMonth: acc.openingMonth }
  if (!series) return { read: () => null, currency: acc.currency, problem: `"${acc.name}" is not tracked. Turn on "Track the balance" in its account settings.`, opening: acc.openingBalance, openingMonth: acc.openingMonth }
  return { read: (m) => series.months[m]?.balance ?? null, currency: series.currency, problem: null, opening: acc.openingBalance, openingMonth: acc.openingMonth }
}

const clamp = (x: number) => (Number.isFinite(x) ? Math.min(1, Math.max(0, x)) : 0)

export function computeGoals(tables: Tables, out: EngineOutput, month: MonthKey): GoalProgress[] {
  const goals = [...tables.goals.filter((g) => !g.deletedAt)].sort((a, b) => (a.order < b.order ? -1 : a.order > b.order ? 1 : 0))
  const last = out.months[out.months.length - 1]
  return goals.map((goal) => {
    const { read, currency, problem, opening, openingMonth } = reader(goal, tables, out, month)
    const payOff = goal.kind === 'pay-off'
    const current = read(month) ?? 0
    // what was owed when the goal was set: the month before its start, or the opening balance, or the first reading
    const startValue = payOff
      ? (read(addMonths(goal.startMonth, -1)) ?? (openingMonth && compareMonths(goal.startMonth, openingMonth) <= 0 ? opening : null) ?? read(goal.startMonth) ?? current)
      : 0
    // a debt comes down to its target, zero unless the goal names another amount
    const target = goal.target
    const met = (v: Money) => (payOff ? v <= target : v >= target)
    let reachedMonth: MonthKey | null = null
    if (!problem) {
      for (const m of out.months) {
        if (compareMonths(m, goal.startMonth) < 0) continue
        const v = read(m)
        if (v != null && met(v)) { reachedMonth = m; break }
      }
    }
    const progress = problem ? 0
      : payOff ? (startValue > target ? clamp((startValue - current) / (startValue - target)) : current <= target ? 1 : 0)
      : target > 0 ? clamp(current / target) : 1
    let status: GoalStatus
    if (problem) status = 'broken'
    else if (reachedMonth && compareMonths(reachedMonth, month) <= 0) status = 'reached'
    else if (goal.targetMonth && compareMonths(goal.targetMonth, month) < 0) status = 'late'
    else if (reachedMonth) status = goal.targetMonth && compareMonths(reachedMonth, goal.targetMonth) > 0 ? 'late' : 'on-track'
    else status = goal.targetMonth && last && compareMonths(goal.targetMonth, last) <= 0 ? 'late' : 'no-projection'
    return { goal, current, target, startValue, progress, reachedMonth, status, currency, problem }
  })
}
