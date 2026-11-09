import { useCallback, useMemo, useState } from 'react'
import { Lock } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Chip } from '@/components/ui/chip'
import { MonthPicker } from '@/components/MonthPicker'
import { PageHeader } from '@/components/PageHeader'
import { useStore } from '@/app/store'
import { activeHousehold, defaultMonths, useEngine, useTables } from '@/app/useEngine'
import { buildStatement, computeMainAccount, type GoalProgress, type StatementLine } from '@/engine'
import { lastDayOfMonth, monthDiff, monthOfDate, type MonthKey } from '@/model'
import { addPlanYear } from '@/store'
import { goalStatusLine } from '@/features/goals/goalText'
import { StatementBand } from './StatementBand'
import type { LineContext } from './StatementLine'

const walk = (lines: StatementLine[]): StatementLine[] => lines.flatMap((l) => [l, ...walk(l.children)])

/**
 * One month in accounting form (DESIGN.md §2 and §7): the month on top, money in beside money out, and under it where
 * things stand at the end of it, assets beside debts and net worth. Each half balances; the figures come from
 * `buildStatement`, which reads them off the engine.
 */
export function StatementScreen() {
  const store = useStore()
  const tables = useTables()
  const household = activeHousehold(tables)
  const months = useMemo(() => (household && tables ? defaultMonths(household, tables) : []), [household, tables])
  const engine = useEngine(tables, months)
  const main = useMemo(() => (tables && engine ? computeMainAccount(tables, engine) : null), [tables, engine])
  const [month, setMonth] = useState<MonthKey>(() => monthOfDate())
  /** Lines someone opened or closed; the rest follow their own default. */
  const [openLines, setOpenLines] = useState<Record<string, boolean>>({})
  const [error, setError] = useState<string | null>(null)

  const idx = Math.max(0, months.indexOf(month) === -1 ? months.length - 1 : months.indexOf(month))
  const m = months[idx]
  const statement = useMemo(() => (tables && engine && m ? buildStatement(tables, engine, m, main) : null), [tables, engine, m, main])
  const isOpen = useCallback((line: StatementLine) => openLines[line.id] ?? line.open ?? false, [openLines])
  const onToggle = useCallback((line: StatementLine) => setOpenLines((s) => ({ ...s, [line.id]: !(s[line.id] ?? line.open ?? false) })), [])

  if (!tables || !household || !engine || !statement) return null
  const { locale, baseCurrency: ccy } = household
  const horizon = engine.months.length ? monthDiff(m, engine.months[engine.months.length - 1]) : 0
  const goalText = (g: GoalProgress) => goalStatusLine(g, locale, horizon)
  const base = { locale, ccy, isOpen, onToggle, goalText }
  const flowCtx: LineContext = { ...base, withChange: false }
  const positionCtx: LineContext = { ...base, withChange: true }
  const day = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${lastDayOfMonth(m)}T00:00:00Z`))
  const foldable = walk([...statement.flow.left.lines, ...statement.flow.right.lines, ...statement.position.left.lines, ...statement.position.right.lines])
    .filter((l) => l.kind !== 'group' && (l.children.length > 0 || !!l.goals?.length))
  const setAll = (open: boolean) => setOpenLines(Object.fromEntries(foldable.map((l) => [l.id, open])))
  const act = (fn: () => Promise<unknown>) => void fn().catch((e) => setError(e instanceof Error ? e.message : 'Action failed'))

  return (
    <div className="space-y-4">
      <PageHeader title="Statement" subline={<>{household.name}{statement.closed && <> · <Chip tone="zinc"><Lock aria-hidden /> closed</Chip></>}</>}>
        <MonthPicker months={months} month={m} onChange={setMonth} locale={locale} onAddYear={() => act(() => addPlanYear(store))} />
        <Button size="xs" variant="outline" onClick={() => setAll(true)}>Open all</Button>
        <Button size="xs" variant="outline" onClick={() => setAll(false)}>Close all</Button>
        {error && <p role="alert" className="basis-full text-destructive">{error}</p>}
        {statement.warnings.map((w) => <p key={w} className="basis-full text-amber-700">{w}</p>)}
      </PageHeader>

      <StatementBand title="The month" help="statement.month" band={statement.flow} ctx={flowCtx} totals={['Total in', 'Total out']} />
      <StatementBand title="At the end of the month" help="statement.position" band={statement.position} ctx={positionCtx} totals={['Total', 'Total']} amountHead={day} />
    </div>
  )
}
