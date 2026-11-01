import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { NativeSelect } from '@/features/grid/NativeSelect'
import { formatAmount, formatMonth, formatPercent } from '@/app/format'
import { useStore } from '@/app/store'
import { computeContributions, type EngineOutput } from '@/engine'
import { monthOfDate, type Household, type Tables } from '@/model'
import { updateHousehold } from '@/store'

const BASIS_HELP: Record<Household['shareBasis'], string> = {
  'basis-rows': 'Salaries only. Rows marked "counts for the split" set each adult\'s share; child benefit and one-off income do not.',
  'all-income': 'Everything each adult brings in, including income for the children they pay for.',
  manual: 'You set the percentages yourself.',
}

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
    <Card>
      <CardHeader>
        <CardTitle>Who pays what</CardTitle>
        <CardDescription>
          Shared costs are split between the adults by their share. A row that belongs to one person is theirs alone; a child's or pet's rows go to whoever pays for them. The Moves screen shows the resulting transfers every month.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="sh-basis">Shares come from</Label>
            <NativeSelect id="sh-basis" className="w-full" value={household.shareBasis} onChange={(e) => act(() => updateHousehold(store, { shareBasis: e.target.value as Household['shareBasis'] }))}>
              <option value="basis-rows">Salaries</option>
              <option value="all-income">All income</option>
              <option value="manual">Percentages I set</option>
            </NativeSelect>
            <p className="text-xs text-muted-foreground">{BASIS_HELP[household.shareBasis]}</p>
          </div>
          {household.shareBasis === 'manual' && c && (
            <div className="space-y-1.5">
              <Label>Shares (%)</Label>
              <div className="flex flex-wrap items-center gap-2">
                {c.adults.map((a) => (
                  <label key={a.entityId} className="flex items-center gap-1 text-sm">
                    <span>{a.name}</span>
                    <Input aria-label={`${a.name} share %`} className="h-8 w-20 text-right" inputMode="decimal" value={manual[a.entityId] ?? ''} onChange={(e) => setManual((s) => ({ ...s, [a.entityId]: e.target.value }))} />
                  </label>
                ))}
                <Button size="sm" variant="outline" onClick={saveManual}>Apply</Button>
              </div>
              <p className="text-xs text-muted-foreground">They are scaled to add up to 100.</p>
            </div>
          )}
        </div>
        {c && month && (
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
                <tr><th className="px-3 py-2 font-medium">{formatMonth(month, locale)}</th>{c.adults.map((a) => <th key={a.entityId} className="px-3 py-2 text-right font-medium">{a.name}</th>)}</tr>
              </thead>
              <tbody className="divide-y">
                <tr><td className="px-3 py-1.5">Share</td>{c.adults.map((a) => <td key={a.entityId} className="px-3 py-1.5 text-right tabular-nums">{formatPercent(a.share, locale)}</td>)}</tr>
                <tr><td className="px-3 py-1.5">Income</td>{c.adults.map((a) => <td key={a.entityId} className="px-3 py-1.5 text-right tabular-nums">{formatAmount(a.income, ccy, locale)}</td>)}</tr>
                <tr><td className="px-3 py-1.5">Pays this month</td>{c.adults.map((a) => <td key={a.entityId} className="px-3 py-1.5 text-right tabular-nums">{formatAmount(a.owed, ccy, locale)}</td>)}</tr>
                <tr className="font-medium"><td className="px-3 py-1.5">Keeps</td>{c.adults.map((a) => <td key={a.entityId} className={`px-3 py-1.5 text-right tabular-nums ${a.remainder < 0 ? 'text-destructive' : ''}`}>{formatAmount(a.remainder, ccy, locale, { sign: 'exceptZero' })}</td>)}</tr>
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
