import { Button } from '@/components/ui/button'
import { Chip } from '@/components/ui/chip'
import { Tick } from '@/components/Tick'
import { ESTIMATE_SHADE } from '@/app/display'
import { formatAmount, ordinalDay, weekdayOf } from '@/app/format'
import type { Payment } from '@/engine'
import { ABOVE, AMOUNT_COL, STRETCHED } from '@/features/statement/StatementLine'
import { cn } from '@/lib/utils'
import type { MonthKey, PaymentMethod } from '@/model'

/** The day's column: wide enough for `Wed 28`, so the names start on one edge. */
const DAY_COL = 'w-12 shrink-0 whitespace-nowrap tabular-nums text-muted-foreground'

/**
 * One payment on the Payments page (DESIGN.md §12): its tick, the day it goes out on, what it is, how it is paid and
 * the amount. The tick is the Statement's tick for the same amount. The line opens the amount's dialog when pressed
 * anywhere (its name is the button, stretched over the line, as on the Statement); a line without a day carries
 * "Set…" for the row's usual day and method.
 */
export function PaymentLine({ payment: p, month, method, currency, locale, busy, onTick, onOpen, onSet }: {
  payment: Payment
  month: MonthKey
  /** The method it is paid with; null where none is named. */
  method: PaymentMethod | null
  currency: string
  locale: string
  /** Its tick is being saved. */
  busy: boolean
  onTick: () => void
  onOpen: () => void
  /** "Set…": the row's usual day and method. Left out where the line is one item of several, which is set in the amount's dialog. */
  onSet?: () => void
}) {
  /** An item is named with its row, so every tick and button on the page has a name of its own. */
  const fullLabel = p.rowLabel ? `${p.rowLabel}: ${p.label}` : p.label
  const amountText = formatAmount(p.amount, currency, locale)
  const dayText = p.day != null ? `${weekdayOf(month, p.day, locale)} ${p.day}` : '–'
  const daySaid = p.day != null ? `on the ${ordinalDay(p.day)}` : 'no day yet'
  const said = `${fullLabel}: ${amountText}, ${daySaid}${method ? `, ${method.name}` : ''}${p.done ? ', done' : ''}`
  return (
    <li className="group/line flex min-h-11 items-center gap-1.5 pr-2 text-sm md:min-h-8 md:text-xs" data-payment={p.id} data-state={p.state}>
      <Tick
        done={p.done ? 1 : 0} total={1} state={p.done ? 'all' : 'none'} label={`${fullLabel} done`} disabled={busy} onToggle={onTick}
        className="md:size-7 md:rounded" dotClassName="md:size-3.5"
      />
      <div className="relative -mr-2 flex min-w-0 flex-1 items-center gap-1.5 self-stretch rounded pr-2 hover:bg-muted">
        <span className={DAY_COL} title={p.day != null ? undefined : 'No day yet'}>{dayText}</span>
        <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-1.5 gap-y-0.5 py-1">
          <button type="button" aria-label={said} onClick={onOpen} className={cn('min-w-0 truncate', STRETCHED, p.done && 'text-muted-foreground')}>{p.label}</button>
          {p.rowLabel && <span className="min-w-0 truncate text-muted-foreground">{p.rowLabel}</span>}
          <span className="min-w-0 truncate text-muted-foreground" data-testid="payment-method">{method ? method.name : 'no method'}</span>
          {p.ask === 'hand' && !p.done && <Chip tone="sky" title="You make this payment yourself.">by hand</Chip>}
          {p.onCard && <Chip tone="zinc" title="Bought on a credit card: it is owed there, and leaves an account when the card is paid.">on card</Chip>}
          {p.automatic && <Chip tone="zinc" title="Worked out by the app: it can still move while the month runs.">calculated</Chip>}
        </span>
        {onSet && <Button size="xs" variant="outline" className={ABOVE} aria-label={`Set the day and method of ${fullLabel}`} onClick={onSet}>Set…</Button>}
        <span data-testid="payment-amount" className={cn(AMOUNT_COL, p.done && 'text-muted-foreground')} title={p.native ? formatAmount(p.native.amount, p.native.currency, locale) : undefined}>
          {/* the negative margin keeps the shaded digits in their column */}
          {p.estimate ? <span data-estimate className={cn('-mr-1', ESTIMATE_SHADE)}>{amountText}</span> : amountText}
        </span>
      </div>
    </li>
  )
}
