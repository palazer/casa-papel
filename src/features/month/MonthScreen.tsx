import { GoalsCard } from '@/features/goals/GoalsCard'
import { HUES, SECTION_HUE, type Hue } from '@/app/hues'
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
import { useStore } from '@/app/store'
import { activeHousehold, defaultMonths, useEngine, useTables } from '@/app/useEngine'
import { cellKey } from '@/engine'
import { monthOfDate, type MonthKey, type Section } from '@/model'
import { closeMonth, reopenMonth } from '@/store'
import { CellEditor } from '@/features/grid/CellEditor'
import { amountDisplay, doneLabel, doneness, flowOf, statusClass, toneClass } from '@/features/grid/display'
import { DoneDot } from '@/features/grid/DoneDot'

const SECTIONS: Array<{ key: Section; title: string }> = [
  { key: 'income', title: 'Income' },
  { key: 'expense', title: 'Expenses' },
  { key: 'transfer', title: 'Transfers' },
]

/** One month as a list (the phone's first screen, DESIGN.md §2): the totals, the goals, then every row with its
 *  amount and done dot. Rows keep 14 px text and 44 px of height here, the one place the desktop density does not apply. */
export function MonthScreen() {
  const store = useStore()
  const tables = useTables()
  const household = activeHousehold(tables)
  const months = useMemo(() => (household && tables ? defaultMonths(household, tables) : []), [household, tables])
  const engine = useEngine(tables, months)
  const [month, setMonth] = useState<MonthKey>(() => monthOfDate())
  const [selectedRow, setSelectedRow] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  if (!tables || !household || !engine) return null
  const { locale, baseCurrency: ccy, displayExpensesNegative: neg } = household
  const idx = Math.max(0, months.indexOf(month) === -1 ? months.length - 1 : months.indexOf(month))
  const m = months[idx]
  const t = engine.totals[m]
  const act = (fn: () => Promise<unknown>) => void fn().catch((e) => setError(e instanceof Error ? e.message : 'Action failed'))
  const row = selectedRow ? engine.rows.find((r) => r.id === selectedRow) : undefined

  return (
    <div className="mx-auto max-w-xl space-y-4">
      <PageHeader title="Month" subline={<>{household.name}{t?.closed && <> · <Chip tone="zinc"><Lock aria-hidden /> closed</Chip></>}</>}>
        <MonthPicker months={months} month={m} onChange={setMonth} locale={locale} />
        {t.closed ? (
          <Button size="sm" variant="outline" onClick={() => act(() => reopenMonth(store, m))}>Reopen month</Button>
        ) : (
          <Button size="sm" onClick={() => act(() => closeMonth(store, m))}>Close month</Button>
        )}
        <MarksLegend neg={neg} />
        {error && <p role="alert" className="basis-full text-destructive">{error}</p>}
      </PageHeader>

      <Island title="This month" bodyClassName="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-1 text-sm">
        <Stat label="Income" help="derived.incomeTotal" value={formatAmount(t.income, ccy, locale)} hue={HUES.income} />
        <Stat label="Expenses" help="derived.expensesTotal" value={formatAmount(t.expensesTotal, ccy, locale)} tone="out" hue={HUES.expense} />
        <Stat label="To savings" help="stat.toSavings" value={formatAmount(t.toSavings, ccy, locale, { sign: 'exceptZero' })} tone={t.toSavings < 0 ? 'draw' : 'neutral'} hue={HUES.transfer} />
        <Stat label={household.closingRule === 'savings-plug' ? 'Kept in account' : 'Leftover'} help={household.closingRule === 'savings-plug' ? 'derived.keptInAccount' : 'derived.leftover'} value={formatAmount(t.leftover, ccy, locale)} hue={HUES.transfer} />
        {Object.values(engine.accounts).map((s) => {
          const acc = tables.accounts.find((a) => a.id === s.accountId)
          return <Stat key={s.accountId} label={acc?.name ?? 'Account'} help={balanceHelp(acc?.type)} value={formatAmount(s.months[m]?.balance ?? 0, s.currency, locale)} hue={HUES.worth} />
        })}
        {Object.keys(engine.accounts).length > 0 && <Stat label="Net worth" help="derived.netWorth" value={formatAmount(engine.netWorth[m] ?? 0, ccy, locale)} hue={HUES.worth} />}
        {Object.values(engine.pools).map((p) => (
          <Stat key={p.poolId} label={`Pool account · ${tables.pools.find((x) => x.id === p.poolId)?.name ?? ''}`} help="balance.pool" value={formatAmount(p.months[m]?.balance ?? 0, ccy, locale)} hue={HUES.pool} />
        ))}
      </Island>

      <GoalsCard household={household} tables={tables} engine={engine} month={m} compact />

      {SECTIONS.map(({ key, title }) => {
        const rows = engine.rows.filter((r) => r.section === key)
        if (rows.length === 0) return null
        return (
          <Island key={key} title={title} help={`section.${key}`} tone={SECTION_HUE[key]} bodyClassName="px-0 pb-0 pt-1">
            <div className="divide-y divide-border/60">
              {rows.map((r) => {
                const c = engine.cells[cellKey(r.id, m)]
                if (!c || c.source === 'archived') return null
                const d = amountDisplay(c.value, flowOf(r), r.currency ?? ccy, locale, neg)
                const derived = c.source === 'derived'
                const dot = !derived && c.source !== 'empty' && ((m === monthOfDate() && !engine.totals[m]?.closed) || c.status === 'done') ? doneness(c) : null
                return (
                  <button
                    key={r.id} type="button" disabled={derived}
                    className={cn('flex min-h-11 w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm', !derived && 'hover:bg-muted', derived && 'bg-muted/40')}
                    onClick={() => setSelectedRow(r.id)}
                    aria-label={`${r.name}: ${d.text}${dot ? `, ${doneLabel(dot)}` : ''}`}
                  >
                    <span className="truncate">{r.name}{r.followsRowId ? <span className="ml-1 text-xs text-muted-foreground">= {engine.rows.find((x) => x.id === r.followsRowId)?.name ?? ''}</span> : null}</span>
                    <span className={cn('flex items-center gap-1 tabular-nums', toneClass[d.tone], c.source === 'empty' ? 'text-muted-foreground/40' : statusClass[c.status])}>
                      {dot && <DoneDot {...dot} className="mr-0.5" />}
                      {c.source === 'empty' ? '·' : d.text}
                    </span>
                  </button>
                )
              })}
            </div>
          </Island>
        )
      })}

      {row && <CellEditor key={`${row.id}:${m}`} tables={tables} engine={engine} household={household} row={row} month={m} onClose={() => setSelectedRow(null)} />}
    </div>
  )
}

function Stat({ label, value, tone = 'neutral', hue, help }: { label: string; value: string; tone?: 'neutral' | 'out' | 'draw'; hue?: Hue; help?: HelpKey }) {
  return (
    <>
      <span className={cn('flex min-w-0 items-center gap-1 text-muted-foreground', hue?.text)}>
        <span className="truncate">{label}</span>
        {help && <InfoTip help={help} />}
      </span>
      <span className={cn('text-right tabular-nums', tone === 'out' && 'text-expense', tone === 'draw' && 'text-draw')}>{value}</span>
    </>
  )
}
