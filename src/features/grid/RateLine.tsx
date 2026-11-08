import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Chip } from '@/components/ui/chip'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { InfoTip } from '@/components/InfoTip'
import { formatAmount, formatMonth } from '@/app/format'
import { useStore } from '@/app/store'
import { buildFxIndex, convertMoney, rateInfo } from '@/engine'
import type { Household, Money, MonthKey, Tables } from '@/model'
import { restoreEcbRate, setManualRate } from '@/store'
import { TAG_TONE, formatDay, formatRate, rateTag, readableRate, toStored } from '@/features/household/fxDisplay'

/**
 * Under an amount typed in another currency (DESIGN.md §8): what it is in the household currency, at which rate and from
 * where, with the chip tones of the rates table. "Change this month's rate…" sets one rate per currency per month by hand;
 * "Use the ECB rate again" drops it and fetches that month afresh.
 */
export function RateLine({ tables, household, month, currency, amount }: { tables: Tables; household: Household; month: MonthKey; currency: string; amount: Money }) {
  const store = useStore()
  const base = household.baseCurrency
  const { locale } = household
  const pair = `${base}/${currency}`
  const fx = useMemo(
    () => buildFxIndex(tables.fxRates, { driftMode: household.fxDriftMode ?? 'fixed', fixedDrift: household.fxDriftDefault ?? 0, pairDrift: household.fxPairDrift ?? {}, base }),
    [tables.fxRates, household.fxDriftMode, household.fxDriftDefault, household.fxPairDrift, base],
  )
  const info = rateInfo(fx, base, currency, month)
  const rec = tables.fxRates.find((r) => r.pair === pair && r.month === month)
  const tag = rateTag(rec, info)
  const readable = readableRate(base, currency, info?.rate ?? 1, locale)
  const inBase = info ? convertMoney(fx, amount, currency, base, month).value : null
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true)
    setError(null)
    try {
      await fn()
      setEditing(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not change the rate.')
    } finally {
      setBusy(false)
    }
  }
  const saveRate = () => {
    const v = Number(text.replace(',', '.'))
    if (!(v > 0)) return setError('A rate must be a positive number.')
    void run(() => setManualRate(store, pair, month, toStored(readable, base, v)))
  }

  return (
    <div className="space-y-1 text-xs text-muted-foreground" data-testid="rate-line">
      <p className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 tabular-nums">
        {info && inBase != null
          ? <><span>≈ {formatAmount(inBase, base, locale)}</span><span aria-hidden>·</span><span>{readable.text}</span><span aria-hidden>·</span></>
          : <span>No {currency} rate for {formatMonth(month, locale)} yet.</span>}
        <Chip tone={TAG_TONE[tag]}>{tag}</Chip>
        {rec?.date && <span>{formatDay(rec.date, locale)}</span>}
        <InfoTip help="cell.rate" />
        {!editing && <Button size="xs" variant="ghost" onClick={() => { setText(info ? formatRate(readable.rate, locale) : ''); setEditing(true) }}>Change this month's rate…</Button>}
        {!editing && tag === 'manual' && <Button size="xs" variant="ghost" disabled={busy} onClick={() => void run(() => restoreEcbRate(store, pair, month))}>Use the ECB rate again</Button>}
      </p>
      {editing && (
        <div className="flex flex-wrap items-center gap-2">
          <Label htmlFor="cell-rate">1 {readable.from} =</Label>
          <Input id="cell-rate" className="h-7 w-28 text-right tabular-nums" inputMode="decimal" autoFocus value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); saveRate() } }} />
          <span>{readable.to}</span>
          <Button size="xs" variant="outline" disabled={busy} onClick={saveRate}>Save rate</Button>
          <Button size="xs" variant="ghost" disabled={busy} onClick={() => setEditing(false)}>Cancel</Button>
          <span className="basis-full">One rate per currency per month: every {currency} row in {formatMonth(month, locale)} uses it.</span>
        </div>
      )}
      {error && <p role="alert" className="text-destructive">{error}</p>}
    </div>
  )
}
