import { useMemo, useState } from 'react'
import { Lock } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Chip } from '@/components/ui/chip'
import { Island } from '@/components/ui/island'
import { StatTile } from '@/components/ui/stat-tile'
import { Check } from '@/components/Check'
import { MonthPicker } from '@/components/MonthPicker'
import { PageHeader } from '@/components/PageHeader'
import { formatAmount, formatMonth } from '@/app/format'
import { useStore } from '@/app/store'
import { activeHousehold, defaultMonths, useEngine, useTables } from '@/app/useEngine'
import { cellKey, computePersonBudgets, type EngineOutput } from '@/engine'
import { isDue, monthOfDate, type Household, type MonthKey, type Tables } from '@/model'
import { addPlanYear, closeMonth, recurringStatus, reopenMonth, scheduleLive, setCellDone, setRecurringPaid } from '@/store'
import { HUES } from '@/app/hues'
import { GoalsCard } from '@/features/goals/GoalsCard'

/** This month's moves: the stats, the goals, the adults side by side, the transfers to make and the payments due, each a tick. */
export function MovesScreen() {
  const store = useStore()
  const tables = useTables()
  const household = activeHousehold(tables)
  const months = useMemo(() => (household && tables ? defaultMonths(household, tables) : []), [household, tables])
  const engine = useEngine(tables, months)
  const [month, setMonth] = useState<MonthKey>(() => monthOfDate())
  const [error, setError] = useState<string | null>(null)
  if (!tables || !household || !engine) return null
  const { locale, baseCurrency: ccy } = household
  const m = months.includes(month) ? month : months[months.length - 1]
  const t = engine.totals[m]
  const act = (fn: () => Promise<unknown>) => void fn().catch((e) => setError(e instanceof Error ? e.message : 'Action failed'))
  const accountName = (id: string | null) => (id ? tables.accounts.find((a) => a.id === id)?.name ?? '' : '')

  const transfers = engine.rows
    .filter((r) => r.section === 'transfer')
    .map((r) => ({ row: r, cell: engine.cells[cellKey(r.id, m)] }))
    .filter((x) => x.cell && x.cell.source !== 'archived' && x.cell.value !== 0)
  const due = tables.recurringItems.filter((r) => scheduleLive(tables, r, m) && isDue(r, m)).sort((a, b) => a.name.localeCompare(b.name))
  const openCount = transfers.filter((x) => x.cell.status !== 'done').length + due.filter((d) => recurringStatus(tables, d, m) === 'due').length
  /** What a schedule actually posted this month, when the Paid sheet changed it. */
  const postedAmount = (d: (typeof due)[number]) => engine.cells[cellKey(d.rowId, m)]?.items.find((i) => i.recurringItemId === d.id)?.effectiveAmount ?? d.amount

  return (
    <div className="mx-auto max-w-3xl space-y-4 text-sm md:text-xs">
      <PageHeader title="Moves" subline={<>{household.name}{t.closed && <> · <Chip tone="zinc"><Lock aria-hidden /> closed</Chip></>}</>}>
        <MonthPicker months={months} month={m} onChange={setMonth} locale={locale} onAddYear={() => act(() => addPlanYear(store))} />
        {t.closed ? (
          <Button size="sm" variant="outline" onClick={() => act(() => reopenMonth(store, m))}>Reopen month</Button>
        ) : (
          <Button size="sm" onClick={() => act(() => closeMonth(store, m))}>Close month</Button>
        )}
        {error && <p role="alert" className="basis-full text-destructive">{error}</p>}
      </PageHeader>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        <StatTile label="Income" help="derived.incomeTotal" value={formatAmount(t.income, ccy, locale)} tone={HUES.income} />
        <StatTile label="Expenses" help="derived.expensesTotal" value={formatAmount(t.expensesTotal, ccy, locale)} tone={HUES.expense} />
        <StatTile label="To savings" help="stat.toSavings" value={formatAmount(t.toSavings, ccy, locale, { sign: 'exceptZero' })} tone={HUES.transfer} />
        <StatTile label="Net worth" help="derived.netWorth" value={<span className={(engine.netWorth[m] ?? 0) < 0 ? 'text-expense' : undefined}>{formatAmount(engine.netWorth[m] ?? 0, ccy, locale)}</span>} tone={HUES.worth} />
        <StatTile label={openCount === 0 ? 'All moves done' : 'Moves left'} help="stat.movesLeft" value={String(openCount)} />
      </div>

      <GoalsCard household={household} tables={tables} engine={engine} month={m} />

      <PerPerson household={household} tables={tables} engine={engine} month={m} />

      <Island air tone={HUES.transfer} title="Transfers to make" description="Money that leaves the main account this month on purpose. Tick when transferred.">
        <div className="divide-y divide-border/60">
          {transfers.length === 0 && <p className="py-2 text-muted-foreground">Nothing to transfer.</p>}
          {transfers.map(({ row, cell }) => (
            <div key={row.id} className="flex min-h-9 items-center gap-3 py-1.5">
              <span className="flex w-24 shrink-0 items-center gap-1.5">
                <Check label="" aria-label={`${row.name} transferred`} checked={cell.status === 'done'} disabled={t.closed} onChange={(e) => act(() => setCellDone(store, row.id, m, e.target.checked))} />
                {cell.source === 'derived' && <Chip tone="zinc">automatic</Chip>}
              </span>
              <span className="min-w-0 flex-1 truncate">{row.name}{row.accountId && <span className="text-muted-foreground"> → {accountName(row.accountId)}</span>}</span>
              <span className={`tabular-nums ${cell.value < 0 ? 'text-draw' : ''}`}>
                {formatAmount(Math.abs(cell.value), cell.currency, locale)}
                {cell.currency !== ccy && <span className="ml-1 text-muted-foreground">≈ {formatAmount(Math.abs(cell.valueBase), ccy, locale, { compact: true })}</span>}
                {cell.value < 0 ? ' back' : ''}
              </span>
            </div>
          ))}
        </div>
      </Island>

      <Island air tone={HUES.expense} title="Payments due" description={`Schedules that fall in ${formatMonth(m, locale)}. Tick when paid.`}>
        <div className="divide-y divide-border/60">
          {due.length === 0 && <p className="py-2 text-muted-foreground">Nothing due.</p>}
          {due.map((d) => {
            const status = recurringStatus(tables, d, m)
            return (
              <div key={d.id} className="flex min-h-9 items-center gap-3 py-1.5">
                <Check label="" aria-label={`${d.name} paid`} className="w-20" checked={status === 'paid'} disabled={t.closed} onChange={(e) => act(() => setRecurringPaid(store, d.id, m, e.target.checked))} />
                <span className="min-w-0 flex-1 truncate">{d.name}{d.accountId && <span className="text-muted-foreground"> · {accountName(d.accountId)}</span>}</span>
                <span className="tabular-nums">{formatAmount(postedAmount(d), d.currency ?? ccy, locale)}</span>
              </div>
            )
          })}
        </div>
      </Island>
    </div>
  )
}

const TH = 'py-1 font-semibold text-muted-foreground'
const TD = 'py-1 tabular-nums'

/** With two or more adults: what each brings, spends on themselves, takes as pocket money, and leaves for the household. */
function PerPerson({ household, tables, engine, month }: { household: Household; tables: Tables; engine: EngineOutput; month: MonthKey }) {
  const { locale, baseCurrency: ccy } = household
  const people = useMemo(() => computePersonBudgets(tables, engine, month), [tables, engine, month])
  if (people.length < 2) return null
  return (
    <Island air title="Per person" description="Income minus own spending minus pocket money: what each adult leaves for the household this month. A row counts for an adult when it belongs to them.">
      <table className="w-full">
        <thead className="text-left">
          <tr><th className={TH} />{people.map((p) => <th key={p.entityId} className={`${TH} text-right`}>{p.name}</th>)}</tr>
        </thead>
        <tbody className="divide-y divide-border/60">
          <tr><td className="py-1">Income</td>{people.map((p) => <td key={p.entityId} className={`${TD} text-right`}>{formatAmount(p.income, ccy, locale)}</td>)}</tr>
          <tr><td className="py-1">Own spending</td>{people.map((p) => <td key={p.entityId} className={`${TD} text-right`}>{formatAmount(p.ownSpend, ccy, locale)}</td>)}</tr>
          <tr><td className="py-1">Pocket money</td>{people.map((p) => <td key={p.entityId} className={`${TD} text-right`}>{formatAmount(p.pocket, ccy, locale)}</td>)}</tr>
          <tr className="font-medium"><td className="py-1">Leaves for the household</td>{people.map((p) => <td key={p.entityId} className={`${TD} text-right ${p.contribution < 0 ? 'text-destructive' : ''}`}>{formatAmount(p.contribution, ccy, locale, { sign: 'exceptZero' })}</td>)}</tr>
        </tbody>
      </table>
    </Island>
  )
}
