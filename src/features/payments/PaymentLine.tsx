import { buttonVariants } from '@/components/ui/button'
import { Chip } from '@/components/ui/chip'
import { Tick } from '@/components/Tick'
import { ESTIMATE_SHADE } from '@/app/display'
import { formatAmount, ordinalDay, weekdayOf } from '@/app/format'
import type { Payment } from '@/engine'
import { AMOUNT_COL, STRETCHED } from '@/features/statement/StatementLine'
import { cn } from '@/lib/utils'
import type { MonthKey, PaymentMethod } from '@/model'

/** The day's column: wide enough for `Wed 28`, so the names start on one edge. */
const DAY_COL = 'w-12 shrink-0 whitespace-nowrap tabular-nums text-muted-foreground'

/** An item is named with its row, so every tick and button on the page has a name of its own. */
const fullLabelOf = (p: Payment) => (p.rowLabel ? `${p.rowLabel}: ${p.label}` : p.label)

const CALCULATED = <Chip tone="zinc" title="Worked out by the app: it can still move while the month runs.">calculated</Chip>

function Amount({ payment: p, currency, locale, muted }: { payment: Payment; currency: string; locale: string; muted?: boolean }) {
  const text = formatAmount(p.amount, currency, locale)
  return (
    <span data-testid="payment-amount" className={cn(AMOUNT_COL, muted && 'text-muted-foreground')} title={p.native ? formatAmount(p.native.amount, p.native.currency, locale) : undefined}>
      {/* the negative margin keeps the shaded digits in their column */}
      {p.estimate ? <span data-estimate className={cn('-mr-1', ESTIMATE_SHADE)}>{text}</span> : text}
    </span>
  )
}

/**
 * One tracked payment on the Payments page (DESIGN.md §12): its tick, the day it goes out on, what it is, how it is
 * paid and the amount. The tick is the Statement's tick for the same amount. The line opens "Payment", its day and
 * method, when pressed anywhere (its name is the button, stretched over the line, as on the Statement).
 */
export function PaymentLine({ payment: p, month, method, currency, locale, busy, marked = false, onTick, onOpen }: {
  payment: Payment
  month: MonthKey
  /** The method it is paid with; null where none is named. */
  method: PaymentMethod | null
  currency: string
  locale: string
  /** Its tick is being saved. */
  busy: boolean
  /** The line the Statement has just pointed at (a day was pressed there): the focus ring's colour, never the lime. */
  marked?: boolean
  onTick: () => void
  onOpen: () => void
}) {
  const fullLabel = fullLabelOf(p)
  const dayText = p.day != null ? `${weekdayOf(month, p.day, locale)} ${p.day}` : '–'
  const daySaid = p.day != null ? `on the ${ordinalDay(p.day)}` : 'no day'
  const said = `${fullLabel}: ${formatAmount(p.amount, currency, locale)}, ${daySaid}${method ? `, ${method.name}` : ''}${p.done ? ', done' : ''}`
  return (
    <li className={cn('group/line flex min-h-11 items-center gap-1.5 pr-2 text-sm md:min-h-8 md:text-xs', marked && 'rounded bg-muted ring-2 ring-inset ring-ring')} data-payment={p.id} data-state={p.state} data-marked={marked || undefined}>
      <Tick
        done={p.done ? 1 : 0} total={1} state={p.done ? 'all' : 'none'} label={`${fullLabel} done`} disabled={busy} onToggle={onTick}
        className="md:size-7 md:rounded" dotClassName="md:size-3.5"
      />
      <div className="relative -mr-2 flex min-w-0 flex-1 items-center gap-1.5 self-stretch rounded pr-2 hover:bg-muted">
        <span className={DAY_COL} title={p.day != null ? undefined : 'No day'}>{dayText}</span>
        <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-1.5 gap-y-0.5 py-1">
          <button type="button" data-line-button aria-label={said} onClick={onOpen} className={cn('min-w-0 truncate', STRETCHED, p.done && 'text-muted-foreground')}>{p.label}</button>
          {p.rowLabel && <span className="min-w-0 truncate text-muted-foreground">{p.rowLabel}</span>}
          <span className="min-w-0 truncate text-muted-foreground" data-testid="payment-method">{method ? method.name : 'no method'}</span>
          {p.ask === 'hand' && !p.done && <Chip tone="sky" title="You make this payment yourself.">by hand</Chip>}
          {p.automatic && CALCULATED}
        </span>
        <Amount payment={p} currency={currency} locale={locale} muted={p.done} />
      </div>
    </li>
  )
}

/**
 * One untracked amount: it leaves in the month, and nothing says when or how. A quiet line with no tick (its tick is
 * on the Statement) that is one button: pressed anywhere it opens "Payment", where a day or a method tracks it. The
 * "Track…" at its end is what that button looks like, not a second one.
 */
export function UntrackedLine({ payment: p, currency, locale, onTrack }: { payment: Payment; currency: string; locale: string; onTrack: () => void }) {
  return (
    <li className="group/line relative flex min-h-11 items-center gap-1.5 rounded px-2 text-sm hover:bg-muted md:min-h-8 md:text-xs" data-payment={p.id} data-state={p.state}>
      <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-1.5 gap-y-0.5 py-1">
        <button type="button" data-line-button aria-label={`Track ${fullLabelOf(p)}: ${formatAmount(p.amount, currency, locale)}`} onClick={onTrack} className={cn('min-w-0 truncate', STRETCHED)}>{p.label}</button>
        {p.rowLabel && <span className="min-w-0 truncate text-muted-foreground">{p.rowLabel}</span>}
        {p.automatic && CALCULATED}
      </span>
      <span aria-hidden className={cn(buttonVariants({ variant: 'outline', size: 'xs' }), 'pointer-events-none font-normal text-muted-foreground group-hover/line:text-foreground')}>Track…</span>
      <Amount payment={p} currency={currency} locale={locale} />
    </li>
  )
}
