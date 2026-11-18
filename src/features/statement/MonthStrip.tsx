import { useEffect, useLayoutEffect, useRef, type KeyboardEvent } from 'react'
import { InfoTip } from '@/components/InfoTip'
import { formatAmount, formatMonth, formatWhole } from '@/app/format'
import { HUES } from '@/app/hues'
import { cn } from '@/lib/utils'
import { isPastMonth, type Money, type MonthKey } from '@/model'
import { stripStart, type StripMonth } from './stripMonths'

/**
 * The months of the plan as a strip of chips, first thing on the Statement (DESIGN.md §7). A chip is its month in
 * two lines: income + what came out of the accounts, and expenses + what was left, each figure in the hue its group
 * has on the page. A month that is over is grey, the current one says "now", and the month on screen is the pressed
 * chip. The strip opens with three past months at its left edge, scrolls sideways, and keeps the pressed chip in
 * view. One stop for the Tab key: the arrow keys move along it.
 */
export function MonthStrip({ months, month, today, currency, locale, onChange }: {
  months: StripMonth[]
  /** The month on screen. */
  month: MonthKey
  today: MonthKey
  currency: string
  locale: string
  onChange: (m: MonthKey) => void
}) {
  const strip = useRef<HTMLDivElement>(null)
  const placed = useRef(false)
  const keys = months.map((s) => s.month)
  const start = stripStart(keys, today)
  const chipOf = (m: MonthKey) => strip.current?.querySelector<HTMLElement>(`[data-month="${m}"]`) ?? null

  // Where the strip opens: three past months before the current one. Set before the first paint, so it does not jump.
  useLayoutEffect(() => {
    const el = strip.current
    const first = keys[start] ? chipOf(keys[start]) : null
    if (!el || !first || placed.current) return
    el.scrollTo({ left: first.offsetLeft, behavior: 'instant' })
    placed.current = true
  })
  // The pressed chip stays in view, however the month was changed: from here, or with the arrows beside its name.
  useEffect(() => {
    const el = strip.current
    const chip = chipOf(month)
    if (!el || !chip) return
    // how far the strip has to be scrolled at least for the chip's right edge to be in
    const need = chip.offsetLeft + chip.offsetWidth - el.clientWidth
    if (chip.offsetLeft < el.scrollLeft) el.scrollTo({ left: chip.offsetLeft })
    else if (need > el.scrollLeft) {
      // to the start of a chip, where the strip comes to rest by itself (it snaps): the first one that leaves the pressed chip whole
      const first = [...el.children].find((c) => (c as HTMLElement).offsetLeft >= need) as HTMLElement | undefined
      el.scrollTo({ left: first?.offsetLeft ?? need })
    }
    // only a change of month moves the strip
  }, [month]) // eslint-disable-line react-hooks/exhaustive-deps

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const at = keys.indexOf((e.target as HTMLElement).dataset.month ?? '')
    const to = e.key === 'ArrowRight' ? at + 1 : e.key === 'ArrowLeft' ? at - 1 : e.key === 'Home' ? 0 : e.key === 'End' ? keys.length - 1 : -1
    if (at < 0 || to < 0 || to >= keys.length || to === at) return
    e.preventDefault()
    chipOf(keys[to])?.focus()
  }

  return (
    <nav aria-label="Months" className="flex items-start gap-1" data-testid="month-strip">
      <div
        ref={strip} onKeyDown={onKeyDown}
        className="relative flex min-w-0 flex-1 snap-x gap-1.5 overflow-x-auto scroll-smooth pb-0.5 [scrollbar-width:none] motion-reduce:scroll-auto [&::-webkit-scrollbar]:hidden"
      >
        {months.map((s) => {
          const pressed = s.month === month
          const now = s.month === today
          const past = isPastMonth(s.month, today)
          const figures: Array<[string, Money]> = [['income', s.income], ['from accounts', s.fromAccounts], ['expenses', s.expenses], ['from what is left', s.left]]
          const said = figures.filter(([, v]) => v !== 0).map(([what, v]) => `${what} ${formatAmount(v, currency, locale, { compact: true })}`)
          return (
            <button
              key={s.month} type="button" data-month={s.month} tabIndex={pressed ? 0 : -1}
              aria-pressed={pressed} aria-current={now ? 'date' : undefined}
              aria-label={`${formatMonth(s.month, locale, 'long')}${now ? ', now' : past ? ', past' : ''}${said.length ? `: ${said.join(', ')}` : ': nothing yet'}`}
              onClick={() => onChange(s.month)}
              className={cn(
                'min-w-[5.5rem] shrink-0 grow-0 basis-[5.5rem] snap-start rounded-md border px-2 py-1 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring md:basis-[calc((100%_-_4.125rem)/12)]',
                pressed ? 'border-primary bg-primary text-primary-foreground' : past ? 'bg-muted/60 hover:bg-muted' : 'bg-card hover:bg-muted',
              )}
            >
              <span className="flex items-baseline justify-between gap-1 whitespace-nowrap text-xs leading-4">
                <span className={cn(now ? 'font-semibold' : 'font-medium', !pressed && !now && 'text-muted-foreground')}>{formatMonth(s.month, locale)}</span>
                {now && <span className={cn('text-[10px]', !pressed && 'text-muted-foreground')}>now</span>}
              </span>
              <Figures a={s.income} b={s.fromAccounts} hues={[HUES.income.text, HUES.worth.text]} plain={pressed} currency={currency} locale={locale} />
              <Figures a={s.expenses} b={s.left} hues={[HUES.expense.text, HUES.transfer.text]} plain={pressed} currency={currency} locale={locale} />
            </button>
          )
        })}
      </div>
      <InfoTip help="statement.months" className="mt-1.5 shrink-0" />
    </nav>
  )
}

/** One line of a chip: two figures with a plus between them. A figure that is nothing is left out; a line of nothing is a faint dot. */
function Figures({ a, b, hues, plain, currency, locale }: { a: Money; b: Money; hues: [string, string]; plain: boolean; currency: string; locale: string }) {
  const both: Array<[Money, string]> = [[a, hues[0]], [b, hues[1]]]
  const parts = both.filter(([v]) => v !== 0)
  return (
    <span className="block whitespace-nowrap text-[11px] leading-4 tabular-nums">
      {parts.length === 0 && <span className={plain ? 'opacity-60' : 'text-muted-foreground/60'}>·</span>}
      {parts.map(([v, hue], i) => (
        <span key={hue}>
          {i > 0 && <span className={plain ? 'opacity-60' : 'text-muted-foreground'}> + </span>}
          <span className={plain ? undefined : hue}>{formatWhole(v, currency, locale)}</span>
        </span>
      ))}
    </span>
  )
}
