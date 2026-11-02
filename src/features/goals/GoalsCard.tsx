import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import { HUES, cardBar } from '@/app/hues'
import { formatAmount, formatMonth, formatPercent } from '@/app/format'
import { computeGoals, type EngineOutput, type GoalProgress } from '@/engine'
import { monthDiff, type Goal, type Household, type MonthKey, type Tables } from '@/model'
import { GoalDialog } from './GoalDialog'

interface Props {
  household: Household
  tables: Tables
  engine: EngineOutput
  month: MonthKey
  /** Bars only, no description, nothing when there are no goals. */
  compact?: boolean
}

/** What the household is heading for: a bar per goal, read against the current plan. */
export function GoalsCard({ household, tables, engine, month, compact = false }: Props) {
  const [editing, setEditing] = useState<Goal | 'new' | null>(null)
  const goals = useMemo(() => computeGoals(tables, engine, month), [tables, engine, month])
  const { locale } = household
  if (compact && goals.length === 0) return null
  const horizon = engine.months.length ? monthDiff(month, engine.months[engine.months.length - 1]) : 0

  function statusLine(p: GoalProgress): { text: string; cls: string } {
    const f = (v: number) => formatAmount(v, p.currency, locale)
    const fm = (m: MonthKey) => formatMonth(m, locale)
    const target = p.goal.targetMonth ? ` (target ${fm(p.goal.targetMonth)})` : ''
    if (p.problem) return { text: p.problem, cls: HUES.expense.text }
    const payOff = p.goal.kind === 'pay-off'
    const where = payOff ? `${f(p.current)} still owed, down from ${f(p.startValue)}` : `${f(p.current)} of ${f(p.target)}`
    switch (p.status) {
      case 'reached':
        return { text: payOff ? `Nothing owed. Cleared in ${fm(p.reachedMonth!)}.` : `Reached in ${fm(p.reachedMonth!)}.`, cls: HUES.income.text }
      case 'on-track':
        return { text: `${where} · ${payOff ? 'cleared' : 'reached'} by ${fm(p.reachedMonth!)}${target}`, cls: 'text-muted-foreground' }
      case 'late':
        return {
          text: p.reachedMonth ? `${where} · ${payOff ? 'cleared' : 'reached'} by ${fm(p.reachedMonth)}, after the target of ${fm(p.goal.targetMonth!)}` : `${where} · not reached in the next ${horizon} months${target}`,
          cls: HUES.expense.text,
        }
      default:
        return { text: `${where} · not reached in the next ${horizon} months`, cls: 'text-muted-foreground' }
    }
  }

  return (
    <Card className={cardBar(HUES.goal)}>
      <CardHeader className={cn(compact && 'pb-2')}>
        <CardTitle>Goals</CardTitle>
        {!compact && <CardDescription>A number to reach or a debt to clear. Each bar shows how far the current plan gets, month by month.</CardDescription>}
      </CardHeader>
      <CardContent className="space-y-3">
        {goals.length === 0 && (
          <p className="text-sm text-muted-foreground">No goals yet. Pick a number to reach or a debt to clear; the bar shows how the current plan gets there.</p>
        )}
        {goals.map((p) => {
          const line = statusLine(p)
          const pct = Math.round(p.progress * 100)
          return (
            <div key={p.goal.id} className="space-y-1">
              <div className="flex items-baseline justify-between gap-3 text-sm">
                <span className="font-medium">{p.goal.name}</span>
                <span className="flex items-center gap-2">
                  <span className={cn('tabular-nums', p.status === 'reached' && HUES.income.text)}>{formatPercent(p.progress, locale)}</span>
                  {!compact && <Button size="xs" variant="ghost" onClick={() => setEditing(p.goal)}>Edit</Button>}
                </span>
              </div>
              <div role="progressbar" aria-label={p.goal.name} aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} className="h-2.5 w-full overflow-hidden rounded-full bg-goal-tint">
                <div className={cn('h-full rounded-full', HUES.goal.fill, p.status === 'reached' && HUES.income.fill)} style={{ width: `${pct}%` }} />
              </div>
              <p className={cn('text-xs', line.cls)}>{line.text}</p>
            </div>
          )
        })}
        {!compact && <Button variant="outline" size="sm" onClick={() => setEditing('new')}>Add goal</Button>}
      </CardContent>
      {editing && <GoalDialog household={household} tables={tables} goal={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </Card>
  )
}
