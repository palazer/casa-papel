import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Chip } from '@/components/ui/chip'
import { Input } from '@/components/ui/input'
import { Island } from '@/components/ui/island'
import { InfoTip } from '@/components/InfoTip'
import { NativeSelect } from '@/components/NativeSelect'
import { formatMonth } from '@/app/format'
import { useStore } from '@/app/store'
import { TREND_CHANGES, historyMonths, householdFx, rateInfo, trendFor } from '@/engine'
import { monthOfDate, type Household, type MonthKey, type Tables } from '@/model'
import { neededPairs, refreshRates, restoreEcbRate, setManualRate, setPairForecast } from '@/store'
import { TAG_LABEL, TAG_TONE, formatRate, rateTag, readableRate, toStored } from './fxDisplay'
import { errorText, showSaveError } from '@/app/saveError'
import { txt } from '@/i18n'

const T = txt.household.fx

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
  /** Counts the fields that were emptied or not saved, so a field shows its stored rate again when nothing changed. */
  const [emptied, setEmptied] = useState(0)
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
  // a field whose change was not saved (Cancel at the question about the past, or refused) shows what is stored again
  const act = (fn: () => Promise<unknown>) => void fn().catch((e) => {
    setEmptied((n) => n + 1)
    showSaveError(onError, txt.common.actionFailed)(e)
  })
  const pickForecast = (pair: string, mode: ForecastMode) => {
    setOwnOpen((o) => ({ ...o, [pair]: mode === 'own' }))
    // "My own change" is saved with its number; the two others are whole as they are
    if (mode !== 'own') act(() => setPairForecast(store, pair, mode === 'hold' ? 0 : null))
  }
  const saveOwn = (pair: string, text: string) => {
    if (text.trim() === '') return
    const v = Number(text.replace(',', '.'))
    if (!Number.isFinite(v)) return onError(T.theChangePerMonth)
    // nothing a month is "Hold the last rate"
    setOwnOpen((o) => ({ ...o, [pair]: false }))
    setOwnText((t) => ({ ...t, [pair]: '' }))
    act(() => setPairForecast(store, pair, v / 100))
  }

  async function fetchNow() {
    setBusy(true)
    setNote(null)
    try {
      const res = await refreshRates(store)
      setNote(T.ratesFetched(res.written, res.unsupported.length, res.unsupported.join(', ')))
    } catch (e) {
      onError(errorText(e, T.couldNotFetchRates))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Island
      air title={T.currencyRates}
      description={pairs.length === 0
        ? T.everythingIsInNothing(base)
        : T.eachColumnIsA(base)}
    >
      {pairs.length > 0 && (
        <div className="space-y-4">
          <div>
            <div role="group" aria-labelledby="fx-forecast" className="space-y-1.5">
              <p id="fx-forecast" className="flex items-center gap-1 text-sm font-medium leading-none">{T.monthsToCome} <InfoTip help="household.fxForecast" /></p>
              {forecasts.map((f) => (
                <div key={f.pair} className="flex flex-wrap items-center gap-2" data-testid={`forecast-${f.code}`}>
                  <span className="w-9 font-medium">{f.code}</span>
                  <NativeSelect aria-label={T.monthsToComeFor(f.code)} className="w-56" value={f.mode} onChange={(e) => pickForecast(f.pair, e.target.value as ForecastMode)}>
                    <option value="trend">{T.followTheRecentTrend}</option>
                    <option value="hold">{T.holdTheLastRate}</option>
                    <option value="own">{T.myOwnChangePer}</option>
                  </NativeSelect>
                  {f.mode === 'own' && (
                    <>
                      <Input
                        aria-label={T.changePerMonthFor(f.code)} className="h-7 w-20 text-right tabular-nums" inputMode="decimal" placeholder="1.5"
                        value={ownText[f.pair] || (f.own ? percentText(f.own) : '')}
                        onChange={(e) => setOwnText((t) => ({ ...t, [f.pair]: e.target.value }))}
                        onBlur={(e) => saveOwn(f.pair, e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur() }}
                      />
                      <span>{T.aMonth}</span>
                    </>
                  )}
                  <span className="text-muted-foreground">
                    {f.mode === 'own' ? T.everyMonthToCome
                      : f.mode === 'hold' ? T.everyMonthUsesLast
                        : f.enough ? T.aMonthOnAverage(pct(f.trend))
                          : T.lessThanAYear}
                  </span>
                </div>
              ))}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button size="xs" variant="outline" onClick={() => void fetchNow()} disabled={busy}>{busy ? T.fetching : T.fetchEcbRates}</Button>
            <span className="text-muted-foreground">{T.onlyCurrencyCodesAnd}</span>
          </div>
          {note && <p role="status">{note}</p>}
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full">
              <thead className="bg-muted/50 text-left text-muted-foreground">
                <tr>
                  <th className="px-2 py-1 font-semibold">{txt.common.month}</th>
                  {pairs.map((p) => { const o = orient(p); return <th key={p} className="px-2 py-1 font-semibold">{T.oneIn(o.from, o.to)}</th> })}
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
                              key={`${p}|${m}|${rec?.rate ?? ''}|${rec?.source ?? ''}|${emptied}`}
                              aria-label={T.oneInFor(o.from, o.to, formatMonth(m, locale))}
                              className="h-6 w-28 text-right tabular-nums" inputMode="decimal"
                              defaultValue={rec ? shown(rec.rate) : ''}
                              placeholder={info ? shown(info.rate) : '—'}
                              onBlur={(e) => {
                                const t = e.target.value.trim()
                                // leaving the field as it was shown is not a change: tabbing through an ECB month must not make it manual
                                if (t === (rec ? shown(rec.rate) : '')) return
                                if (t === '') {
                                  // emptied: your rate goes and the official one comes back; an official rate has nothing to give way to
                                  if (rec?.source === 'manual') act(() => restoreEcbRate(store, p, m))
                                  setEmptied((n) => n + 1)
                                  return
                                }
                                const v = Number(t.replace(',', '.'))
                                if (!(v > 0)) { onError(T.aRateMustBe); return }
                                const value = toStored(o, base, v)
                                if (rec && Math.abs(rec.rate - value) <= rec.rate * 1e-6) return
                                act(() => setManualRate(store, p, m, value))
                              }}
                            />
                            <Chip tone={TAG_TONE[tag]}>{TAG_LABEL[tag]}</Chip>
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
