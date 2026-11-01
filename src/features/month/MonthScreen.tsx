import { useMemo, useState } from 'react'
import { Check, ChevronLeft, ChevronRight, Lock } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import { formatAmount, formatMonth } from '@/app/format'
import { useStore } from '@/app/store'
import { activeHousehold, defaultMonths, useEngine, useTables } from '@/app/useEngine'
import { cellKey } from '@/engine'
import { monthOfDate, type MonthKey, type Section } from '@/model'
import { closeMonth, reopenMonth } from '@/store'
import { CellEditor } from '@/features/grid/CellEditor'
import { amountDisplay, flowOf, statusClass, toneClass } from '@/features/grid/display'

const SECTIONS: Array<{ key: Section; title: string }> = [
  { key: 'income', title: 'Income' },
  { key: 'expense', title: 'Expenses' },
  { key: 'transfer', title: 'Transfers' },
]

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
      <div className="flex items-center justify-between gap-2">
        <Button variant="outline" size="icon" aria-label="Previous month" disabled={idx === 0} onClick={() => setMonth(months[idx - 1])}><ChevronLeft /></Button>
        <div className="text-center">
          <h2 className="text-lg font-semibold">{formatMonth(m, locale, 'long')}</h2>
          {t?.closed && <Badge variant="secondary"><Lock className="size-3" /> Closed</Badge>}
        </div>
        <Button variant="outline" size="icon" aria-label="Next month" disabled={idx >= months.length - 1} onClick={() => setMonth(months[idx + 1])}><ChevronRight /></Button>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <Card>
        <CardContent className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
          <Stat label="Income" value={formatAmount(t.income, ccy, locale)} />
          <Stat label="Expenses" value={formatAmount(t.expensesTotal, ccy, locale)} tone="out" />
          <Stat label="To savings" value={formatAmount(t.toSavings, ccy, locale, { sign: 'exceptZero' })} tone={t.toSavings < 0 ? 'draw' : 'neutral'} />
          <Stat label={household.closingRule === 'savings-plug' ? 'Kept in account' : 'Leftover'} value={formatAmount(t.leftover, ccy, locale)} />
          {Object.values(engine.accounts).map((s) => (
            <Stat key={s.accountId} label={tables.accounts.find((a) => a.id === s.accountId)?.name ?? 'Account'} value={formatAmount(s.months[m]?.balance ?? 0, s.currency, locale)} />
          ))}
          {Object.values(engine.pools).map((p) => (
            <Stat key={p.poolId} label={`Pool · ${tables.pools.find((x) => x.id === p.poolId)?.name ?? ''}`} value={formatAmount(p.months[m]?.balance ?? 0, ccy, locale)} />
          ))}
        </CardContent>
      </Card>

      {SECTIONS.map(({ key, title }) => {
        const rows = engine.rows.filter((r) => r.section === key)
        if (rows.length === 0) return null
        return (
          <section key={key} className="space-y-1">
            <h3 className="px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h3>
            <div className="divide-y rounded-lg border">
              {rows.map((r) => {
                const c = engine.cells[cellKey(r.id, m)]
                if (!c || c.source === 'archived') return null
                const d = amountDisplay(c.value, flowOf(r), r.currency ?? ccy, locale, neg)
                const derived = c.source === 'derived'
                return (
                  <button
                    key={r.id} type="button" disabled={derived}
                    className={cn('flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm', !derived && 'hover:bg-accent', derived && 'bg-muted/40')}
                    onClick={() => setSelectedRow(r.id)}
                    aria-label={`${r.name}: ${d.text}`}
                  >
                    <span className="truncate">{r.name}</span>
                    <span className={cn('flex items-center gap-1 tabular-nums', toneClass[d.tone], c.source === 'empty' ? 'text-muted-foreground/40' : statusClass[c.status])}>
                      {c.status === 'done' && c.source !== 'empty' && <Check className="size-3 text-muted-foreground" />}
                      {c.source === 'empty' ? '·' : d.text}
                    </span>
                  </button>
                )
              })}
            </div>
          </section>
        )
      })}

      <div className="flex justify-end">
        {t.closed ? (
          <Button variant="outline" onClick={() => act(() => reopenMonth(store, m))}>Reopen {formatMonth(m, locale)}</Button>
        ) : (
          <Button onClick={() => act(() => closeMonth(store, m))}>Close {formatMonth(m, locale)}</Button>
        )}
      </div>

      {row && <CellEditor key={`${row.id}:${m}`} tables={tables} engine={engine} household={household} row={row} month={m} onClose={() => setSelectedRow(null)} />}
    </div>
  )
}

function Stat({ label, value, tone = 'neutral' }: { label: string; value: string; tone?: 'neutral' | 'out' | 'draw' }) {
  return (
    <>
      <span className="text-muted-foreground">{label}</span>
      <span className={cn('text-right tabular-nums', tone === 'out' && 'text-red-700 dark:text-red-400', tone === 'draw' && 'text-amber-700 dark:text-amber-400')}>{value}</span>
    </>
  )
}
