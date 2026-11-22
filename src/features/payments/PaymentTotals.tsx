import { useState, type ReactNode } from 'react'
import { Island } from '@/components/ui/island'
import { formatAmount, formatMonth, ordinalDay } from '@/app/format'
import { HUES } from '@/app/hues'
import { readPref, writePref } from '@/app/prefs'
import type { PaymentAccountTotal, Payments } from '@/engine'
import { cn } from '@/lib/utils'
import { sameFilter, type PaymentFilter } from './groups'

/**
 * A total that is a switch (DESIGN.md §12): pressed, the list shows only its payments, and it wears the lime's
 * border, the one pressed colour; pressed again, the list shows all.
 */
function TotalRow({ label, amount, note, pressed, onPress, strong = false, inner = false, said }: {
  label: string; amount: string; note?: ReactNode; pressed: boolean; onPress: () => void; strong?: boolean; inner?: boolean
  /** The accessible name: what it is and what it comes to. */
  said: string
}) {
  return (
    <button
      type="button" aria-pressed={pressed} aria-label={said} onClick={onPress}
      className={cn(
        'flex min-h-11 w-full items-center gap-2 rounded px-1.5 text-left outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring md:min-h-7',
        inner && 'pl-5', pressed && 'bg-muted shadow-[inset_0_0_0_2px_var(--color-primary)]',
      )}
    >
      <span className={cn('min-w-0 flex-1 truncate', strong && 'font-medium')}>{label}</span>
      {note && <span className="shrink-0 text-muted-foreground">{note}</span>}
      <span className={cn('shrink-0 tabular-nums', strong && 'font-medium')}>{amount}</span>
    </button>
  )
}

/** A line under a total that only says something: what has not left yet, what is owed on a card. */
function Said({ label, amount, testId }: { label: string; amount?: string; testId?: string }) {
  return (
    <p className="flex min-h-6 items-center gap-2 px-1.5 pl-5 text-muted-foreground" data-testid={testId}>
      <span className="min-w-0 flex-1">{label}</span>
      {amount && <span className="shrink-0 tabular-nums">{amount}</span>}
    </p>
  )
}

/**
 * The totals beside the Payments list (above it on a phone and a tablet): what each account has to carry in the
 * month and how it leaves, then who pays. A credit card stands with what was bought on it, what is owed at the end of
 * the month and the payment that pays it off. Every sum is a switch that leaves only its payments in the list. Each
 * of the two panels folds when its title is pressed, and the device remembers it: on a phone they stand above the list.
 */
export function PaymentTotals({ data, filter, onFilter, locale, className }: {
  data: Payments
  filter: PaymentFilter | null
  onFilter: (f: PaymentFilter | null) => void
  locale: string
  className?: string
}) {
  const money = (v: number, currency = data.currency) => formatAmount(v, currency, locale)
  const press = (f: PaymentFilter) => onFilter(sameFilter(filter, f) ? null : f)
  const month = formatMonth(data.month, locale, 'long')
  const [folded, setFolded] = useState(() => ({ accounts: readPref('payments.fold.accounts', false), people: readPref('payments.fold.people', false) }))
  const fold = (which: 'accounts' | 'people') => (to: boolean) => {
    setFolded((f) => ({ ...f, [which]: to }))
    writePref(`payments.fold.${which}`, to)
  }

  const account = (a: PaymentAccountTotal) => {
    const own: PaymentFilter = { kind: 'account', accountId: a.accountId }
    const paidBy = (a.paidBy ?? []).map((id) => data.payments.find((p) => p.id === id)).filter((p) => p != null)
    return (
      <li key={a.accountId ?? 'none'} className="py-1" data-account-total={a.label}>
        <TotalRow
          strong label={a.label} amount={money(a.total)} note={a.card ? 'bought' : undefined} pressed={sameFilter(filter, own)} onPress={() => press(own)}
          said={`${a.label}: ${money(a.total)}${a.card ? ' bought on it' : ` leaves it, ${money(a.left)} still to leave`}`}
        />
        {!a.card && a.total !== 0 && <Said label={a.left === 0 ? 'all of it has left' : 'still to leave'} amount={a.left === 0 ? undefined : money(a.left)} testId="still-to-leave" />}
        {a.methods.map((m) => {
          const f: PaymentFilter = { kind: 'method', accountId: a.accountId, methodId: m.methodId }
          return (
            <TotalRow
              key={m.methodId ?? 'none'} inner label={m.label} amount={money(m.total)} pressed={sameFilter(filter, f)} onPress={() => press(f)}
              said={`${m.label} on ${a.label}: ${money(m.total)}, ${m.count} ${m.count === 1 ? 'payment' : 'payments'}`}
            />
          )
        })}
        {a.card && a.owed && <Said label={`${a.owed.amount < 0 ? 'In credit' : 'Owed'} at the end of ${month}`} amount={money(Math.abs(a.owed.amount), a.owed.currency)} testId="card-owed" />}
        {a.card && paidBy.map((p) => (
          <Said key={p.id} label={`Paid off by "${p.label}"${p.day != null ? ` on the ${ordinalDay(p.day)}` : ''}${p.done ? ', done' : ''}`} amount={money(p.amount)} testId="card-paid-by" />
        ))}
        {a.card && paidBy.length === 0 && <Said label={`Nothing pays it off in ${month}.`} testId="card-paid-by" />}
      </li>
    )
  }

  // one line that says "Household" for everything tells nothing
  const people = data.people.length > 1 || data.people.some((p) => p.ownerId != null) ? data.people : []
  return (
    <div className={cn('grid grid-cols-1 items-start gap-4 sm:grid-cols-2 lg:grid-cols-1', className)}>
      <Island air tone={HUES.transfer} title="By account and method" help="payments.totals" data-testid="payment-totals" folded={folded.accounts} onFold={fold('accounts')} className={cn(people.length === 0 && 'sm:col-span-2 lg:col-span-1')}>
        <ul className="-mx-1.5 divide-y divide-border/60 text-sm md:text-xs">{data.accounts.map(account)}</ul>
      </Island>
      {people.length > 0 && (
        <Island air title="By person" help="payments.people" data-testid="payment-people" folded={folded.people} onFold={fold('people')}>
          <ul className="-mx-1.5 text-sm md:text-xs">
            {people.map((p) => {
              const f: PaymentFilter = { kind: 'person', ownerId: p.ownerId }
              return (
                <li key={p.ownerId ?? 'household'}>
                  <TotalRow
                    label={p.label} amount={money(p.total)} pressed={sameFilter(filter, f)} onPress={() => press(f)}
                    note={p.left !== p.total ? `${money(p.left)} open` : undefined}
                    said={`${p.label}: ${money(p.total)}, ${money(p.left)} not done yet`}
                  />
                </li>
              )
            })}
          </ul>
        </Island>
      )}
    </div>
  )
}
