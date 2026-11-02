import { useMemo, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { NativeSelect } from '@/features/grid/NativeSelect'
import { formatMonth } from '@/app/format'
import { useStore } from '@/app/store'
import { buildFxIndex, driftFor, rateInfo } from '@/engine'
import { addMonths, compareMonths, monthOfDate, type FxMonthRate, type Household, type MonthKey, type Tables } from '@/model'
import { fetchEcbRates, neededPairs, setFxSettings, setManualRate } from '@/store'

export function FxCard({ household, tables, months, onError }: { household: Household; tables: Tables; months: MonthKey[]; onError: (m: string) => void }) {
  const store = useStore()
  const pairs = neededPairs(tables)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const [drift, setDrift] = useState(String(Math.round((household.fxDriftDefault ?? 0) * 10000) / 100))
  const driftMode = household.fxDriftMode ?? 'fixed'
  const fx = useMemo(
    () => buildFxIndex(tables.fxRates, { driftMode, fixedDrift: household.fxDriftDefault ?? 0, pairDrift: household.fxPairDrift ?? {} }),
    [tables.fxRates, driftMode, household.fxDriftDefault, household.fxPairDrift],
  )
  const stored = useMemo(() => new Map(tables.fxRates.map((r) => [`${r.pair}|${r.month}`, r])), [tables.fxRates])
  // what the known history says about the monthly change, per pair
  const history = useMemo(() => buildFxIndex(tables.fxRates, { driftMode: 'average' }), [tables.fxRates])
  const suggestions = pairs.map((p) => ({ pair: p, known: history.pairs.get(p)?.length ?? 0, drift: driftFor(history, p), override: household.fxPairDrift?.[p] }))
  const pct = (d: number) => `${d > 0 ? '+' : ''}${(d * 100).toFixed(2)}%`
  const setPairDrift = (pair: string, value: number | null) => {
    const next = { ...(household.fxPairDrift ?? {}) }
    if (value == null) delete next[pair]
    else next[pair] = value
    act(() => setFxSettings(store, { fxPairDrift: next }))
  }
  const act = (fn: () => Promise<unknown>) => void fn().catch((e) => onError(e instanceof Error ? e.message : 'Action failed'))

  async function fetchNow() {
    setBusy(true)
    setNote(null)
    try {
      // a year before the first month too, so the average change has something to work with
      const yearAgo = addMonths(monthOfDate(), -13)
      const from = compareMonths(yearAgo, household.startMonth) < 0 ? yearAgo : household.startMonth
      const res = await fetchEcbRates(store, { base: household.baseCurrency, symbols: pairs.map((p) => p.split('/')[1]), from, to: monthOfDate(), policy: household.fxMonthRate })
      setNote(`Stored ${res.written} month rate${res.written === 1 ? '' : 's'} from the ECB.${res.unsupported.length ? ` Not published by the ECB: ${res.unsupported.join(', ')}; enter those by hand.` : ''} The average change per month is shown under the drift setting.`)
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Could not fetch rates')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Currency rates</CardTitle>
        <CardDescription>
          {pairs.length === 0
            ? `Everything is in ${household.baseCurrency}; nothing to convert. Give a row or account another currency and the rates appear here.`
            : `How many units of the other currency one ${household.baseCurrency} buys, per month. Past months can come from the European Central Bank; future months are projected with the drift below. Type a rate to override any month.`}
        </CardDescription>
      </CardHeader>
      {pairs.length > 0 && (
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="fx-policy">Month rate</Label>
              <NativeSelect id="fx-policy" className="w-full" value={household.fxMonthRate} onChange={(e) => act(() => setFxSettings(store, { fxMonthRate: e.target.value as FxMonthRate }))}>
                <option value="last">Last day of the month</option>
                <option value="first">First day of the month</option>
                <option value="average">Average over the month</option>
              </NativeSelect>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="fx-mode">Future months</Label>
              <NativeSelect id="fx-mode" className="w-full" value={driftMode} onChange={(e) => act(() => setFxSettings(store, { fxDriftMode: e.target.value as 'fixed' | 'average' }))}>
                <option value="fixed">Change by a fixed % each month</option>
                <option value="average">Repeat the average change of the last year</option>
              </NativeSelect>
            </div>
            {driftMode === 'fixed' && (
              <div className="space-y-1.5">
                <Label htmlFor="fx-drift">Change per month (%)</Label>
                <Input
                  id="fx-drift" inputMode="decimal" value={drift} onChange={(e) => setDrift(e.target.value)}
                  onBlur={() => { const v = Number(drift.replace(',', '.')); if (Number.isFinite(v)) act(() => setFxSettings(store, { fxDriftDefault: v / 100 })); else onError('Drift is not a number.') }}
                />
                <p className="text-xs text-muted-foreground">1.5 means the rate rises 1.5% every month after the last known one. 0 keeps it flat.</p>
              </div>
            )}
            {driftMode === 'fixed' && (
              <div className="space-y-1 text-xs sm:col-span-3">
                {suggestions.map((s) => (
                  <div key={s.pair} className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{s.pair}</span>
                    {s.known >= 2 ? (
                      <span className="text-muted-foreground">ECB history, {s.known} months: {pct(s.drift)} per month on average</span>
                    ) : (
                      <span className="text-muted-foreground">fetch ECB rates to get a suggestion from the last year</span>
                    )}
                    {s.override != null ? (
                      <>
                        <Badge variant="secondary">using {pct(s.override)}</Badge>
                        <Button size="xs" variant="ghost" onClick={() => setPairDrift(s.pair, null)}>Back to the default</Button>
                      </>
                    ) : (
                      s.known >= 2 && <Button size="xs" variant="outline" onClick={() => setPairDrift(s.pair, s.drift)}>Use for {s.pair}</Button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button size="sm" variant="outline" onClick={() => void fetchNow()} disabled={busy}>{busy ? 'Fetching…' : 'Fetch ECB rates'}</Button>
            <span className="text-xs text-muted-foreground">Only currency codes and dates are sent to the rate service (frankfurter.dev, ECB data). Nothing about your household.</span>
          </div>
          {note && <p className="text-sm" role="status">{note}</p>}
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
                <tr><th className="px-3 py-2 font-medium">Month</th>{pairs.map((p) => <th key={p} className="px-3 py-2 font-medium">{p}</th>)}</tr>
              </thead>
              <tbody className="divide-y">
                {months.map((m) => (
                  <tr key={m}>
                    <td className="px-3 py-1.5 whitespace-nowrap">{formatMonth(m, household.locale)}</td>
                    {pairs.map((p) => {
                      const [from, to] = p.split('/')
                      const rec = stored.get(`${p}|${m}`)
                      const info = rateInfo(fx, from, to, m)
                      const tag = rec?.source === 'manual' ? 'manual' : rec?.source === 'api' ? 'ECB' : info ? (info.projected ? 'projected' : 'carried') : 'missing'
                      return (
                        <td key={p} className="px-3 py-1">
                          <div className="flex items-center gap-2">
                            <Input
                              key={`${p}|${m}|${rec?.rate ?? ''}|${rec?.source ?? ''}`}
                              aria-label={`${p} rate for ${formatMonth(m, household.locale)}`}
                              className="h-7 w-28 text-right tabular-nums" inputMode="decimal"
                              defaultValue={rec ? String(rec.rate) : ''}
                              placeholder={info ? info.rate.toFixed(4) : '—'}
                              onBlur={(e) => {
                                const t = e.target.value.trim()
                                if (t === '') { if (rec) act(() => setManualRate(store, p, m, null)); return }
                                const v = Number(t.replace(',', '.'))
                                if (!(v > 0)) { onError('A rate must be a positive number.'); return }
                                if (rec?.source === 'manual' && rec.rate === v) return
                                act(() => setManualRate(store, p, m, v))
                              }}
                            />
                            <Badge variant={tag === 'manual' ? 'default' : tag === 'ECB' ? 'secondary' : 'outline'} className="text-[10px]">{tag}</Badge>
                          </div>
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      )}
    </Card>
  )
}
