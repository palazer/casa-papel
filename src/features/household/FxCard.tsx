import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Chip } from '@/components/ui/chip'
import { Input } from '@/components/ui/input'
import { Island } from '@/components/ui/island'
import { Label } from '@/components/ui/label'
import { NativeSelect } from '@/features/grid/NativeSelect'
import { formatMonth } from '@/app/format'
import { useStore } from '@/app/store'
import { buildFxIndex, driftFor, rateInfo } from '@/engine'
import { addMonths, compareMonths, monthOfDate, type FxMonthRate, type Household, type MonthKey, type Tables } from '@/model'
import { fetchEcbRates, neededPairs, setFxSettings, setManualRate } from '@/store'
import { TAG_TONE, formatRate, rateTag, readableRate, toStored } from './fxDisplay'

/**
 * The rates table (DESIGN.md §8): one column per pair the household needs, one row per planned month. Each column is a
 * price the way people say it, "1 EUR in USD" or "1 USD in TRY", whichever side is above one; the stored pair stays
 * base/foreign. Past months can come from the ECB, future months are projected, any month can be typed over.
 */
export function FxCard({ household, tables, months, onError }: { household: Household; tables: Tables; months: MonthKey[]; onError: (m: string) => void }) {
  const store = useStore()
  const base = household.baseCurrency
  const { locale } = household
  const pairs = neededPairs(tables)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const [drift, setDrift] = useState(String(Math.round((household.fxDriftDefault ?? 0) * 10000) / 100))
  const driftMode = household.fxDriftMode ?? 'fixed'
  const fx = useMemo(
    () => buildFxIndex(tables.fxRates, { driftMode, fixedDrift: household.fxDriftDefault ?? 0, pairDrift: household.fxPairDrift ?? {}, base }),
    [tables.fxRates, driftMode, household.fxDriftDefault, household.fxPairDrift, base],
  )
  const stored = useMemo(() => new Map(tables.fxRates.map((r) => [`${r.pair}|${r.month}`, r])), [tables.fxRates])
  // what the known history says about the monthly change, per pair
  const history = useMemo(() => buildFxIndex(tables.fxRates, { driftMode: 'average' }), [tables.fxRates])
  const suggestions = pairs.map((p) => ({ pair: p, known: history.pairs.get(p)?.length ?? 0, drift: driftFor(history, p), override: household.fxPairDrift?.[p] }))
  /** A column's orientation is fixed by today's rate, so it cannot flip from one month to the next. */
  const orient = (p: string) => {
    const [b, f] = p.split('/')
    return readableRate(b, f, rateInfo(fx, b, f, monthOfDate())?.rate ?? 1, locale)
  }
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
      const res = await fetchEcbRates(store, { base, symbols: pairs.map((p) => p.split('/')[1]), from, to: monthOfDate(), policy: household.fxMonthRate })
      setNote(`Stored ${res.written} month rate${res.written === 1 ? '' : 's'} from the ECB.${res.unsupported.length ? ` Not published by the ECB: ${res.unsupported.join(', ')}; enter those by hand.` : ''} The average change per month is shown under the drift setting.`)
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Could not fetch rates')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Island
      air title="Currency rates"
      description={pairs.length === 0
        ? `Everything is in ${base}; nothing to convert. Give a row or account another currency and the rates appear here.`
        : `Each column is a price the way you would say it: 1 ${base} in another currency, or 1 of it in ${base}, whichever side is above one. Past months can come from the European Central Bank, taken on the day the Month rate setting picks; future months are projected with the drift below. Type a rate to override any month.`}
    >
      {pairs.length > 0 && (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="fx-policy">Month rate</Label>
              <NativeSelect id="fx-policy" className="w-full" value={household.fxMonthRate} onChange={(e) => act(() => setFxSettings(store, { fxMonthRate: e.target.value as FxMonthRate }))}>
                <option value="first">First business day of the month</option>
                <option value="last">Last business day of the month</option>
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
                <p className="text-muted-foreground">1.5 means the stored rate rises 1.5% every month after the last known one. 0 keeps it flat.</p>
              </div>
            )}
            {driftMode === 'fixed' && (
              <div className="space-y-1 sm:col-span-3">
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
                        <Chip tone="sky">using {pct(s.override)}</Chip>
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
            <Button size="xs" variant="outline" onClick={() => void fetchNow()} disabled={busy}>{busy ? 'Fetching…' : 'Fetch ECB rates'}</Button>
            <span className="text-muted-foreground">Only currency codes and dates are sent to the rate service (frankfurter.dev, ECB data). Nothing about your household.</span>
          </div>
          {note && <p role="status">{note}</p>}
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full">
              <thead className="bg-muted/50 text-left text-muted-foreground">
                <tr>
                  <th className="px-2 py-1 font-semibold">Month</th>
                  {pairs.map((p) => { const o = orient(p); return <th key={p} className="px-2 py-1 font-semibold">1 {o.from} in {o.to}</th> })}
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {months.map((m) => (
                  <tr key={m}>
                    <td className="whitespace-nowrap px-2 py-1">{formatMonth(m, locale)}</td>
                    {pairs.map((p) => {
                      const [from, to] = p.split('/')
                      const o = orient(p)
                      const shown = (baseToForeign: number) => formatRate(o.from === base ? baseToForeign : 1 / baseToForeign, locale)
                      const rec = stored.get(`${p}|${m}`)
                      const info = rateInfo(fx, from, to, m)
                      const tag = rateTag(rec, info)
                      return (
                        <td key={p} className="px-2 py-0.5">
                          <div className="flex items-center gap-2">
                            <Input
                              key={`${p}|${m}|${rec?.rate ?? ''}|${rec?.source ?? ''}`}
                              aria-label={`1 ${o.from} in ${o.to} for ${formatMonth(m, locale)}`}
                              className="h-6 w-28 text-right tabular-nums" inputMode="decimal"
                              defaultValue={rec ? shown(rec.rate) : ''}
                              placeholder={info ? shown(info.rate) : '—'}
                              onBlur={(e) => {
                                const t = e.target.value.trim()
                                // leaving the field as it was shown is not a change: tabbing through an ECB month must not make it manual
                                if (t === (rec ? shown(rec.rate) : '')) return
                                if (t === '') { act(() => setManualRate(store, p, m, null)); return }
                                const v = Number(t.replace(',', '.'))
                                if (!(v > 0)) { onError('A rate must be a positive number.'); return }
                                const value = toStored(o, base, v)
                                if (rec && Math.abs(rec.rate - value) <= rec.rate * 1e-6) return
                                act(() => setManualRate(store, p, m, value))
                              }}
                            />
                            <Chip tone={TAG_TONE[tag]}>{tag}</Chip>
                          </div>
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </Island>
  )
}
