import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Island } from '@/components/ui/island'
import { Label } from '@/components/ui/label'
import { NativeSelect } from '@/components/NativeSelect'
import { formatAmount, formatMonth, formatPercent } from '@/app/format'
import { useStore } from '@/app/store'
import { computeContributions, type EngineOutput } from '@/engine'
import { monthOfDate, type Household, type Tables } from '@/model'
import { updateHousehold } from '@/store'
import { BASIS_HELP } from '@/app/help'
import { TipLabel } from '@/components/InfoTip'

export function SharesCard({ household, tables, engine, onError }: { household: Household; tables: Tables; engine: EngineOutput | null; onError: (m: string) => void }) {
  const store = useStore()
  const m = monthOfDate()
  const month = engine?.months.includes(m) ? m : engine?.months[engine.months.length - 1]
  const c = useMemo(() => (engine && month ? computeContributions(tables, engine, month) : null), [tables, engine, month])
  const [manual, setManual] = useState<Record<string, string>>(() => Object.fromEntries(Object.entries(household.manualShares ?? {}).map(([k, v]) => [k, String(Math.round(v * 1000) / 10)])))
  const act = (fn: () => Promise<unknown>) => void fn().catch((e) => onError(e instanceof Error ? e.message : 'Action failed'))
  const { locale, baseCurrency: ccy } = household

  function saveManual() {
    const shares: Record<string, number> = {}
    for (const a of c?.adults ?? []) {
      const v = Number((manual[a.entityId] ?? '').replace(',', '.'))
      if (!Number.isFinite(v) || v < 0) return onError(`${a.name}: the share is not a number.`)
      shares[a.entityId] = v / 100
    }
    act(() => updateHousehold(store, { manualShares: shares }))
  }

  return (
    <Island
      air title="Who pays what"
      description="Shared costs are split between the adults by their share. A row that belongs to one person is theirs alone; a child's or pet's rows go to whoever pays for them. The Moves screen shows the resulting transfers every month."
    >
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <TipLabel htmlFor="sh-basis" help="household.shareBasis">Shares come from</TipLabel>
            <NativeSelect id="sh-basis" className="w-full" value={household.shareBasis} onChange={(e) => act(() => updateHousehold(store, { shareBasis: e.target.value as Household['shareBasis'] }))}>
              <option value="basis-rows">Salaries</option>
              <option value="all-income">All income</option>
              <option value="manual">Percentages I set</option>
            </NativeSelect>
            <p className="text-muted-foreground">{BASIS_HELP[household.shareBasis]}</p>
          </div>
          {household.shareBasis === 'manual' && c && (
            <div className="space-y-1.5">
              <Label>Shares (%)</Label>
              <div className="flex flex-wrap items-center gap-2">
                {c.adults.map((a) => (
                  <label key={a.entityId} className="flex items-center gap-1">
                    <span>{a.name}</span>
                    <Input aria-label={`${a.name} share %`} className="h-7 w-20 text-right" inputMode="decimal" value={manual[a.entityId] ?? ''} onChange={(e) => setManual((s) => ({ ...s, [a.entityId]: e.target.value }))} />
                  </label>
                ))}
                <Button size="xs" variant="outline" onClick={saveManual}>Apply</Button>
              </div>
              <p className="text-muted-foreground">They are scaled to add up to 100.</p>
            </div>
          )}
        </div>
        {c && month && (
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full">
              <thead className="bg-muted/50 text-left text-muted-foreground">
                <tr><th className="px-2 py-1 font-semibold">{formatMonth(month, locale)}</th>{c.adults.map((a) => <th key={a.entityId} className="px-2 py-1 text-right font-semibold">{a.name}</th>)}</tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                <tr><td className="px-2 py-1">Share</td>{c.adults.map((a) => <td key={a.entityId} className="px-2 py-1 text-right tabular-nums">{formatPercent(a.share, locale)}</td>)}</tr>
                <tr><td className="px-2 py-1">Income</td>{c.adults.map((a) => <td key={a.entityId} className="px-2 py-1 text-right tabular-nums">{formatAmount(a.income, ccy, locale)}</td>)}</tr>
                <tr><td className="px-2 py-1">Pays this month</td>{c.adults.map((a) => <td key={a.entityId} className="px-2 py-1 text-right tabular-nums">{formatAmount(a.owed, ccy, locale)}</td>)}</tr>
                <tr className="font-medium"><td className="px-2 py-1">Keeps</td>{c.adults.map((a) => <td key={a.entityId} className={`px-2 py-1 text-right tabular-nums ${a.remainder < 0 ? 'text-destructive' : ''}`}>{formatAmount(a.remainder, ccy, locale, { sign: 'exceptZero' })}</td>)}</tr>
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Island>
  )
}
