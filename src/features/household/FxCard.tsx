import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Chip } from '@/components/ui/chip'
import { Input } from '@/components/ui/input'
import { Island } from '@/components/ui/island'
import { Label } from '@/components/ui/label'
import { InfoTip } from '@/components/InfoTip'
import { NativeSelect } from '@/components/NativeSelect'
import { formatMonth } from '@/app/format'
import { useStore } from '@/app/store'
import { TREND_CHANGES, historyMonths, householdFx, rateInfo, trendFor } from '@/engine'
import { monthOfDate, type FxMonthRate, type Household, type MonthKey, type Tables } from '@/model'
import { fetchRatesFor, neededPairs, setFxSettings, setManualRate, setPairForecast } from '@/store'
import { TAG_TONE, formatRate, rateTag, readableRate, toStored } from './fxDisplay'

/**
 * The rates table (DESIGN.md §8): one column per pair the household needs, one row per planned month. Each column is a
 * price the way people say it, "1 EUR in USD" or "1 USD in TRY", whichever side is above one; the stored pair stays
 * base/foreign. Past months can come from the ECB, months to come are a forecast, any month can be typed over.
 * "Months to come" says per currency how the forecast runs (rule X12): its trend, fading out; the last rate held; or
 * a change per month of the household's own.
 */
type ForecastMode = 'trend' | 'hold' | 'own'
const percentText = (fraction: number) => String(Math.round(fraction * 10000) / 100)

export function FxCard({ household, tables, months, onError }: { household: Household; tables: Tables; months: MonthKey[]; onError: (m: string) => void }) {
  const store = useStore()
  const base = household.baseCurrency
  const { locale } = household
  const pairs = neededPairs(tables)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  /** "My own change per month" was chosen for a pair and no number is saved for it yet. */
  const [ownOpen, setOwnOpen] = useState<Record<string, boolean>>({})
  /** What is typed into a pair's % field, until it is saved. */
  const [ownText, setOwnText] = useState<Record<string, string>>({})
  const fx = useMemo(() => householdFx(tables.fxRates, household), [tables.fxRates, household])
  const stored = useMemo(() => new Map(tables.fxRates.map((r) => [`${r.pair}|${r.month}`, r])), [tables.fxRates])
  const forecasts = pairs.map((p) => {
    const own = household.fxPairDrift?.[p] ?? null
    const mode: ForecastMode = ownOpen[p] ? 'own' : own == null ? 'trend' : own === 0 ? 'hold' : 'own'
    return { pair: p, code: p.split('/')[1], own, mode, trend: trendFor(fx, p), enough: historyMonths(fx, p) > TREND_CHANGES }
  })
  /** A column's orientation is fixed by today's rate, so it cannot flip from one month to the next. */
  const orient = (p: string) => {
    const [b, f] = p.split('/')
    return readableRate(b, f, rateInfo(fx, b, f, monthOfDate())?.rate ?? 1, locale)
  }
  const pct = (d: number) => `${d > 0 ? '+' : ''}${(d * 100).toFixed(2)}%`
  const act = (fn: () => Promise<unknown>) => void fn().catch((e) => onError(e instanceof Error ? e.message : 'Action failed'))
  const pickForecast = (pair: string, mode: ForecastMode) => {
    setOwnOpen((o) => ({ ...o, [pair]: mode === 'own' }))
    // "My own change" is saved with its number; the two others are whole as they are
    if (mode !== 'own') act(() => setPairForecast(store, pair, mode === 'hold' ? 0 : null))
  }
  const saveOwn = (pair: string, text: string) => {
    if (text.trim() === '') return
    const v = Number(text.replace(',', '.'))
    if (!Number.isFinite(v)) return onError('The change per month is not a number.')
    // nothing a month is "Hold the last rate"
    setOwnOpen((o) => ({ ...o, [pair]: false }))
    setOwnText((t) => ({ ...t, [pair]: '' }))
    act(() => setPairForecast(store, pair, v / 100))
  }

  async function fetchNow() {
    setBusy(true)
    setNote(null)
    try {
      const res = await fetchRatesFor(store, pairs.map((p) => p.split('/')[1]))
      setNote(`Stored ${res.written} month rate${res.written === 1 ? '' : 's'} from the ECB.${res.unsupported.length ? ` Not published by the ECB: ${res.unsupported.join(', ')}; enter those by hand.` : ''}`)
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
        : `Each column is a price the way you would say it: 1 ${base} in another currency, or 1 of it in ${base}, whichever side is above one. Past months can come from the European Central Bank, taken on the day the Month rate setting picks; months to come are a forecast, set per currency under Months to come. Type a rate to override any month.`}
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
            <div role="group" aria-labelledby="fx-forecast" className="space-y-1.5 sm:col-span-2">
              <p id="fx-forecast" className="flex items-center gap-1 text-sm font-medium leading-none">Months to come <InfoTip help="household.fxForecast" /></p>
              {forecasts.map((f) => (
                <div key={f.pair} className="flex flex-wrap items-center gap-2" data-testid={`forecast-${f.code}`}>
                  <span className="w-9 font-medium">{f.code}</span>
                  <NativeSelect aria-label={`Months to come for ${f.code}`} className="w-56" value={f.mode} onChange={(e) => pickForecast(f.pair, e.target.value as ForecastMode)}>
                    <option value="trend">Follow the recent trend</option>
                    <option value="hold">Hold the last rate</option>
                    <option value="own">My own change per month</option>
                  </NativeSelect>
                  {f.mode === 'own' && (
                    <>
                      <Input
                        aria-label={`Change per month for ${f.code} in %`} className="h-7 w-20 text-right tabular-nums" inputMode="decimal" placeholder="1.5"
                        value={ownText[f.pair] || (f.own ? percentText(f.own) : '')}
                        onChange={(e) => setOwnText((t) => ({ ...t, [f.pair]: e.target.value }))}
                        onBlur={(e) => saveOwn(f.pair, e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur() }}
                      />
                      <span>% a month</span>
                    </>
                  )}
                  <span className="text-muted-foreground">
                    {f.mode === 'own' ? 'Every month to come moves by this, without fading.'
                      : f.mode === 'hold' ? 'Every month to come uses the last official rate.'
                        : f.enough ? `${pct(f.trend)} a month on average over the last 12 months; the change fades out.`
                          : 'Less than a year of rates: the last rate is held until there is a year.'}
                  </span>
                </div>
              ))}
            </div>
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
