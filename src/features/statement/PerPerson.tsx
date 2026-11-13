import { useMemo } from 'react'
import { Island } from '@/components/ui/island'
import { cn } from '@/lib/utils'
import { formatAmount } from '@/app/format'
import { computePersonBudgets, type EngineOutput, type PersonBudget } from '@/engine'
import type { Household, MonthKey, Tables } from '@/model'
import { AMOUNT_COL } from './StatementLine'
import { LOCKED } from './lead'

const LINES: Array<{ label: string; of: (p: PersonBudget) => number }> = [
  { label: 'Income', of: (p) => p.income },
  { label: 'Own spending', of: (p) => p.ownSpend },
  { label: 'Pocket money', of: (p) => p.pocket },
]
const CELL = 'h-11 px-2 md:h-7'

/**
 * Under the Statement's two halves, with two or more adults: what each brings, spends on themselves and takes as pocket
 * money, and what that leaves for the household. A dense island like the halves above it, a column per adult. From
 * 1024 px it is as wide as a half's left side, so the names stay close to their amounts.
 */
export function PerPerson({ household, tables, engine, month, locked = false }: {
  household: Household; tables: Tables; engine: EngineOutput; month: MonthKey
  /** The guided setup is on: no step is about this card, so it is dimmed until the setup is left. */
  locked?: boolean
}) {
  const { locale, baseCurrency: ccy } = household
  const people = useMemo(() => computePersonBudgets(tables, engine, month), [tables, engine, month])
  if (people.length < 2) return null
  return (
    <Island title="Per person" help="statement.perPerson" className={cn('lg:w-1/2', locked && LOCKED)} bodyClassName="overflow-x-auto px-0 pb-0 pt-1" inert={locked || undefined} data-testid="per-person">
      <table className="w-full text-sm md:text-xs">
        <thead>
          <tr className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            <td className="px-2 py-1" />
            {people.map((p) => <th key={p.entityId} scope="col" className={cn(AMOUNT_COL, 'px-2 py-1 font-semibold')}>{p.name}</th>)}
          </tr>
        </thead>
        <tbody>
          {LINES.map((line) => (
            <tr key={line.label} className="border-t border-border/60">
              <th scope="row" className={cn(CELL, 'text-left font-normal')}>{line.label}</th>
              {people.map((p) => <td key={p.entityId} className={cn(CELL, AMOUNT_COL)}>{formatAmount(line.of(p), ccy, locale)}</td>)}
            </tr>
          ))}
          <tr className="border-t font-semibold">
            <th scope="row" className={cn(CELL, 'text-left font-semibold')}>Leaves for the household</th>
            {people.map((p) => <td key={p.entityId} className={cn(CELL, AMOUNT_COL, p.contribution < 0 && 'text-expense')}>{formatAmount(p.contribution, ccy, locale, { sign: 'exceptZero' })}</td>)}
          </tr>
        </tbody>
      </table>
    </Island>
  )
}
