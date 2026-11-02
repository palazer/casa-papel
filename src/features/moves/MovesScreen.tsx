import { useMemo, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Check } from '@/components/Check'
import { MonthPicker } from '@/components/MonthPicker'
import { formatAmount, formatMonth, formatPercent } from '@/app/format'
import { useStore } from '@/app/store'
import { activeHousehold, defaultMonths, useEngine, useTables } from '@/app/useEngine'
import { cellKey, computeContributions, computePersonBudgets, type EngineOutput } from '@/engine'
import { isDue, monthOfDate, type Household, type MonthKey, type Tables } from '@/model'
import { closeMonth, recurringStatus, reopenMonth, setCellDone, setRecurringPaid } from '@/store'
import { HUES, cardBar, type Hue } from '@/app/hues'
import { GoalsCard } from '@/features/goals/GoalsCard'

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
  const openCount = transfers.filter((x) => x.cell.source !== 'derived' && x.cell.status !== 'done').length + due.filter((d) => recurringStatus(tables, d, m) === 'due').length

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <MonthPicker months={months} month={m} onChange={setMonth} locale={locale}>{t.closed && <Badge variant="secondary">Closed</Badge>}</MonthPicker>
      {error && <p className="text-sm text-destructive" role="alert">{error}</p>}

      <Card>
        <CardContent className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-5">
          <Stat label="Income" value={formatAmount(t.income, ccy, locale)} hue={HUES.income} />
          <Stat label="Expenses" value={formatAmount(t.expensesTotal, ccy, locale)} hue={HUES.expense} />
          <Stat label="To savings" value={formatAmount(t.toSavings, ccy, locale, { sign: 'exceptZero' })} hue={HUES.transfer} />
          <Stat label="Net worth" value={formatAmount(engine.netWorth[m] ?? 0, ccy, locale)} hue={HUES.worth} />
          <Stat label={openCount === 0 ? 'All moves done' : 'Moves left'} value={String(openCount)} />
        </CardContent>
      </Card>

      <GoalsCard household={household} tables={tables} engine={engine} month={m} />

      {household.moneyMode === 'proportional' ? <WhoPaysWhat household={household} tables={tables} engine={engine} month={m} /> : <PerPerson household={household} tables={tables} engine={engine} month={m} />}

      <Card className={cardBar(HUES.transfer)}>
        <CardHeader>
          <CardTitle>Transfers to make</CardTitle>
          <CardDescription>Money that leaves the main account this month on purpose. Tick when transferred.</CardDescription>
        </CardHeader>
        <CardContent className="divide-y">
          {transfers.length === 0 && <p className="py-2 text-sm text-muted-foreground">Nothing to transfer.</p>}
          {transfers.map(({ row, cell }) => (
            <div key={row.id} className="flex items-center gap-3 py-2 text-sm">
              {cell.source === 'derived' ? (
                <Badge variant="outline" className="w-24 justify-center">automatic</Badge>
              ) : (
                <Check label="" aria-label={`${row.name} transferred`} className="w-24" checked={cell.status === 'done'} disabled={t.closed} onChange={(e) => act(() => setCellDone(store, row.id, m, e.target.checked))} />
              )}
              <span className="flex-1">{row.name}{row.accountId && <span className="text-muted-foreground"> → {accountName(row.accountId)}</span>}</span>
              <span className={`tabular-nums ${cell.value < 0 ? 'text-draw' : ''}`}>{formatAmount(Math.abs(cell.value), ccy, locale)}{cell.value < 0 ? ' back' : ''}</span>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card className={cardBar(HUES.expense)}>
        <CardHeader>
          <CardTitle>Payments due</CardTitle>
          <CardDescription>Recurring items that fall in {formatMonth(m, locale)}.</CardDescription>
        </CardHeader>
        <CardContent className="divide-y">
          {due.length === 0 && <p className="py-2 text-sm text-muted-foreground">Nothing due.</p>}
          {due.map((d) => {
            const status = recurringStatus(tables, d, m)
            return (
              <div key={d.id} className="flex items-center gap-3 py-2 text-sm">
                <Check label="" aria-label={`${d.name} paid`} className="w-24" checked={status === 'paid'} disabled={t.closed} onChange={(e) => act(() => setRecurringPaid(store, d.id, m, e.target.checked))} />
                <span className="flex-1">{d.name}{d.accountId && <span className="text-muted-foreground"> · {accountName(d.accountId)}</span>}</span>
                <span className="tabular-nums">{formatAmount(d.amount, d.currency ?? ccy, locale)}</span>
              </div>
            )
          })}
        </CardContent>
      </Card>

      <div className="flex justify-end">
        {t.closed ? (
          <Button variant="outline" onClick={() => act(() => reopenMonth(store, m))}>Reopen {formatMonth(m, locale)}</Button>
        ) : (
          <Button onClick={() => act(() => closeMonth(store, m))}>Close {formatMonth(m, locale)}</Button>
        )}
      </div>
    </div>
  )
}

/** Proportional mode: every line split between the adults, then what each adult sends where. */
function WhoPaysWhat({ household, tables, engine, month }: { household: Household; tables: Tables; engine: EngineOutput; month: MonthKey }) {
  const { locale, baseCurrency: ccy } = household
  const c = useMemo(() => computeContributions(tables, engine, month), [tables, engine, month])
  const accountName = (id: string) => (id ? tables.accounts.find((a) => a.id === id)?.name ?? '' : 'Shared payments')
  const destinations = [...new Set(c.lines.map((l) => l.destinationAccountId ?? ''))]
  if (c.adults.length === 0) return null
  return (
    <Card>
      <CardHeader>
        <CardTitle>Who pays what</CardTitle>
        <CardDescription>
          Shared lines are split {c.adults.map((a) => `${a.name} ${formatPercent(a.share, locale)}`).join(' / ')}. Own lines and lines for someone they pay for go to one person in full.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted-foreground">
              <tr><th className="py-1 font-medium">Line</th><th className="py-1 text-right font-medium">Total</th>{c.adults.map((a) => <th key={a.entityId} className="py-1 text-right font-medium">{a.name}</th>)}</tr>
            </thead>
            <tbody className="divide-y">
              {c.lines.map((l) => (
                <tr key={l.rowId}>
                  <td className="py-1">{l.name}{l.routing !== 'shared' && <span className="ml-1 text-xs text-muted-foreground">{l.routing === 'own' ? 'own' : 'pays for'}</span>}</td>
                  <td className="py-1 text-right tabular-nums">{formatAmount(l.total, ccy, locale)}</td>
                  {c.adults.map((a) => <td key={a.entityId} className="py-1 text-right tabular-nums">{l.byAdult[a.entityId] ? formatAmount(l.byAdult[a.entityId], ccy, locale) : ''}</td>)}
                </tr>
              ))}
              <tr className="font-medium"><td className="py-1">Pays this month</td><td className="py-1 text-right tabular-nums">{formatAmount(c.lines.reduce((s, l) => s + l.total, 0), ccy, locale)}</td>{c.adults.map((a) => <td key={a.entityId} className="py-1 text-right tabular-nums">{formatAmount(a.owed, ccy, locale)}</td>)}</tr>
              <tr><td className="py-1 text-muted-foreground">Income</td><td /> {c.adults.map((a) => <td key={a.entityId} className="py-1 text-right tabular-nums">{formatAmount(a.income, ccy, locale)}</td>)}</tr>
              <tr className="font-medium"><td className="py-1">Keeps</td><td />{c.adults.map((a) => <td key={a.entityId} className={`py-1 text-right tabular-nums ${a.remainder < 0 ? 'text-destructive' : ''}`}>{formatAmount(a.remainder, ccy, locale, { sign: 'exceptZero' })}</td>)}</tr>
            </tbody>
          </table>
        </div>
        <div>
          <p className="mb-1 text-sm font-medium">Transfers per person</p>
          <table className="w-full text-sm">
            <tbody className="divide-y">
              {destinations.map((d) => (
                <tr key={d || 'none'}>
                  <td className="py-1">→ {accountName(d)}</td>
                  {c.adults.map((a) => <td key={a.entityId} className="py-1 text-right tabular-nums">{a.owedByDestination[d] ? formatAmount(a.owedByDestination[d], ccy, locale) : ''}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  )
}

/** Pooled mode: what each adult brings, spends on themselves, takes as pocket money, and leaves for the household. */
function PerPerson({ household, tables, engine, month }: { household: Household; tables: Tables; engine: EngineOutput; month: MonthKey }) {
  const { locale, baseCurrency: ccy } = household
  const people = useMemo(() => computePersonBudgets(tables, engine, month), [tables, engine, month])
  if (people.length < 2) return null
  return (
    <Card>
      <CardHeader>
        <CardTitle>Per person</CardTitle>
        <CardDescription>Income minus own spending minus pocket money: what each adult leaves for the household this month.</CardDescription>
      </CardHeader>
      <CardContent>
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-muted-foreground">
            <tr><th className="py-1 font-medium" />{people.map((p) => <th key={p.entityId} className="py-1 text-right font-medium">{p.name}</th>)}</tr>
          </thead>
          <tbody className="divide-y">
            <tr><td className="py-1">Income</td>{people.map((p) => <td key={p.entityId} className="py-1 text-right tabular-nums">{formatAmount(p.income, ccy, locale)}</td>)}</tr>
            <tr><td className="py-1">Own spending</td>{people.map((p) => <td key={p.entityId} className="py-1 text-right tabular-nums">{formatAmount(p.ownSpend, ccy, locale)}</td>)}</tr>
            <tr><td className="py-1">Pocket money</td>{people.map((p) => <td key={p.entityId} className="py-1 text-right tabular-nums">{formatAmount(p.pocket, ccy, locale)}</td>)}</tr>
            <tr className="font-medium"><td className="py-1">Leaves for the household</td>{people.map((p) => <td key={p.entityId} className={`py-1 text-right tabular-nums ${p.contribution < 0 ? 'text-destructive' : ''}`}>{formatAmount(p.contribution, ccy, locale, { sign: 'exceptZero' })}</td>)}</tr>
          </tbody>
        </table>
      </CardContent>
    </Card>
  )
}

function Stat({ label, value, hue }: { label: string; value: string; hue?: Hue }) {
  return (
    <div>
      <div className={hue ? `text-xs ${hue.text}` : 'text-xs text-muted-foreground'}>{label}</div>
      <div className="tabular-nums">{value}</div>
    </div>
  )
}
