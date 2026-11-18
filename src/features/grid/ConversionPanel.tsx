import { useEffect, useId, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Chip } from '@/components/ui/chip'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { InfoTip } from '@/components/InfoTip'
import { amountToInput, formatAmount, parseAmount } from '@/app/format'
import { conversionFor, conversionFrom, type Conversion, type ConversionFigures, type Money } from '@/model'
import { fetchDayRate } from '@/store'
import { formatDay, formatRate, readableRate, toStored } from '@/features/household/fxDisplay'
import { errorText } from '@/app/saveError'

/** The three figures of a conversion, as the panel names them. */
type Field = 'amount' | 'other' | 'rate'

interface Props {
  /** The amount as typed, in `currency`; null while the field cannot be read. */
  amount: Money | null
  /** The currency the amount is typed in, and the household's. */
  currency: string
  home: string
  /** The conversion's other currency: the amount's own when it is not the household's, else the account's it moves. */
  foreign: string
  /** What is recorded, or drafted in the dialog; null for none. */
  value: Conversion | null
  /** The month's rate (how many of `foreign` one `home` buys), to start from and to read the rate the usual way round. */
  monthRate: number | null
  /** The day whose official rate "Use" takes at first: the month's last day, or today in a month that runs. */
  day: string
  locale: string
  /** Whether the amount is done: a conversion counts only then. */
  done: boolean
  /** Names the fields of one item in a list ("of Hotel"); empty for a single amount. */
  of?: string
  onChange: (c: Conversion | null) => void
  /** The amount follows from the other two figures: the dialog puts it into its field. */
  onAmount: (minor: Money) => void
}

/**
 * "Record the conversion…" under an amount in another currency (rule X10, DESIGN.md §8): what the amount really came
 * to. Three figures, the amount as typed, the amount in the other currency and the rate, and the two typed last give
 * the third. "Official rate of <day>" takes the ECB's rate of that day. The panel saves nothing itself: it hands its
 * conversion to the dialog, whose Save stores it with the amount, set to Done.
 */
export function ConversionPanel({ amount, currency, home, foreign, value, monthRate, day: firstDay, locale, done, of = '', onChange, onAmount }: Props) {
  const id = useId()
  const typedHome = currency === home
  /** The currency of the figure the panel asks for: the side the amount is not typed in. */
  const otherCurrency = typedHome ? foreign : home
  const [open, setOpen] = useState(false)
  /** What was there when the panel opened, for Cancel. */
  const [before, setBefore] = useState<Conversion | null>(null)
  // the rate is read the usual way round ("1 EUR = 1.1000 USD"), and stays that way round while the panel is open
  const [wayRate, setWayRate] = useState(value?.rate ?? monthRate ?? 1)
  const way = readableRate(home, foreign, open ? wayRate : value?.rate ?? monthRate ?? 1, locale)
  const [otherText, setOtherText] = useState('')
  const [rateText, setRateText] = useState('')
  /** The two figures typed last; the third follows from them. */
  const [given, setGiven] = useState<[Field, Field]>(['amount', 'rate'])
  /** The day of the official rate in the rate field, until the rate is typed over. */
  const [rateDay, setRateDay] = useState<string | null>(null)
  const [day, setDay] = useState(firstDay)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const follows: Field = (['amount', 'other', 'rate'] as Field[]).find((f) => !given.includes(f))!
  /** The conversion the open panel says, from the two figures given. */
  const draft = useMemo(() => {
    if (!open) return null
    const figures: ConversionFigures = { foreign, home, date: rateDay }
    for (const f of given) {
      if (f === 'amount' && amount != null) {
        if (typedHome) figures.homeAmount = amount
        else figures.foreignAmount = amount
      }
      if (f === 'other') {
        const other = parseAmount(otherText, otherCurrency, locale)
        if (other != null) {
          if (typedHome) figures.foreignAmount = other
          else figures.homeAmount = other
        }
      }
      if (f === 'rate') {
        const typed = Number(rateText.replace(',', '.'))
        if (typed > 0) figures.rate = toStored(way, home, typed)
      }
    }
    return conversionFrom(figures)
  }, [open, given, amount, otherText, rateText, rateDay, foreign, home, typedHome, otherCurrency, locale, way])

  // the open panel's conversion goes to the dialog as it changes; so does an amount that follows from the other two
  const draftKey = draft ? JSON.stringify(draft) : ''
  useEffect(() => {
    if (!open) return
    onChange(draft)
    const followed = draft && follows === 'amount' ? (typedHome ? draft.homeAmount : draft.foreignAmount) : null
    if (followed != null && followed !== amount) onAmount(followed)
  }, [open, draftKey]) // eslint-disable-line react-hooks/exhaustive-deps

  /** A field typed into: it is given now, with the one typed before it; the third follows. */
  const typed = (f: Field) => setGiven(([last, prev]) => (last === f ? [last, prev] : [f, last]))
  // the amount field is the dialog's: typing there makes the amount given
  const [seen, setSeen] = useState(amount)
  if (amount !== seen) {
    setSeen(amount)
    const followed = draft && follows === 'amount' ? (typedHome ? draft.homeAmount : draft.foreignAmount) : null
    if (open && amount !== followed) typed('amount')
  }

  /** The figure a field shows: what was typed, or what follows from the other two. */
  const otherShown = follows === 'other' ? (draft ? amountToInput(typedHome ? draft.foreignAmount : draft.homeAmount, otherCurrency, locale) : '') : otherText
  const rateShown = follows === 'rate' ? (draft ? formatRate(way.from === home ? draft.rate : 1 / draft.rate, locale) : '') : rateText

  function start(from: Conversion | null) {
    const c = from && amount != null ? conversionFor(from, amount, currency, home) ?? from : from
    setOtherText(c ? amountToInput(typedHome ? c.foreignAmount : c.homeAmount, otherCurrency, locale) : '')
    const r = c?.rate ?? monthRate
    const startWay = readableRate(home, foreign, r ?? 1, locale)
    setWayRate(r ?? 1)
    setRateText(r ? formatRate(startWay.from === home ? r : 1 / r, locale) : '')
    setBefore(from)
    setRateDay(c?.date ?? null)
    setGiven(['amount', 'rate'])
    setError(null)
    setOpen(true)
  }
  function remove() {
    setOpen(false)
    onChange(null)
  }
  /** Back to what was there when the panel opened. */
  function cancel() {
    setOpen(false)
    onChange(before)
  }
  async function takeOfficial() {
    setBusy(true)
    setError(null)
    try {
      const got = await fetchDayRate(home, foreign, day)
      setRateText(formatRate(way.from === home ? got.rate : 1 / got.rate, locale))
      setRateDay(got.date)
      typed('rate')
    } catch (e) {
      setError(errorText(e, 'Could not fetch the rate.'))
    } finally {
      setBusy(false)
    }
  }

  // what is recorded, as it holds for the amount now in the field: a corrected amount keeps the rate
  const shown = !open && value ? (amount != null ? conversionFor(value, amount, currency, home) : value) : null
  const rateLine = (c: Conversion) => `1 ${way.from} = ${formatRate(way.from === home ? c.rate : 1 / c.rate, locale)} ${way.to}`

  if (!open) {
    return (
      <div className="space-y-1 text-xs text-muted-foreground" data-testid="conversion">
        {shown ? (
          <p className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 tabular-nums">
            <span className="text-foreground">= {formatAmount(typedHome ? shown.foreignAmount : shown.homeAmount, otherCurrency, locale)}</span>
            <span aria-hidden>·</span><span>{rateLine(shown)}</span><span aria-hidden>·</span>
            <Chip tone="sky">recorded</Chip>
            {shown.date && <span>{formatDay(shown.date, locale)}</span>}
            <InfoTip help="cell.conversion" />
            <Button size="xs" variant="ghost" onClick={() => start(value)}>Change…</Button>
            <Button size="xs" variant="ghost" onClick={remove}>Remove</Button>
          </p>
        ) : (
          <p className="flex flex-wrap items-center gap-1.5">
            <Button size="xs" variant="outline" onClick={() => start(null)} aria-label={`Record the conversion${of ? ` ${of}` : ''}…`}>Record the conversion…</Button>
            <InfoTip help="cell.conversion" />
          </p>
        )}
        {shown && !done && <p data-testid="conversion-not-done">Counts once the amount is Done; until then the month's rate does.</p>}
        {shown && conversionFor(value!, amount ?? 0, currency, home) == null && <p role="alert" className="text-destructive">The amount is in neither {foreign} nor {home} now: remove the conversion.</p>}
      </div>
    )
  }

  return (
    <div className="space-y-2 rounded-md border p-2 text-xs" data-testid="conversion-panel">
      <p className="font-medium text-foreground">What the amount came to</p>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="flex items-center gap-1.5">
          <Label className="text-xs" htmlFor={`${id}-other`}>In {otherCurrency}</Label>
          <Input
            id={`${id}-other`} aria-label={`In ${otherCurrency}${of ? ` ${of}` : ''}`} className="h-7 w-32 text-right tabular-nums" inputMode="decimal"
            value={otherShown} onChange={(e) => { setOtherText(e.target.value); typed('other') }}
          />
        </span>
        <span className="flex items-center gap-1.5">
          <Label className="text-xs" htmlFor={`${id}-rate`}>1 {way.from} =</Label>
          <Input
            id={`${id}-rate`} aria-label={`Rate, ${way.to} for 1 ${way.from}${of ? ` ${of}` : ''}`} className="h-7 w-24 text-right tabular-nums" inputMode="decimal"
            value={rateShown} onChange={(e) => { setRateText(e.target.value); setRateDay(null); typed('rate') }}
          />
          <span>{way.to}</span>
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <Label className="text-xs" htmlFor={`${id}-day`}>Official rate of</Label>
        <Input id={`${id}-day`} type="date" className="h-7 w-36" value={day} onChange={(e) => setDay(e.target.value)} />
        <Button size="xs" variant="outline" disabled={busy || !day} onClick={() => void takeOfficial()}>Use</Button>
        {rateDay && <span className="text-muted-foreground">ECB rate of {formatDay(rateDay, locale)}</span>}
      </div>
      <p className="text-muted-foreground">
        {draft
          ? `${formatAmount(draft.foreignAmount, foreign, locale)} = ${formatAmount(draft.homeAmount, home, locale)}. Saved with the amount, which is then Done; a new rate for the month does not change it.`
          : 'Type the amount in the other currency or the rate: two of the three figures give the third.'}
      </p>
      {error && <p role="alert" className="text-destructive">{error}</p>}
      <div className="flex flex-wrap gap-1.5">
        <Button size="xs" variant="outline" disabled={!draft} onClick={() => setOpen(false)}>Done</Button>
        <Button size="xs" variant="ghost" onClick={cancel}>Cancel</Button>
      </div>
    </div>
  )
}
