import { InfoTip } from '@/components/InfoTip'
import { NativeSelect } from '@/components/NativeSelect'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'
import { ordinalDay } from '@/app/format'
import { buysOnCard, cardIsItemized, paymentKindInfo, sourceForMethod, type Account, type PaymentMethod, type Row, type Tables } from '@/model'

const byOrder = <T extends { order: string }>(a: T, b: T) => (a.order < b.order ? -1 : a.order > b.order ? 1 : 0)
const DAYS = Array.from({ length: 31 }, (_, i) => i + 1)

/**
 * "Paid on": a day of the month, or the first choice, which names nothing. `none` is what that first choice says:
 * `No day` where nothing stands behind it, `Usual: 1st` on an item that then follows its row, `As scheduled: 5th`
 * on one that follows its schedule.
 */
export function DaySelect({ value, onChange, none = 'No day', label = 'Paid on', id, className }: {
  value: number | null; onChange: (day: number | null) => void; none?: string; label?: string; id?: string; className?: string
}) {
  return (
    <NativeSelect id={id} aria-label={id ? undefined : label} className={cn('min-w-0', className)} value={value ?? ''} onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}>
      <option value="">{none}</option>
      {DAYS.map((d) => <option key={d} value={d}>{ordinalDay(d)}</option>)}
    </NativeSelect>
  )
}

/** The methods that can be chosen now, under the account each draws on: not archived, and on an account that is still open. `keep` stays offered whatever it is. */
export function methodGroups(tables: Pick<Tables, 'paymentMethods' | 'accounts'>, keep: string | null = null): Array<{ account: string; methods: PaymentMethod[] }> {
  const accounts = tables.accounts.filter((a) => !a.deletedAt).sort((a, b) => (a.type === 'checking' ? 0 : 1) - (b.type === 'checking' ? 0 : 1) || byOrder(a, b))
  const groups: Array<{ account: string; methods: PaymentMethod[] }> = []
  for (const account of accounts) {
    const methods = tables.paymentMethods
      .filter((m) => !m.deletedAt && m.accountId === account.id && (m.id === keep || (!m.archived && !account.archivedMonth)))
      .sort(byOrder)
    if (methods.length) groups.push({ account: account.name, methods })
  }
  return groups
}

/** "Paid with": one of the household's payment methods, grouped by the account it draws on, or the first choice, which names none (see `DaySelect`). */
export function MethodSelect({ tables, value, onChange, none = 'No method', label = 'Paid with', id, className }: {
  tables: Pick<Tables, 'paymentMethods' | 'accounts'>; value: string | null; onChange: (methodId: string | null) => void; none?: string; label?: string; id?: string; className?: string
}) {
  const groups = methodGroups(tables, value)
  return (
    <NativeSelect id={id} aria-label={id ? undefined : label} className={cn('min-w-0', className)} value={value ?? ''} onChange={(e) => onChange(e.target.value || null)}>
      <option value="">{none}</option>
      {groups.map((g) => (
        <optgroup key={g.account} label={g.account}>
          {g.methods.map((m) => <option key={m.id} value={m.id}>{m.name}{m.archived ? ' (archived)' : ''}</option>)}
        </optgroup>
      ))}
    </NativeSelect>
  )
}

/** A method as a few words: its name, and what kind it is where the name does not say. */
export const methodWords = (m: PaymentMethod): string => {
  const kind = paymentKindInfo(m.kind).label
  return m.name.toLowerCase().includes(kind.toLowerCase()) ? m.name : `${m.name} (${kind.toLowerCase()})`
}

/** What follows from paying a row's amounts with a method, in a sentence each: the card it is then bought on, the account it then comes out of. */
export function methodEffects(method: PaymentMethod | null, row: Pick<Row, 'section' | 'kind'>, accounts: ReadonlyMap<string, Account>): string[] {
  const account = method ? accounts.get(method.accountId) : undefined
  if (!account || !buysOnCard(row)) return []
  if (account.type === 'credit-card') {
    return [cardIsItemized(account)
      ? `Bought on "${account.name}": the amount is owed there until the card is paid.`
      : `"${account.name}" records only its payments, so what is owed on it does not move.`]
  }
  return sourceForMethod(method, accounts) ? [`Paid from "${account.name}", so the amount comes out of that account too.`] : []
}

/**
 * "Usually paid": the day and the method of a row's amounts, in every month where an item says nothing of its own.
 * The amount's dialog shows it under the amount, the row menu on its own; `says` is the sentence about where it counts.
 */
export function UsualPaidFields({ tables, row, day, methodId, onDay, onMethod, says, idPrefix = 'usual', titled = false }: {
  tables: Pick<Tables, 'paymentMethods' | 'accounts'>; row: Pick<Row, 'section' | 'kind'>
  day: number | null; methodId: string | null; onDay: (day: number | null) => void; onMethod: (methodId: string | null) => void
  says: string; idPrefix?: string
  /** The dialog's own title says "Usually paid" already: the heading is then for a screen reader alone. */
  titled?: boolean
}) {
  const accounts = new Map(tables.accounts.filter((a) => !a.deletedAt).map((a) => [a.id, a]))
  const method = methodId ? tables.paymentMethods.find((m) => m.id === methodId && !m.deletedAt) ?? null : null
  const none = tables.paymentMethods.every((m) => m.deletedAt || m.archived)
  return (
    <fieldset className="space-y-1.5" data-testid="usually-paid">
      <legend className={cn('text-sm font-medium', titled && 'sr-only')}><span className="inline-flex items-center gap-1">Usually paid {!titled && <InfoTip help="payments.usual" />}</span></legend>
      <div className="grid gap-2 sm:grid-cols-[9rem_minmax(0,1fr)]">
        <div className="space-y-1"><Label htmlFor={`${idPrefix}-day`} className="text-xs text-muted-foreground">Paid on</Label><DaySelect id={`${idPrefix}-day`} className="w-full" value={day} onChange={onDay} /></div>
        <div className="space-y-1"><Label htmlFor={`${idPrefix}-method`} className="text-xs text-muted-foreground">Paid with</Label><MethodSelect id={`${idPrefix}-method`} className="w-full" tables={tables} value={methodId} onChange={onMethod} /></div>
      </div>
      <p className="text-xs text-muted-foreground">{says}{day != null && day > 28 ? ` In a shorter month the ${ordinalDay(day)} is its last day.` : ''}</p>
      {none && <p className="text-xs text-muted-foreground">No payment methods yet: add them under Household → "Payment methods".</p>}
      {methodEffects(method, row, accounts).map((text) => <p key={text} className="text-xs text-muted-foreground" data-testid="method-effect">{text}</p>)}
    </fieldset>
  )
}

