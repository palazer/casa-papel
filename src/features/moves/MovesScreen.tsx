import { useMemo, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Check } from '@/components/Check'
import { MonthPicker } from '@/components/MonthPicker'
import { formatAmount, formatMonth } from '@/app/format'
import { useStore } from '@/app/store'
import { activeHousehold, defaultMonths, useEngine, useTables } from '@/app/useEngine'
import { cellKey } from '@/engine'
import { isDue, monthOfDate, type MonthKey } from '@/model'
import { closeMonth, recurringStatus, reopenMonth, setCellDone, setRecurringPaid } from '@/store'

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
      {error && <p className="text-sm text-destructive">{error}</p>}

      <Card>
        <CardContent className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-4">
          <Stat label="Income" value={formatAmount(t.income, ccy, locale)} />
          <Stat label="Expenses" value={formatAmount(t.expensesTotal, ccy, locale)} />
          <Stat label="To savings" value={formatAmount(t.toSavings, ccy, locale, { sign: 'exceptZero' })} />
          <Stat label={openCount === 0 ? 'All moves done' : 'Moves left'} value={String(openCount)} />
        </CardContent>
      </Card>

      <Card>
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
              <span className={`tabular-nums ${cell.value < 0 ? 'text-amber-700 dark:text-amber-400' : ''}`}>{formatAmount(Math.abs(cell.value), ccy, locale)}{cell.value < 0 ? ' back' : ''}</span>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
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

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="tabular-nums">{value}</div>
    </div>
  )
}
