import { useId, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Chip, chipClass } from '@/components/ui/chip'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Popover, PopoverContent, PopoverDescription, PopoverHeader, PopoverTitle, PopoverTrigger } from '@/components/ui/popover'
import { formatMonth } from '@/app/format'
import { HELP } from '@/app/help'
import type { Household, MonthKey, Tables } from '@/model'
import { TAG_TONE, formatDay, formatRate } from '@/features/household/fxDisplay'
import { useMonthRate } from '@/features/grid/useMonthRate'

/** Where the month's rate came from, in words. */
const SOURCE: Record<string, string> = {
  manual: 'Your own rate for this month.',
  ECB: 'The European Central Bank\'s rate.',
  projected: 'An estimate: projected from the last month with a rate.',
  carried: 'Carried over from the nearest month with a rate.',
  missing: 'No rate yet: amounts in this currency cannot be counted until there is one.',
}

/**
 * The month's rate for one other currency, in the Statement's toolbar (DESIGN.md §7): a chip that says the rate
 * (`1 EUR = 1.08 USD`) in the tone of where it came from, and nothing else on the page. Pressing it opens the rest:
 * where the rate is from, a field to type your own for this month, and "Use the ECB rate again" once it is yours. A
 * closed month shows the same and changes nothing.
 */
export function RateChip({ tables, household, month, currency, locked = false }: {
  tables: Tables; household: Household; month: MonthKey; currency: string
  /** A closed month shows its rate and changes none. */
  locked?: boolean
}) {
  const { locale, info, rec, tag, readable, busy, error, setError, save, restore } = useMonthRate(tables, household, month, currency)
  const inputId = useId()
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const said = info ? readable.text : `No ${currency} rate`
  const long = formatMonth(month, locale, 'long')
  const close = () => setOpen(false)
  const onOpenChange = (next: boolean) => {
    // every opening starts on the rate as it stands
    if (next) {
      setText(info ? formatRate(readable.rate, locale) : '')
      setError(null)
    }
    setOpen(next)
  }

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger
        aria-label={`${said}: ${locked ? 'the rate of this month' : 'change this month\'s rate'}`} title={locked ? 'This month\'s rate' : 'Change this month\'s rate'}
        data-testid="rate-chip" data-source={tag}
        className={chipClass(TAG_TONE[tag], 'filled', 'cursor-pointer tabular-nums outline-none hover:brightness-95 focus-visible:ring-2 focus-visible:ring-ring data-popup-open:brightness-95 pointer-coarse:px-2.5 pointer-coarse:py-1.5')}
      >
        {said}
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 gap-2 p-3 text-xs" data-testid="rate-popover">
        <PopoverHeader className="gap-1 text-xs">
          <PopoverTitle className="text-xs font-semibold">{currency} in {long}</PopoverTitle>
          <PopoverDescription className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs leading-4">
            <Chip tone={TAG_TONE[tag]}>{tag}</Chip>
            <span>{SOURCE[tag]}{rec?.date ? ` Taken on ${formatDay(rec.date, locale)}.` : ''}</span>
          </PopoverDescription>
        </PopoverHeader>
        {locked ? (
          <p className="text-muted-foreground">{long} is closed: reopen it to change its rate.</p>
        ) : (
          <form className="flex flex-wrap items-center gap-2" onSubmit={(e) => { e.preventDefault(); save(text, close) }}>
            <Label htmlFor={inputId} className="text-xs">1 {readable.from} =</Label>
            <Input id={inputId} className="h-7 w-24 text-right text-xs tabular-nums" inputMode="decimal" autoFocus value={text} onChange={(e) => setText(e.target.value)} />
            <span>{readable.to}</span>
            <Button size="xs" variant="outline" type="submit" disabled={busy}>Save rate</Button>
            {tag === 'manual' && <Button size="xs" variant="ghost" type="button" disabled={busy} onClick={() => restore(close)}>Use the ECB rate again</Button>}
          </form>
        )}
        {error && <p role="alert" className="text-destructive">{error}</p>}
        <p className="leading-4 text-muted-foreground">{HELP['statement.rate'].text}</p>
      </PopoverContent>
    </Popover>
  )
}
