import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Island } from '@/components/ui/island'
import { cn } from '@/lib/utils'
import { HUES } from '@/app/hues'
import { formatPercent } from '@/app/format'
import { computeGoals, type EngineOutput } from '@/engine'
import { monthDiff, type Goal, type Household, type MonthKey, type Tables } from '@/model'
import { RemoveDialog } from '@/features/remove/RemoveDialog'
import { GoalDialog } from './GoalDialog'
import { goalStatusLine } from './goalText'

interface Props {
  household: Household
  tables: Tables
  engine: EngineOutput
  month: MonthKey
  /** Bars only, no description, nothing when there are no goals. */
  compact?: boolean
}

/** What the household is heading for: a bar per goal, read against the current plan. The gold of the bars is the one bold colour on screen. */
export function GoalsCard({ household, tables, engine, month, compact = false }: Props) {
  const [editing, setEditing] = useState<Goal | 'new' | null>(null)
  const [removing, setRemoving] = useState<Goal | null>(null)
  const goals = useMemo(() => computeGoals(tables, engine, month), [tables, engine, month])
  const { locale } = household
  if (compact && goals.length === 0) return null
  const horizon = engine.months.length ? monthDiff(month, engine.months[engine.months.length - 1]) : 0

  const body = (
    <div className={cn('space-y-3', compact && 'space-y-2')}>
      {goals.length === 0 && (
        <p className="text-muted-foreground">No goals yet. Pick a number to reach or a debt to clear; the bar shows how the current plan gets there.</p>
      )}
      {goals.map((p) => {
        const line = goalStatusLine(p, locale, horizon)
        const pct = Math.round(p.progress * 100)
        return (
          <div key={p.goal.id} className="space-y-1">
            <div className="flex items-baseline justify-between gap-3">
              <span className="font-medium">{p.goal.name}</span>
              <span className="flex items-center gap-2">
                <span className={cn('tabular-nums', p.status === 'reached' && HUES.income.text)}>{formatPercent(p.progress, locale)}</span>
                {!compact && <Button size="xs" variant="ghost" onClick={() => setEditing(p.goal)}>Edit</Button>}
              </span>
            </div>
            <div role="progressbar" aria-label={p.goal.name} aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} className="h-2 w-full overflow-hidden rounded-full bg-goal-tint">
              <div className={cn('h-full rounded-full', HUES.goal.fill, p.status === 'reached' && HUES.income.fill)} style={{ width: `${pct}%` }} />
            </div>
            <p className={cn('text-[11px] leading-[15px]', line.cls)}>{line.text}</p>
          </div>
        )
      })}
      {!compact && <Button variant="outline" size="xs" onClick={() => setEditing('new')}>Add goal</Button>}
    </div>
  )

  return (
    <>
      {compact ? (
        <Island title="Goals" help="goal.status">{body}</Island>
      ) : (
        <Island air title="Goals" help="goal.status" description="A number to reach or a debt to clear. Each bar shows how far the current plan gets, month by month.">{body}</Island>
      )}
      {editing && (
        <GoalDialog
          household={household} tables={tables} goal={editing === 'new' ? null : editing} onClose={() => setEditing(null)}
          onRemove={editing !== 'new' ? () => { setRemoving(editing); setEditing(null) } : undefined}
        />
      )}
      {removing && <RemoveDialog target={{ kind: 'goal', id: removing.id }} tables={tables} household={household} onClose={() => setRemoving(null)} />}
    </>
  )
}
