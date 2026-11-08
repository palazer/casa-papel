import { useMemo, useState } from 'react'
import { Lock } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Chip } from '@/components/ui/chip'
import { Island } from '@/components/ui/island'
import { InfoTip } from '@/components/InfoTip'
import { MarksLegend } from '@/components/MarksLegend'
import { MonthPicker } from '@/components/MonthPicker'
import { PageHeader } from '@/components/PageHeader'
import { cn } from '@/lib/utils'
import { formatAmount } from '@/app/format'
import { balanceHelp, type HelpKey } from '@/app/help'
import { HUES, SECTION_HUE, type Hue } from '@/app/hues'
import { readPref, writePref } from '@/app/prefs'
import { useStore } from '@/app/store'
import { activeHousehold, defaultMonths, useEngine, useTables } from '@/app/useEngine'
import { cellKey, groupRowsByCategory, type CellResult } from '@/engine'
import { monthOfDate, type MonthKey, type Row, type Section } from '@/model'
import { addPlanYear, closeMonth, derivedRowReason, reopenMonth, setCellDone, setDerivedDone, setItemStatus } from '@/store'
import { CellEditor } from '@/features/grid/CellEditor'
import { doneness } from '@/features/grid/display'
import { GoalsCard } from '@/features/goals/GoalsCard'
import { MonthLine } from './MonthLine'
import { PaidSheet } from './PaidSheet'
import { ProgressLine } from './ProgressLine'
import { monthProgress, progressText } from './progress'

const SECTIONS: Array<{ key: Section; title: string }> = [
  { key: 'income', title: 'Income' },
  { key: 'expense', title: 'Expenses' },
  { key: 'transfer', title: 'Transfers' },
]

/**
 * One month as a list (the phone's first screen, DESIGN.md §2): the progress line, the totals, the goals, then every
 * row with its amount and a tick. Rows keep 14 px text and 44 px of height here, the one place the desktop density does
 * not apply. Tapping a line opens the Paid sheet; an itemized line opens as an accordion with a tick per item.
 */
export function MonthScreen() {
  const store = useStore()
  const tables = useTables()
  const household = activeHousehold(tables)
  const months = useMemo(() => (household && tables ? defaultMonths(household, tables) : []), [household, tables])
  const engine = useEngine(tables, months)
  const [month, setMonth] = useState<MonthKey>(() => monthOfDate())
  const [editorRow, setEditorRow] = useState<string | null>(null)
  const [sheet, setSheet] = useState<{ rowId: string; itemId: string | null } | null>(null)
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set())
  const [hideDone, setHideDone] = useState(() => readPref('hideDone', false))
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  if (!tables || !household || !engine) return null
  const { locale, baseCurrency: ccy, displayExpensesNegative: neg } = household
  const idx = Math.max(0, months.indexOf(month) === -1 ? months.length - 1 : months.indexOf(month))
  const m = months[idx]
  const t = engine.totals[m]
  const closed = t?.closed ?? false
  const act = (fn: () => Promise<unknown>) => void fn().catch((e) => setError(e instanceof Error ? e.message : 'Action failed'))
  const progress = monthProgress(engine.rows, engine.cells, m)
  const editing = editorRow ? engine.rows.find((r) => r.id === editorRow) : undefined
  const sheetRow = sheet ? engine.rows.find((r) => r.id === sheet.rowId) : undefined
  const sheetCell = sheetRow ? engine.cells[cellKey(sheetRow.id, m)] : undefined

  function toggleExpanded(rowId: string, open: boolean) {
    setExpanded((s) => {
      const next = new Set(s)
      if (open) next.add(rowId)
      else next.delete(rowId)
      return next
    })
  }

  /** One tick: a row, one of its items, or an automatic row's "moved" flag. */
  function tick(row: Row, cell: CellResult, itemId: string | null, done: boolean) {
    setBusy(itemId ? `${row.id}:${itemId}` : row.id)
    setError(null)
    const run = itemId
      ? setItemStatus(store, row.id, m, itemId, done ? 'done' : row.defaultStatus)
      : cell.source === 'derived' ? setDerivedDone(store, row.id, m, done) : setCellDone(store, row.id, m, done)
    run.catch((e) => setError(e instanceof Error ? e.message : 'Action failed')).finally(() => setBusy(null))
  }

  const setHide = (v: boolean) => {
    setHideDone(v)
    writePref('hideDone', v)
  }

  return (
    <div className="mx-auto max-w-xl space-y-4">
      <PageHeader title="Month" subline={<>{household.name}{closed && <> · <Chip tone="zinc"><Lock aria-hidden /> closed</Chip></>}</>}>
        <MonthPicker months={months} month={m} onChange={setMonth} locale={locale} onAddYear={() => act(() => addPlanYear(store))} />
        {closed ? (
          <Button size="sm" variant="outline" onClick={() => act(() => reopenMonth(store, m))}>Reopen month</Button>
        ) : (
          <Button size="sm" onClick={() => act(() => closeMonth(store, m))}>Close month</Button>
        )}
        <MarksLegend neg={neg} />
        {error && <p role="alert" className="basis-full text-destructive">{error}</p>}
      </PageHeader>

      <ProgressLine text={progressText(progress, closed, ccy, locale)} hideDone={hideDone} onHideDone={setHide} />

      <Island title="This month" bodyClassName="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-1 text-sm">
        <Stat label="Income" help="derived.incomeTotal" value={formatAmount(t.income, ccy, locale)} hue={HUES.income} />
        <Stat label="Expenses" help="derived.expensesTotal" value={formatAmount(t.expensesTotal, ccy, locale)} tone="out" hue={HUES.expense} />
        <Stat label="To savings" help="stat.toSavings" value={formatAmount(t.toSavings, ccy, locale, { sign: 'exceptZero' })} tone={t.toSavings < 0 ? 'draw' : 'neutral'} hue={HUES.transfer} />
        <Stat label={household.closingRule === 'savings-plug' ? 'Kept in account' : 'Leftover'} help={household.closingRule === 'savings-plug' ? 'derived.keptInAccount' : 'derived.leftover'} value={formatAmount(t.leftover, ccy, locale)} hue={HUES.transfer} />
        {/* an account or pool account archived by this month has no balance to show */}
        {Object.values(engine.accounts).filter((s) => s.months[m]).map((s) => {
          const acc = tables.accounts.find((a) => a.id === s.accountId)
          return <Stat key={s.accountId} label={acc?.name ?? 'Account'} help={balanceHelp(acc?.type)} value={formatAmount(s.months[m].balance, s.currency, locale)} sub={s.currency !== ccy ? `≈ ${formatAmount(s.months[m].balanceBase, ccy, locale)}` : undefined} tone={s.months[m].balance < 0 ? 'out' : 'neutral'} hue={HUES.worth} />
        })}
        {Object.values(engine.accounts).some((s) => s.months[m]) && <Stat label="Net worth" help="derived.netWorth" value={formatAmount(engine.netWorth[m] ?? 0, ccy, locale)} tone={(engine.netWorth[m] ?? 0) < 0 ? 'out' : 'neutral'} hue={HUES.worth} />}
        {Object.values(engine.pools).filter((p) => p.months[m]).map((p) => (
          <Stat key={p.poolId} label={`Pool account · ${tables.pools.find((x) => x.id === p.poolId)?.name ?? ''}`} help="balance.pool" value={formatAmount(p.months[m].balance, ccy, locale)} tone={p.months[m].balance < 0 ? 'out' : 'neutral'} hue={HUES.pool} />
        ))}
      </Island>

      <GoalsCard household={household} tables={tables} engine={engine} month={m} compact />

      {SECTIONS.map(({ key, title }) => {
        const rows = engine.rows.filter((r) => r.section === key)
        if (rows.length === 0) return null
        const lines = rows.flatMap((row) => {
          const cell = engine.cells[cellKey(row.id, m)]
          return cell && cell.source !== 'archived' ? [{ row, cell }] : []
        })
        const shown = hideDone ? lines.filter(({ cell }) => cell.source === 'empty' || cell.value === 0 || doneness(cell).state !== 'all') : lines
        const cellOf = new Map(shown.map((l) => [l.row.id, l.cell]))
        const labelled = tables.categories.some((c) => !c.deletedAt && c.section === key)
        return (
          <Island key={key} title={title} help={`section.${key}`} tone={SECTION_HUE[key]} bodyClassName="px-0 pb-0 pt-1">
            {shown.length === 0 ? (
              <p className="px-3 py-2 text-xs text-muted-foreground">{lines.length ? 'All done' : 'Nothing here'}</p>
            ) : (
              <ul className="divide-y divide-border/60">
                {groupRowsByCategory(shown.map((l) => l.row), tables.categories).flatMap((g) => [
                  labelled && (
                    <li key={`label-${g.category?.id ?? 'none'}`} className="px-3 pb-0.5 pt-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                      {g.category?.name ?? 'No category'}
                    </li>
                  ),
                  ...g.rows.map((row) => {
                    const cell = cellOf.get(row.id)!
                    return (
                      <MonthLine
                        key={row.id} row={row} cell={cell} locale={locale} ccy={ccy} neg={neg} closed={closed}
                        automatic={derivedRowReason(row, household.closingRule) !== null}
                        followedName={row.followsRowId ? engine.rows.find((x) => x.id === row.followsRowId)?.name : undefined}
                        expanded={expanded.has(row.id)} onExpand={(open) => toggleExpanded(row.id, open)}
                        onOpen={(itemId) => setSheet({ rowId: row.id, itemId })}
                        onTick={(itemId, done) => tick(row, cell, itemId, done)}
                        busy={busy === row.id || (busy?.startsWith(`${row.id}:`) ?? false)}
                      />
                    )
                  }),
                ])}
              </ul>
            )}
          </Island>
        )
      })}

      {sheet && sheetRow && sheetCell && (
        <PaidSheet
          key={`${sheet.rowId}:${sheet.itemId ?? ''}:${m}`} household={household} row={sheetRow} cell={sheetCell} month={m} itemId={sheet.itemId}
          onClose={() => setSheet(null)} onOpenEditor={() => setEditorRow(sheet.rowId)}
        />
      )}
      {editing && <CellEditor key={`${editing.id}:${m}`} tables={tables} engine={engine} household={household} row={editing} month={m} onClose={() => setEditorRow(null)} />}
    </div>
  )
}

/** `sub` is a muted equivalent after the value: a foreign account's balance in the household currency. */
function Stat({ label, value, sub, tone = 'neutral', hue, help }: { label: string; value: string; sub?: string; tone?: 'neutral' | 'out' | 'draw'; hue?: Hue; help?: HelpKey }) {
  return (
    <>
      <span className={cn('flex min-w-0 items-center gap-1 text-muted-foreground', hue?.text)}>
        <span className="truncate">{label}</span>
        {help && <InfoTip help={help} />}
      </span>
      <span className={cn('text-right tabular-nums', tone === 'out' && 'text-expense', tone === 'draw' && 'text-draw')}>
        {value}
        {sub && <span className="ml-1 text-xs text-muted-foreground">{sub}</span>}
      </span>
    </>
  )
}
