import { useMemo, useState, type KeyboardEvent, type ReactNode } from 'react'
import { Check, ChevronDown, ChevronRight, Lock } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'
import { formatAmount, formatMonth, formatPercent } from '@/app/format'
import { readPref, writePref } from '@/app/prefs'
import { useStore } from '@/app/store'
import { activeHousehold, defaultMonths, useEngine, useTables } from '@/app/useEngine'
import { cellKey, type EngineOutput } from '@/engine'
import { monthOfDate, type Money, type MonthKey, type Row, type Section } from '@/model'
import { closeMonth, reopenMonth } from '@/store'
import { AddRowInline } from './AddRowInline'
import { CellEditor } from './CellEditor'
import { RowMenu } from './RowMenu'
import { amountDisplay, flowOf, statusClass, toneClass, type Flow } from './display'

const SECTIONS: Array<{ key: Section; title: string }> = [
  { key: 'income', title: 'Income' },
  { key: 'expense', title: 'Expenses' },
  { key: 'transfer', title: 'Transfers' },
]

export function GridScreen() {
  const store = useStore()
  const tables = useTables()
  const household = activeHousehold(tables)
  const [extra, setExtra] = useState(() => readPref('horizonExtra', 0))
  const months = useMemo(() => (household && tables ? defaultMonths(household, tables, extra) : []), [household, tables, extra])
  const engine = useEngine(tables, months)
  const [collapsed, setCollapsed] = useState<Set<Section>>(() => new Set())
  const [selected, setSelected] = useState<{ rowId: string; month: MonthKey } | null>(null)
  const [error, setError] = useState<string | null>(null)

  if (!tables || !household || !engine) return null
  const { locale, baseCurrency: ccy, displayExpensesNegative: neg } = household
  const today = monthOfDate()

  const rowsBySection = (s: Section) => engine.rows.filter((r) => r.section === s && !(r.archivedMonth && r.archivedMonth <= months[0]))
  let editableIndex = 0

  function toggle(s: Section) {
    setCollapsed((prev) => {
      const n = new Set(prev)
      if (n.has(s)) n.delete(s)
      else n.add(s)
      return n
    })
  }

  function onKeyDown(e: KeyboardEvent<HTMLTableElement>) {
    const el = e.target as HTMLElement
    const pos = el.dataset.cell
    if (!pos) return
    const [r, c] = pos.split(',').map(Number)
    const move = (dr: number, dc: number) => {
      const t = e.currentTarget.querySelector<HTMLElement>(`[data-cell="${r + dr},${c + dc}"]`)
      if (t) {
        t.focus()
        e.preventDefault()
      }
    }
    if (e.key === 'ArrowRight') move(0, 1)
    else if (e.key === 'ArrowLeft') move(0, -1)
    else if (e.key === 'ArrowDown') move(1, 0)
    else if (e.key === 'ArrowUp') move(-1, 0)
    else if (e.key === 'Enter' || e.key === ' ') {
      el.click()
      e.preventDefault()
    }
  }

  const act = (fn: () => Promise<unknown>) => void fn().catch((err) => setError(err instanceof Error ? err.message : 'Action failed'))

  const derivedRow = (label: string, flow: Flow, pick: (m: MonthKey) => Money, opts: { strong?: boolean; muted?: boolean } = {}): ReactNode => (
    <tr key={label} className={cn('bg-muted/40', opts.strong && 'font-medium')}>
      <th scope="row" className={cn('sticky left-0 z-10 bg-muted/90 px-3 py-1 text-left text-sm backdrop-blur', opts.muted && 'text-muted-foreground text-xs')}>
        {label}
      </th>
      {months.map((m) => {
        const v = pick(m)
        const d = amountDisplay(v, flow, ccy, locale, neg)
        return (
          <td key={m} className={cn('px-2 py-1 text-right text-sm tabular-nums', toneClass[d.tone], opts.muted && 'text-xs', engine.totals[m]?.closed && 'bg-muted/60')}>
            {v === 0 && opts.muted ? '' : d.text}
          </td>
        )
      })}
    </tr>
  )

  const selectedRow = selected ? engine.rows.find((r) => r.id === selected.rowId) : undefined

  return (
    <div className="space-y-3">
      {error && (
        <Alert variant="destructive" className="max-w-xl">
          <AlertDescription className="flex items-center justify-between gap-2">
            <span>{error}</span>
            <Button size="xs" variant="outline" onClick={() => setError(null)}>Dismiss</Button>
          </AlertDescription>
        </Alert>
      )}
      {engine.warnings.length > 0 && (
        <Alert className="max-w-xl">
          <AlertDescription>{engine.warnings.join(' · ')}</AlertDescription>
        </Alert>
      )}

      <div className="relative max-h-[calc(100dvh-9rem)] overflow-auto rounded-lg border">
        <table className="border-separate border-spacing-0 text-sm" onKeyDown={onKeyDown}>
          <thead>
            <tr>
              <th className="sticky top-0 left-0 z-30 min-w-60 border-b bg-background px-3 py-2 text-left text-xs font-medium text-muted-foreground">
                {household.name}
              </th>
              {months.map((m) => {
                const t = engine.totals[m]
                const isToday = m === today
                return (
                  <th key={m} className={cn('sticky top-0 z-20 min-w-28 border-b bg-background px-1 py-1 text-right text-xs font-medium', isToday && 'bg-primary/10')}>
                    <DropdownMenu>
                      <DropdownMenuTrigger
                        render={<button className="inline-flex w-full items-center justify-end gap-1 rounded px-1 py-1 hover:bg-muted" aria-label={`${formatMonth(m, locale)}${t?.closed ? ', closed' : ''}`} />}
                      >
                        {t?.closed && <Lock className="size-3 text-muted-foreground" aria-hidden />}
                        <span className={cn(isToday && 'font-semibold')}>{formatMonth(m, locale)}</span>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuGroup>
                          <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
                            Income {formatAmount(t?.income ?? 0, ccy, locale, { compact: true })} · Expenses {formatAmount(t?.expensesTotal ?? 0, ccy, locale, { compact: true })}
                          </DropdownMenuLabel>
                        </DropdownMenuGroup>
                        <DropdownMenuSeparator />
                        {t?.closed ? (
                          <DropdownMenuItem onClick={() => act(() => reopenMonth(store, m))}>Reopen month</DropdownMenuItem>
                        ) : (
                          <DropdownMenuItem onClick={() => act(() => closeMonth(store, m))}>Close month</DropdownMenuItem>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {SECTIONS.map(({ key, title }) => {
              const rows = rowsBySection(key)
              const isCollapsed = collapsed.has(key)
              return [
                <tr key={`${key}-head`} className="bg-background">
                  <th scope="row" className="sticky left-0 z-10 border-t bg-background px-2 py-1.5 text-left">
                    <button className="inline-flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground" onClick={() => toggle(key)} aria-expanded={!isCollapsed}>
                      {isCollapsed ? <ChevronRight className="size-3.5" /> : <ChevronDown className="size-3.5" />}
                      {title}
                    </button>
                  </th>
                  <td colSpan={months.length} className="border-t" />
                </tr>,
                ...(isCollapsed ? [] : rows.map((row) => <GridRow key={row.id} row={row} rIndex={editableIndex++} months={months} engine={engine} ccy={ccy} locale={locale} neg={neg} onSelect={(m) => setSelected({ rowId: row.id, month: m })} onError={setError} />)),
                !isCollapsed && (
                  <tr key={`${key}-add`}>
                    <td className="sticky left-0 z-10 bg-background px-1 py-0.5"><AddRowInline section={key} onError={setError} /></td>
                    <td colSpan={months.length} />
                  </tr>
                ),
                key === 'income' && derivedRow('Income total', 'in', (m) => engine.totals[m].income, { strong: true }),
                key === 'expense' && derivedRow('Expenses total', 'out', (m) => engine.totals[m].expensesTotal, { strong: true }),
                key === 'expense' && months.some((m) => engine.totals[m].fromSavingsDerived !== 0) && derivedRow('of which from savings & pools', 'in', (m) => engine.totals[m].fromSavingsDerived, { muted: true }),
                key === 'transfer' && derivedRow(household.closingRule === 'savings-plug' ? 'Kept in account' : 'Leftover', 'in', (m) => engine.totals[m].leftover, { strong: true }),
              ]
            })}

            {(Object.keys(engine.accounts).length > 0 || Object.keys(engine.pools).length > 0) && (
              <tr>
                <th scope="row" className="sticky left-0 z-10 border-t bg-background px-2 py-1.5 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">Balances</th>
                <td colSpan={months.length} className="border-t" />
              </tr>
            )}
            {Object.values(engine.accounts).map((s) => {
              const acc = tables.accounts.find((a) => a.id === s.accountId)
              return derivedRow(acc?.name ?? 'Account', 'in', (m) => s.months[m]?.balance ?? 0, { strong: true })
            })}
            {Object.values(engine.pools).map((p) => {
              const pool = tables.pools.find((x) => x.id === p.poolId)
              return derivedRow(`Pool · ${pool?.name ?? ''}`, 'in', (m) => p.months[m]?.balance ?? 0)
            })}
          </tbody>
        </table>
      </div>

      <div className="flex items-center gap-3 text-xs text-muted-foreground">
        <Button size="xs" variant="outline" onClick={() => { const n = extra + 12; setExtra(n); writePref('horizonExtra', n) }}>Show 12 more months</Button>
        <span>Click a cell to edit. Arrow keys move, Enter opens. Click a month name to close or reopen it.</span>
      </div>

      {selected && selectedRow && (
        <CellEditor tables={tables} engine={engine} household={household} row={selectedRow} month={selected.month} onClose={() => setSelected(null)} />
      )}
    </div>
  )
}

interface GridRowProps {
  row: Row
  rIndex: number
  months: MonthKey[]
  engine: EngineOutput
  ccy: string
  locale: string
  neg: boolean
  onSelect: (m: MonthKey) => void
  onError: (msg: string) => void
}

function GridRow({ row, rIndex, months, engine, ccy, locale, neg, onSelect, onError }: GridRowProps) {
  const totals = engine.rowTotals[row.id]
  const flow = flowOf(row)
  const rowCcy = row.currency ?? ccy
  return (
    <tr className="group">
      <th scope="row" className="sticky left-0 z-10 bg-background px-2 py-0.5 text-left font-normal">
        <div className="flex items-center gap-1">
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm">{row.name}{row.currency && row.currency !== ccy ? <span className="ml-1 text-xs text-muted-foreground">{row.currency}</span> : null}</div>
            <div className="truncate text-[11px] text-muted-foreground tabular-nums">
              Σ {formatAmount(totals?.total ?? 0, ccy, locale, { compact: true })}{row.section !== 'income' && totals?.shareOfIncome ? ` · ${formatPercent(totals.shareOfIncome, locale)} of income` : ''}
            </div>
          </div>
          <RowMenu row={row} onError={onError} />
        </div>
      </th>
      {months.map((m, c) => {
        const cell = engine.cells[cellKey(row.id, m)]
        if (!cell) return <td key={m} />
        const closed = engine.totals[m]?.closed
        const isDerived = cell.source === 'derived'
        const isEmpty = cell.source === 'empty'
        const d = amountDisplay(cell.value, flow, rowCcy, locale, neg)
        return (
          <td key={m} className={cn('p-0', closed && 'bg-muted/60')}>
            {cell.source === 'archived' ? null : isDerived ? (
              <div className={cn('px-2 py-1 text-right tabular-nums', toneClass[d.tone], statusClass.derived)}>{d.text}</div>
            ) : (
              <button
                type="button"
                data-cell={`${rIndex},${c}`}
                tabIndex={rIndex === 0 && c === 0 ? 0 : -1}
                aria-label={`${row.name} ${formatMonth(m, locale)}: ${isEmpty ? 'empty' : d.text}`}
                onClick={() => onSelect(m)}
                className={cn(
                  'flex w-full items-center justify-end gap-1 px-2 py-1 text-right tabular-nums outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring',
                  isEmpty ? 'text-muted-foreground/40' : toneClass[d.tone],
                  !isEmpty && statusClass[cell.status],
                )}
              >
                {cell.status === 'done' && !isEmpty && <Check className="size-3 text-muted-foreground" aria-hidden />}
                {isEmpty ? '·' : d.text}
              </button>
            )}
          </td>
        )
      })}
    </tr>
  )
}
