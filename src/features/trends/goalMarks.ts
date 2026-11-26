import type { ChartLine, ChartTarget } from '@/components/charts/LineChart'
import { formatAmount, formatMonth } from '@/app/format'
import type { EngineOutput, GoalProgress } from '@/engine'
import type { MonthKey, Tables } from '@/model'
import { txt } from '@/i18n'

const T = txt.trends.goals

/** The line a net worth goal is drawn on: the subject's own. */
export const NET_WORTH_LINE = 'netWorth'
/** The balance a goal watches, as a line of its own: ink, not a subject's colour; it is told by the name at its end. */
export const GOAL_LINE_COLOR = 'var(--trend-balance)'

/** A goal as the Trends chart shows it (DESIGN.md §11). */
export interface GoalMark {
  progress: GoalProgress
  /** Why it cannot be drawn, when it cannot: it is in another currency than the chart, or it cannot be measured. */
  undrawn: string | null
  /** The balance it watches as a line of its own; null for a net worth goal, which is drawn on the net worth line. */
  line: ChartLine | null
  /** Its amount across the chart, from the month it was set: null when it cannot be drawn or starts after the months in view. */
  target: ChartTarget | null
}

/**
 * Every goal with what the chart needs to show it: the dotted line at its amount, the flag at the month it is due,
 * the dot where the plan gets there (`reachedMonth`, worked out over the months in view, so a longer look ahead can
 * find a month the plan itself does not reach), and for a goal on an account, a virtual account, a card or a loan,
 * that balance as a line. The chart is in the household's currency: a goal in another currency is not drawn.
 */
export function goalMarks(goals: GoalProgress[], tables: Tables, engine: EngineOutput, months: MonthKey[], locale: string): GoalMark[] {
  const base = tables.household.find((h) => !h.deletedAt)?.baseCurrency ?? 'EUR'
  const at = (m: MonthKey | null) => {
    const i = m ? months.indexOf(m) : -1
    return i >= 0 ? i : null
  }
  return goals.map((p): GoalMark => {
    const { goal } = p
    const undrawn = p.problem ?? (p.currency !== base ? T.itIsInThe(p.currency, base) : null)
    const own = goal.kind === 'net-worth' ? null
      : goal.kind === 'pool-balance'
        ? { name: tables.pools.find((x) => x.id === goal.poolId)?.name, read: (m: MonthKey) => engine.pools[goal.poolId ?? '']?.months[m]?.balance }
        : { name: tables.accounts.find((x) => x.id === goal.accountId)?.name, read: (m: MonthKey) => engine.accounts[goal.accountId ?? '']?.months[m]?.balance }
    const lineId = own ? `goal:${goal.id}` : NET_WORTH_LINE
    const line: ChartLine | null = own && !undrawn ? { id: lineId, label: own.name ?? goal.name, color: GOAL_LINE_COLOR, values: months.map((m) => own.read(m) ?? 0) } : null
    // set after the last month in view: nothing to draw yet
    const starts = months.length > 0 && goal.startMonth <= months[months.length - 1]
    const target: ChartTarget | null = undrawn || !starts ? null : {
      id: goal.id,
      label: `${goal.name}: ${formatAmount(p.target, base, locale, { compact: true })}${goal.targetMonth ? T.byMonth(formatMonth(goal.targetMonth, locale)) : ''}`,
      value: p.target,
      from: at(goal.startMonth) ?? 0,
      due: at(goal.targetMonth),
      reached: at(p.reachedMonth),
      line: lineId,
    }
    return { progress: p, undrawn, line, target }
  })
}
