import { Fragment, type ReactNode } from 'react'
import { AmountHint } from '@/components/AmountHint'
import { Check } from '@/components/Check'
import { Input } from '@/components/ui/input'
import { formatAmount, formatMonth } from '@/app/format'
import { cn } from '@/lib/utils'
import type { MonthKey } from '@/model'
import { unrecordedRowName, type BalanceLine } from '@/store'
import type { BalanceSide, MonthBalancesForm } from './useMonthBalances'

/** Accounts that stand together in the list, under a heading when they have one. */
export interface BalanceGroup {
  heading?: string
  /** Said under the heading: what the plan knows about these accounts together. */
  note?: ReactNode
  lines: BalanceLine[]
}

/**
 * A month's balances as fields (DESIGN.md §8): per account what it held at the start of the month and at the end. A
 * field with a number is a real balance; an empty one shows the calculated amount in grey and keeps it. With `named`
 * every pair stands beside its account's name (on a phone: under it); without, the one pair fills the width.
 */
export function BalanceFields({ form, groups, month, base, named, onEnter }: {
  form: MonthBalancesForm
  groups: BalanceGroup[]
  month: MonthKey
  /** The household currency: an account in another one says so after its name. */
  base: string
  named: boolean
  onEnter: () => void
}) {
  const { locale } = form
  const long = formatMonth(month, locale, 'long')
  // the cursor waits in the first end field: the number a bank statement closes on
  const focusId = groups.flatMap((g) => g.lines)[0]?.account.id

  function field(side: BalanceSide, line: BalanceLine) {
    const { account } = line
    const ccy = account.currency
    const text = form.textOf(side, account.id)
    const calculated = side === 'start' ? line.startCalculated : line.endCalculated
    const opening = side === 'start' && line.opening
    const difference = side === 'end' ? form.difference(line) : null
    const empty = text.trim() === ''
    const note = opening ? 'opening amount'
      : empty ? (calculated != null ? 'calculated' : null)
      : difference ? `Difference ${formatAmount(difference, ccy, locale, { sign: 'exceptZero' })}` : null
    const label = `${named ? `${account.name}: at` : 'At'} the ${side} of ${long} (${ccy})`
    return (
      <div className="min-w-0 space-y-0.5" data-testid={`balance-${side}`}>
        <Input
          aria-label={label} inputMode="decimal" autoFocus={side === 'end' && account.id === focusId} className="h-8 text-right tabular-nums"
          value={text} onChange={(e) => form.setText(side, account.id, e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') onEnter() }}
          placeholder={!opening && calculated != null ? formatAmount(calculated, ccy, locale) : undefined}
        />
        <AmountHint text={text} currency={ccy} locale={locale} className="text-right" />
        {note && <p className="text-right text-[11px] leading-4 text-muted-foreground" data-testid="balance-note">{note}</p>}
      </div>
    )
  }

  return (
    <div className={cn('grid items-start gap-x-3 gap-y-1.5', named ? 'grid-cols-2 sm:grid-cols-[minmax(0,1fr)_9.5rem_9.5rem]' : 'grid-cols-2')} data-testid="balance-fields">
      {named && <span className="hidden sm:block" />}
      <span className="text-xs text-muted-foreground">At the start{named ? '' : ` of ${long}`}</span>
      <span className="text-xs text-muted-foreground">At the end{named ? '' : ` of ${long}`}</span>
      {groups.filter((g) => g.lines.length > 0).map((g, i) => (
        <Fragment key={g.heading ?? i}>
          {g.heading && <p className="col-span-full mt-1.5 text-xs font-medium">{g.heading}</p>}
          {g.note && <div className="col-span-full text-xs text-muted-foreground">{g.note}</div>}
          {g.lines.map((line) => (
            <Fragment key={line.account.id}>
              {named && (
                <span className="col-span-2 min-w-0 truncate text-sm sm:col-span-1 sm:pt-1.5" data-testid={`balance-name-${line.account.id}`}>
                  {line.account.name}{line.account.currency !== base && <span className="text-muted-foreground"> ({line.account.currency})</span>}
                </span>
              )}
              {field('start', line)}
              {field('end', line)}
              {form.canBook(line) && (
                <div className="col-span-full space-y-1 rounded-md border p-2.5" data-testid="book-difference">
                  <Check
                    label={`Count the ${formatAmount(form.difference(line) ?? 0, line.account.currency, locale)} difference as spending this month`}
                    checked={form.bookOf(line.account.id)} onChange={(e) => form.setBook(line.account.id, e.target.checked)}
                  />
                  <p className="text-xs text-muted-foreground">
                    {form.bookOf(line.account.id)
                      ? `It is added as "Not recorded" on the row "${unrecordedRowName(line.account)}", paid from this card, so the month's expenses and what is owed agree. Rename it or split it into items any time.`
                      : 'Only the balance changes. What is owed rises without a line of spending to explain it.'}
                  </p>
                </div>
              )}
            </Fragment>
          ))}
        </Fragment>
      ))}
    </div>
  )
}
