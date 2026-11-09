import { useCallback, useMemo, useState } from 'react'
import { Lock } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Chip } from '@/components/ui/chip'
import { InfoTip } from '@/components/InfoTip'
import { MonthPicker } from '@/components/MonthPicker'
import { PageHeader } from '@/components/PageHeader'
import { doneness, type DoneState } from '@/app/display'
import { useStore } from '@/app/store'
import { activeHousehold, defaultMonths, useEngine, useTables } from '@/app/useEngine'
import { buildStatement, cellKey, computeMainAccount, type GoalProgress, type StatementLine } from '@/engine'
import { lastDayOfMonth, monthDiff, monthOfDate, type MonthKey } from '@/model'
import { addPlanYear, setCellDone, setDerivedDone, setItemStatus } from '@/store'
import { goalStatusLine } from '@/features/goals/goalText'
import { CellEditor } from '@/features/grid/CellEditor'
import { StatementBand } from './StatementBand'
import { ESTIMATE_SHADE, type LineContext } from './StatementLine'

const walk = (lines: StatementLine[]): StatementLine[] => lines.flatMap((l) => [l, ...walk(l.children)])

/**
 * One month in accounting form (DESIGN.md §2 and §7): the month on top, money in beside money out, and under it where
 * things stand at the end of it, assets beside debts and net worth. Each half balances; the figures come from
 * `buildStatement`, which reads them off the engine. The month is worked here too: a tick marks a row or an item done,
 * a click on a line opens the cell editor to overwrite the amount or say how sure it is.
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
  const [editorRow, setEditorRow] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
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
  const editing = editorRow ? engine.rows.find((r) => r.id === editorRow) : undefined

  /** A row counts its items; an item is done or not; an empty line has nothing to tick. */
  function doneOf(line: StatementLine): { done: number; total: number; state: DoneState } | null {
    const cell = line.rowId ? engine!.cells[cellKey(line.rowId, m)] : undefined
    if (!cell) return null
    if (line.itemId) {
      if (line.skipped) return null
      const done = line.status === 'done' ? 1 : 0
      return { done, total: 1, state: done ? 'all' : 'none' }
    }
    return line.empty || cell.value === 0 ? null : doneness(cell)
  }

  /** One tick: a row, one of its items, or an automatic row's "moved" flag. */
  function onTick(line: StatementLine, done: boolean) {
    const row = engine!.rows.find((r) => r.id === line.rowId)
    const cell = row ? engine!.cells[cellKey(row.id, m)] : undefined
    if (!row || !cell) return
    setBusy(line.id)
    setError(null)
    const run = line.itemId
      ? setItemStatus(store, row.id, m, line.itemId, done ? 'done' : row.defaultStatus)
      : cell.source === 'derived' ? setDerivedDone(store, row.id, m, done) : setCellDone(store, row.id, m, done)
    run.catch((e) => setError(e instanceof Error ? e.message : 'Action failed')).finally(() => setBusy(null))
  }

  const base = { locale, ccy, isOpen, onToggle, goalText }
  const flowCtx: LineContext = { ...base, withChange: false, closed: statement.closed, doneOf, onTick, onEdit: setEditorRow, busy }
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

      <StatementBand
        title="The month" help="statement.month" band={statement.flow} ctx={flowCtx} totals={['Total in', 'Total out']}
        right={<span className="flex items-center gap-1.5 text-[11px] text-muted-foreground"><span className={ESTIMATE_SHADE}>an estimate</span><InfoTip help="statement.estimate" /></span>}
      />
      <StatementBand title="At the end of the month" help="statement.position" band={statement.position} ctx={positionCtx} totals={['Total', 'Total']} amountHead={day} />

      {editing && <CellEditor key={`${editing.id}:${m}`} tables={tables} engine={engine} household={household} row={editing} month={m} onClose={() => setEditorRow(null)} />}
    </div>
  )
}
