import { useState } from 'react'
import { Segmented } from '@/components/Segmented'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { formatAmount, formatMonth, ordinalDay } from '@/app/format'
import { useStore } from '@/app/store'
import type { Payment } from '@/engine'
import { useSave } from '@/features/grid/RowDialogs'
import type { Household, MonthKey, Row, Tables } from '@/model'
import { setPaymentOf, type PaymentOf, type PaymentTarget } from '@/store'
import { DaySelect, MethodSelect } from './PaidFields'
import { paymentScopes, scopeValues, startScope, type PaymentScope } from './scope'
import { txt } from '@/i18n'

const T = txt.payments.dialog

/** What a place is called where the dialog offers more than one. */
const SCOPE_LABEL: Record<PaymentScope, string> = { schedule: txt.common.thisAndFollowing, item: txt.common.onlyThisMonth, row: T.thisRowEveryMonth }

/**
 * "Payment" (DESIGN.md §12): the day and the method of one amount, from the Payments page. It opens from a tracked
 * line and from "Track…" on an untracked one. Where the amount stands in more than one place (an item its schedule
 * posted, a month that is one item), "Counts for" says which place is written; the fields then show what that place
 * holds, and their first choice what counts when it holds nothing. Without a day and a method an amount is untracked.
 */
export function PaymentDialog({ payment: p, row, month, tables, household, onClose, onSaved, onAmount }: {
  payment: Payment
  row: Row
  month: MonthKey
  tables: Tables
  household: Household
  onClose: () => void
  /** Saved, before it closes: the line may now stand somewhere else on the page. */
  onSaved: () => void
  /** "Amount…": the amount's own dialog, the one the Statement opens. */
  onAmount: () => void
}) {
  const store = useStore()
  const { locale, baseCurrency } = household
  const scopes = paymentScopes(p)
  const [scope, setScope] = useState<PaymentScope>(() => startScope(p))
  /** What was chosen in each place; a place nothing was chosen in shows what it holds. */
  const [chosen, setChosen] = useState<Partial<Record<PaymentScope, PaymentOf>>>({})
  const { error, busy, save } = useSave(onClose)

  const at = scopeValues(scope, p, row, month, tables)
  const pay = chosen[scope] ?? { day: at.day, methodId: at.methodId }
  const set = (patch: Partial<PaymentOf>) => setChosen((c) => ({ ...c, [scope]: { ...pay, ...patch } }))
  const monthName = formatMonth(month, locale, 'long')
  const fullLabel = p.rowLabel ? `${p.rowLabel}: ${p.label}` : p.label
  const itemId = p.itemId ?? p.soleItemId
  const target: PaymentTarget = scope === 'schedule' && itemId && p.scheduleId
    ? { level: 'schedule', rowId: row.id, month, itemId, scheduleId: p.scheduleId }
    : scope === 'item' && itemId ? { level: 'item', rowId: row.id, month, itemId } : { level: 'row', rowId: row.id, month, itemId }

  /** How far the chosen place reaches. */
  const reach = scope === 'schedule'
    ? T.fromOnWhereverIt(monthName)
    : scope === 'row'
      ? T.forThisRowIn
      : p.scheduleId ? T.forAloneTheOther(monthName) : T.forThisAmountIn(monthName)
  const untracked = (pay.day ?? at.behindDay) == null && (pay.methodId ?? at.behindMethodId) == null
  const noMethods = tables.paymentMethods.every((m) => m.deletedAt || m.archived)

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{T.payment}</DialogTitle>
          <DialogDescription>{fullLabel}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <p className="flex items-center gap-2 text-sm" data-testid="payment-of">
            <span className="min-w-0 flex-1"><span className="tabular-nums">{formatAmount(p.amount, baseCurrency, locale)}</span> <span className="text-muted-foreground">{T.inMonth(monthName)}</span></span>
            <Button size="xs" variant="outline" onClick={onAmount} disabled={busy}>{T.amountMore}</Button>
          </p>
          {scopes.length > 1 && (
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="text-muted-foreground">{T.countsFor}</span>
              <Segmented label={T.countsFor} value={scope} onChange={(v) => setScope(v as PaymentScope)} options={scopes.map((s) => ({ value: s, label: SCOPE_LABEL[s] }))} />
            </div>
          )}
          <div className="grid gap-2 sm:grid-cols-[9rem_minmax(0,1fr)]">
            <div className="space-y-1"><Label htmlFor="payment-day" className="text-xs text-muted-foreground">{txt.common.paidOn}</Label><DaySelect id="payment-day" className="w-full" none={at.noDay} value={pay.day} onChange={(day) => set({ day })} /></div>
            <div className="space-y-1"><Label htmlFor="payment-method" className="text-xs text-muted-foreground">{txt.common.paidWith}</Label><MethodSelect id="payment-method" className="w-full" tables={tables} none={at.noMethod} value={pay.methodId} onChange={(methodId) => set({ methodId })} /></div>
          </div>
          <p className="text-xs text-muted-foreground" data-testid="payment-reach">{txt.payments.fields.withShortMonth(reach, pay.day != null && pay.day > 28 ? ordinalDay(pay.day) : null)}</p>
          {untracked && <p className="text-xs text-muted-foreground" data-testid="payment-untracked">{T.withNoDayAnd}</p>}
          {noMethods && <p className="text-xs text-muted-foreground">{T.noPaymentMethodsYet}</p>}
          {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>{txt.common.cancel}</Button>
          <Button onClick={() => void save(async () => { await setPaymentOf(store, target, pay); onSaved() })} disabled={busy}>{txt.common.save}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
