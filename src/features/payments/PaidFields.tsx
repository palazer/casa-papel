import { InfoTip } from '@/components/InfoTip'
import { NativeSelect } from '@/components/NativeSelect'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'
import { ordinalDay } from '@/app/format'
import type { Tables } from '@/model'
import { methodChoices, methodOption } from './methods'

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

/** "Paid with": one of the household's payment methods, by name with its note, or the first choice, which names none (see `DaySelect`). */
export function MethodSelect({ tables, value, onChange, none = 'No method', label = 'Paid with', id, className }: {
  tables: Pick<Tables, 'paymentMethods' | 'accounts'>; value: string | null; onChange: (methodId: string | null) => void; none?: string; label?: string; id?: string; className?: string
}) {
  return (
    <NativeSelect id={id} aria-label={id ? undefined : label} className={cn('min-w-0', className)} value={value ?? ''} onChange={(e) => onChange(e.target.value || null)}>
      <option value="">{none}</option>
      {methodChoices(tables, value).map((m) => <option key={m.id} value={m.id}>{methodOption(m, tables)}</option>)}
    </NativeSelect>
  )
}

/**
 * "Usually paid": the day and the method of a row's amounts, in every month where an item says nothing of its own.
 * The amount's dialog shows it under the amount, the row menu on its own; `says` is the sentence about where it counts.
 */
export function UsualPaidFields({ tables, day, methodId, onDay, onMethod, says, idPrefix = 'usual', titled = false }: {
  tables: Pick<Tables, 'paymentMethods' | 'accounts'>
  day: number | null; methodId: string | null; onDay: (day: number | null) => void; onMethod: (methodId: string | null) => void
  says: string; idPrefix?: string
  /** The dialog's own title says "Usually paid" already: the heading is then for a screen reader alone. */
  titled?: boolean
}) {
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
    </fieldset>
  )
}

