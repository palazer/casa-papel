import { HUES } from '@/app/hues'
import { formatAmount, formatMonth } from '@/app/format'
import type { GoalProgress } from '@/engine'
import { txt } from '@/i18n'
import type { MonthKey } from '@/model'

const T = txt.goals.status

/**
 * One sentence on where a goal stands, with the class that colours it: the Goals card and the Statement say the same
 * thing in the same words. `horizon` is how many months of the plan lie ahead of the month being read.
 */
export function goalStatusLine(p: GoalProgress, locale: string, horizon: number): { text: string; cls: string } {
  const f = (v: number) => formatAmount(v, p.currency, locale)
  const fm = (m: MonthKey) => formatMonth(m, locale)
  const target = p.goal.targetMonth ? fm(p.goal.targetMonth) : null
  if (p.problem) return { text: p.problem, cls: HUES.expense.text }
  const payOff = p.goal.kind === 'pay-off'
  // a debt is cleared at zero; brought down to another amount it is reached like any other goal
  const clears = payOff && p.target <= 0
  const where = !payOff ? T.filling(f(p.current), f(p.target))
    : clears ? T.clearing(f(p.current), f(p.startValue))
    : T.payingDown(f(p.current), f(p.startValue), f(p.target))
  switch (p.status) {
    case 'reached':
      return { text: clears ? T.reachedCleared(fm(p.reachedMonth!)) : payOff ? T.reachedDown(f(p.target), fm(p.reachedMonth!)) : T.reached(fm(p.reachedMonth!)), cls: HUES.income.text }
    case 'on-track':
      return { text: T.onTrack(where, clears, fm(p.reachedMonth!), target), cls: 'text-muted-foreground' }
    case 'late':
      return {
        text: p.reachedMonth ? T.late(where, clears, fm(p.reachedMonth), fm(p.goal.targetMonth!)) : T.notReached(where, horizon, target),
        cls: HUES.expense.text,
      }
    default:
      return { text: T.notReached(where, horizon, null), cls: 'text-muted-foreground' }
  }
}
