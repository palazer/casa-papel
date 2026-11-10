import { HUES } from '@/app/hues'
import { formatAmount, formatMonth } from '@/app/format'
import type { GoalProgress } from '@/engine'
import type { MonthKey } from '@/model'

/**
 * One sentence on where a goal stands, with the class that colours it: the Goals card and the Statement say the same
 * thing in the same words. `horizon` is how many months of the plan lie ahead of the month being read.
 */
export function goalStatusLine(p: GoalProgress, locale: string, horizon: number): { text: string; cls: string } {
  const f = (v: number) => formatAmount(v, p.currency, locale)
  const fm = (m: MonthKey) => formatMonth(m, locale)
  const target = p.goal.targetMonth ? ` (target ${fm(p.goal.targetMonth)})` : ''
  if (p.problem) return { text: p.problem, cls: HUES.expense.text }
  const payOff = p.goal.kind === 'pay-off'
  // a debt is cleared at zero; brought down to another amount it is reached like any other goal
  const clears = payOff && p.target <= 0
  const where = !payOff ? `${f(p.current)} of ${f(p.target)}`
    : clears ? `${f(p.current)} still owed, down from ${f(p.startValue)}`
    : `${f(p.current)} still owed, going down from ${f(p.startValue)} to ${f(p.target)}`
  const done = clears ? 'cleared' : 'reached'
  switch (p.status) {
    case 'reached':
      return { text: clears ? `Nothing owed. Cleared in ${fm(p.reachedMonth!)}.` : payOff ? `Down to ${f(p.target)}. Reached in ${fm(p.reachedMonth!)}.` : `Reached in ${fm(p.reachedMonth!)}.`, cls: HUES.income.text }
    case 'on-track':
      return { text: `${where} · ${done} by ${fm(p.reachedMonth!)}${target}`, cls: 'text-muted-foreground' }
    case 'late':
      return {
        text: p.reachedMonth ? `${where} · ${done} by ${fm(p.reachedMonth)}, after the target of ${fm(p.goal.targetMonth!)}` : `${where} · not reached in the next ${horizon} months${target}`,
        cls: HUES.expense.text,
      }
    default:
      return { text: `${where} · not reached in the next ${horizon} months`, cls: 'text-muted-foreground' }
  }
}
