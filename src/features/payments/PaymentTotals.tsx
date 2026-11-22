import { useState, type ReactNode } from 'react'
import { Island } from '@/components/ui/island'
import { formatAmount } from '@/app/format'
import { HUES } from '@/app/hues'
import { readPref, writePref } from '@/app/prefs'
import type { Payments } from '@/engine'
import { cn } from '@/lib/utils'
import type { Tables } from '@/model'
import { sameFilter, type PaymentFilter } from './groups'
import { methodDetail } from './methods'

/**
 * A sum that is a switch (DESIGN.md §12): pressed, the list shows only its payments, and it wears the lime's
 * border, the one pressed colour; pressed again, the list shows all.
 */
function TotalRow({ label, detail, amount, note, pressed, onPress, said }: {
  label: string
  /** After the label, muted: a method's note and whose it is. */
  detail?: string
  amount: string; note?: ReactNode; pressed: boolean; onPress: () => void
  /** The accessible name: what it is and what it comes to. */
  said: string
}) {
  return (
    <button
      type="button" aria-pressed={pressed} aria-label={said} onClick={onPress}
      className={cn(
        'flex min-h-11 w-full items-center gap-2 rounded px-1.5 text-left outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring md:min-h-7',
        pressed && 'bg-muted shadow-[inset_0_0_0_2px_var(--color-primary)]',
      )}
    >
      <span className="min-w-0 flex-1 truncate">{label}{detail && <span className="text-muted-foreground"> {detail}</span>}</span>
      {note && <span className="shrink-0 text-muted-foreground">{note}</span>}
      <span className="shrink-0 tabular-nums">{amount}</span>
    </button>
  )
}

/**
 * The sums beside the Payments list (above it on a phone and a tablet), over what is tracked: what is paid with each
 * method, then who pays. Every sum is a switch that leaves only its payments in the list. Each of the two panels
 * folds when its title is pressed, and the device remembers it: on a phone they stand above the list.
 */
export function PaymentTotals({ data, tables, filter, onFilter, locale, className }: {
  data: Payments
  tables: Pick<Tables, 'paymentMethods' | 'accounts' | 'entities'>
  filter: PaymentFilter | null
  onFilter: (f: PaymentFilter | null) => void
  locale: string
  className?: string
}) {
  const money = (v: number) => formatAmount(v, data.currency, locale)
  const press = (f: PaymentFilter) => onFilter(sameFilter(filter, f) ? null : f)
  const [folded, setFolded] = useState(() => ({ methods: readPref('payments.fold.methods', false), people: readPref('payments.fold.people', false) }))
  const fold = (which: 'methods' | 'people') => (to: boolean) => {
    setFolded((f) => ({ ...f, [which]: to }))
    writePref(`payments.fold.${which}`, to)
  }
  /** What of a sum is not ticked yet: nothing said while none of it is, "all done" once all of it is. */
  const open = (t: { total: number; left: number }) => (t.left === 0 ? 'all done' : t.left !== t.total ? `${money(t.left)} open` : undefined)
  const saidOpen = (t: { left: number }) => (t.left === 0 ? 'all done' : `${money(t.left)} not done yet`)
  const methods = new Map(tables.paymentMethods.map((m) => [m.id, m]))

  // one line that says "Household" for everything tells nothing
  const people = data.people.length > 1 || data.people.some((p) => p.ownerId != null) ? data.people : []
  return (
    <div className={cn('grid grid-cols-1 items-start gap-4 sm:grid-cols-2 lg:grid-cols-1', className)}>
      <Island air tone={HUES.transfer} title="By method" help="payments.totals" data-testid="payment-totals" folded={folded.methods} onFold={fold('methods')} className={cn(people.length === 0 && 'sm:col-span-2 lg:col-span-1')}>
        <ul className="-mx-1.5 text-sm md:text-xs">
          {data.methods.map((m) => {
            const f: PaymentFilter = { kind: 'method', methodId: m.methodId }
            const method = m.methodId ? methods.get(m.methodId) : undefined
            return (
              <li key={m.methodId ?? 'none'} data-method-total={m.label}>
                <TotalRow
                  label={m.label} detail={method ? methodDetail(method, tables) : undefined} amount={money(m.total)} note={open(m)} pressed={sameFilter(filter, f)} onPress={() => press(f)}
                  said={`${m.label}: ${money(m.total)}, ${m.count} ${m.count === 1 ? 'payment' : 'payments'}, ${saidOpen(m)}`}
                />
              </li>
            )
          })}
        </ul>
      </Island>
      {people.length > 0 && (
        <Island air title="By person" help="payments.people" data-testid="payment-people" folded={folded.people} onFold={fold('people')}>
          <ul className="-mx-1.5 text-sm md:text-xs">
            {people.map((p) => {
              const f: PaymentFilter = { kind: 'person', ownerId: p.ownerId }
              return (
                <li key={p.ownerId ?? 'household'}>
                  <TotalRow
                    label={p.label} amount={money(p.total)} note={open(p)} pressed={sameFilter(filter, f)} onPress={() => press(f)}
                    said={`${p.label}: ${money(p.total)}, ${p.count} ${p.count === 1 ? 'payment' : 'payments'}, ${saidOpen(p)}`}
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
