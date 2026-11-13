import { useId, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Chip } from '@/components/ui/chip'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { InfoTip } from '@/components/InfoTip'
import { formatAmount, formatMonth } from '@/app/format'
import { convertMoney } from '@/engine'
import type { Household, Money, MonthKey, Tables } from '@/model'
import { TAG_TONE, formatDay, formatRate } from '@/features/household/fxDisplay'
import { useMonthRate } from './useMonthRate'

/**
 * Under an amount typed in another currency (DESIGN.md §8): what it is in the household currency, at which rate and from
 * where, with the chip tones of the rates table. "Change this month's rate…" sets one rate per currency per month by hand;
 * "Use the ECB rate again" drops it and fetches that month afresh. The Statement shows the same rate as a chip in its
 * toolbar (`RateChip`).
 */
export function RateLine({ tables, household, month, currency, amount }: { tables: Tables; household: Household; month: MonthKey; currency: string; amount: Money }) {
  const { base, locale, fx, info, rec, tag, readable, busy, error, setError, save, restore } = useMonthRate(tables, household, month, currency)
  const inputId = useId()
  const inBase = info ? convertMoney(fx, amount, currency, base, month).value : null
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState('')
  const done = () => setEditing(false)
  const saveRate = () => save(text, done)

  return (
    <div className="space-y-1 text-xs text-muted-foreground" data-testid="rate-line">
      <p className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 tabular-nums">
        {info && inBase != null
          ? <><span>≈ {formatAmount(inBase, base, locale)}</span><span aria-hidden>·</span><span>{readable.text}</span><span aria-hidden>·</span></>
          : <span>No {currency} rate for {formatMonth(month, locale)} yet.</span>}
        <Chip tone={TAG_TONE[tag]}>{tag}</Chip>
        {rec?.date && <span>{formatDay(rec.date, locale)}</span>}
        <InfoTip help="cell.rate" />
        {!editing && <Button size="xs" variant="ghost" onClick={() => { setText(info ? formatRate(readable.rate, locale) : ''); setError(null); setEditing(true) }}>Change this month's rate…</Button>}
        {!editing && tag === 'manual' && <Button size="xs" variant="ghost" disabled={busy} onClick={() => restore(done)}>Use the ECB rate again</Button>}
      </p>
      {editing && (
        <div className="flex flex-wrap items-center gap-2">
          <Label htmlFor={inputId}>1 {readable.from} =</Label>
          <Input id={inputId} className="h-7 w-28 text-right tabular-nums" inputMode="decimal" autoFocus value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); saveRate() } }} />
          <span>{readable.to}</span>
          <Button size="xs" variant="outline" disabled={busy} onClick={saveRate}>Save rate</Button>
          <Button size="xs" variant="ghost" disabled={busy} onClick={() => setEditing(false)}>Cancel</Button>
          <span className="basis-full">One rate per currency per month: every {currency} row and balance in {formatMonth(month, locale)} uses it.</span>
        </div>
      )}
      {error && <p role="alert" className="text-destructive">{error}</p>}
    </div>
  )
}
