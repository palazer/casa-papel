import { useMemo, useState } from 'react'
import { Lock } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Chip } from '@/components/ui/chip'
import { Island } from '@/components/ui/island'
import { StatTile } from '@/components/ui/stat-tile'
import { Check } from '@/components/Check'
import { MonthPicker } from '@/components/MonthPicker'
import { PageHeader } from '@/components/PageHeader'
import { formatAmount, formatMonth, formatPercent } from '@/app/format'
import { useStore } from '@/app/store'
import { activeHousehold, defaultMonths, useEngine, useTables } from '@/app/useEngine'
import { cellKey, computeContributions, computePersonBudgets, type EngineOutput } from '@/engine'
import { isDue, monthOfDate, type Household, type MonthKey, type Tables } from '@/model'
import { closeMonth, recurringStatus, reopenMonth, setCellDone, setRecurringPaid } from '@/store'
import { HUES } from '@/app/hues'
import { GoalsCard } from '@/features/goals/GoalsCard'

/** This month's moves: the stats, the goals, who pays what, the transfers to make and the payments due, each a tick. */
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
  const due = tables.recurringItems.filter((r) => !r.deletedAt && isDue(r, m)).sort((a, b) => a.name.localeCompare(b.name))
  const openCount = transfers.filter((x) => x.cell.status !== 'done').length + due.filter((d) => recurringStatus(tables, d, m) === 'due').length
  /** What a schedule actually posted this month, when the Paid sheet changed it. */
  const postedAmount = (d: (typeof due)[number]) => engine.cells[cellKey(d.rowId, m)]?.items.find((i) => i.recurringItemId === d.id)?.effectiveAmount ?? d.amount

  return (
    <div className="mx-auto max-w-3xl space-y-4 text-sm md:text-xs">
      <PageHeader title="Moves" subline={<>{household.name}{t.closed && <> · <Chip tone="zinc"><Lock aria-hidden /> closed</Chip></>}</>}>
        <MonthPicker months={months} month={m} onChange={setMonth} locale={locale} />
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
        <StatTile label="Net worth" help="derived.netWorth" value={formatAmount(engine.netWorth[m] ?? 0, ccy, locale)} tone={HUES.worth} />
        <StatTile label={openCount === 0 ? 'All moves done' : 'Moves left'} help="stat.movesLeft" value={String(openCount)} />
      </div>

      <GoalsCard household={household} tables={tables} engine={engine} month={m} />

      {household.moneyMode === 'proportional' ? <WhoPaysWhat household={household} tables={tables} engine={engine} month={m} /> : <PerPerson household={household} tables={tables} engine={engine} month={m} />}

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
              <span className={`tabular-nums ${cell.value < 0 ? 'text-draw' : ''}`}>{formatAmount(Math.abs(cell.value), ccy, locale)}{cell.value < 0 ? ' back' : ''}</span>
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

/** Proportional mode: every line split between the adults, then what each adult sends where. */
function WhoPaysWhat({ household, tables, engine, month }: { household: Household; tables: Tables; engine: EngineOutput; month: MonthKey }) {
  const { locale, baseCurrency: ccy } = household
  const c = useMemo(() => computeContributions(tables, engine, month), [tables, engine, month])
  const accountName = (id: string) => (id ? tables.accounts.find((a) => a.id === id)?.name ?? '' : 'Shared payments')
  const destinations = [...new Set(c.lines.map((l) => l.destinationAccountId ?? ''))]
  if (c.adults.length === 0) return null
  return (
    <Island air title="Who pays what" description={`Shared lines are split ${c.adults.map((a) => `${a.name} ${formatPercent(a.share, locale)}`).join(' / ')}. Own lines and lines for someone they pay for go to one person in full.`}>
      <div className="space-y-4">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="text-left">
              <tr><th className={TH}>Line</th><th className={`${TH} text-right`}>Total</th>{c.adults.map((a) => <th key={a.entityId} className={`${TH} text-right`}>{a.name}</th>)}</tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {c.lines.map((l) => (
                <tr key={l.rowId}>
                  <td className="py-1">{l.name}{l.routing !== 'shared' && <span className="ml-1 text-[10px] text-muted-foreground">{l.routing === 'own' ? 'own' : 'pays for'}</span>}</td>
                  <td className={`${TD} text-right`}>{formatAmount(l.total, ccy, locale)}</td>
                  {c.adults.map((a) => <td key={a.entityId} className={`${TD} text-right`}>{l.byAdult[a.entityId] ? formatAmount(l.byAdult[a.entityId], ccy, locale) : ''}</td>)}
                </tr>
              ))}
              <tr className="font-medium"><td className="py-1">Pays this month</td><td className={`${TD} text-right`}>{formatAmount(c.lines.reduce((s, l) => s + l.total, 0), ccy, locale)}</td>{c.adults.map((a) => <td key={a.entityId} className={`${TD} text-right`}>{formatAmount(a.owed, ccy, locale)}</td>)}</tr>
              <tr><td className="py-1 text-muted-foreground">Income</td><td /> {c.adults.map((a) => <td key={a.entityId} className={`${TD} text-right`}>{formatAmount(a.income, ccy, locale)}</td>)}</tr>
              <tr className="font-medium"><td className="py-1">Keeps</td><td />{c.adults.map((a) => <td key={a.entityId} className={`${TD} text-right ${a.remainder < 0 ? 'text-destructive' : ''}`}>{formatAmount(a.remainder, ccy, locale, { sign: 'exceptZero' })}</td>)}</tr>
            </tbody>
          </table>
        </div>
        <div>
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Transfers per person</p>
          <table className="w-full">
            <tbody className="divide-y divide-border/60">
              {destinations.map((d) => (
                <tr key={d || 'none'}>
                  <td className="py-1">→ {accountName(d)}</td>
                  {c.adults.map((a) => <td key={a.entityId} className={`${TD} text-right`}>{a.owedByDestination[d] ? formatAmount(a.owedByDestination[d], ccy, locale) : ''}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </Island>
  )
}

/** Pooled mode: what each adult brings, spends on themselves, takes as pocket money, and leaves for the household. */
function PerPerson({ household, tables, engine, month }: { household: Household; tables: Tables; engine: EngineOutput; month: MonthKey }) {
  const { locale, baseCurrency: ccy } = household
  const people = useMemo(() => computePersonBudgets(tables, engine, month), [tables, engine, month])
  if (people.length < 2) return null
  return (
    <Island air title="Per person" description="Income minus own spending minus pocket money: what each adult leaves for the household this month.">
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
