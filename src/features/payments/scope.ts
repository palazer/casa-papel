import { ordinalDay } from '@/app/format'
import type { Payment } from '@/engine'
import { dayOfDate, payContext, usualMethod, type MonthKey, type Row, type Tables } from '@/model'
import { txt } from '@/i18n'

const T = txt.payments.scope

/**
 * How far a day and a method count when they are saved from the Payments page (the "Payment" dialog): for the row in
 * every month, for a schedule from this month on, or for one item in this month. Pure, so it is checked without a browser.
 */
export type PaymentScope = 'row' | 'schedule' | 'item'

/**
 * The places a payment's day and method can be saved in, the widest first. A row's one amount has only the row. An
 * item that a running schedule posted has its schedule and itself. One item of several has itself; a month that is a
 * single item of its own has the row and itself.
 */
export function paymentScopes(p: Pick<Payment, 'itemId' | 'soleItemId' | 'scheduleId'>): PaymentScope[] {
  if (!p.itemId && !p.soleItemId) return ['row']
  if (p.scheduleId) return ['schedule', 'item']
  return p.itemId ? ['item'] : ['row', 'item']
}

/** The place the dialog opens on: the item where it already says something of its own, else the widest. */
export function startScope(p: Pick<Payment, 'itemId' | 'soleItemId' | 'scheduleId' | 'dayFrom' | 'methodFrom'>): PaymentScope {
  const scopes = paymentScopes(p)
  return scopes.includes('item') && (p.dayFrom === 'item' || p.methodFrom === 'item') ? 'item' : scopes[0]
}

export interface ScopeValues {
  /** What is stored in this place: null where it says nothing. */
  day: number | null
  methodId: string | null
  /** What then counts, as the first choice of each field says it: `No day`, `Usual: 1st`, `As scheduled: 5th`. */
  noDay: string
  noMethod: string
  /** The day and the method that count when this place says nothing; null where nothing stands behind it. */
  behindDay: number | null
  behindMethodId: string | null
}

/**
 * What a place holds for a payment, and what stands behind it (item → schedule → row). The schedule behind an item
 * counts also when it has ended: what it posted still follows it.
 */
export function scopeValues(scope: PaymentScope, p: Pick<Payment, 'itemId' | 'soleItemId'>, row: Row, month: MonthKey, tables: Tables): ScopeValues {
  const ctx = payContext(tables)
  const known = (id: string | null | undefined) => (id && ctx.methods.has(id) ? id : null)
  const usual = { day: row.payDay ?? null, methodId: usualMethod(row, ctx)?.id ?? null }
  if (scope === 'row') return { ...usual, noDay: txt.common.noDay, noMethod: txt.common.noMethod, behindDay: null, behindMethodId: null }

  const itemId = p.itemId ?? p.soleItemId
  const item = tables.cells.find((c) => c.rowId === row.id && c.month === month)?.items.find((i) => i.id === itemId)
  const schedule = item?.recurringItemId ? ctx.schedules.get(item.recurringItemId) : undefined
  const usualName = usual.methodId ? ctx.methods.get(usual.methodId)?.name ?? '' : ''
  if (scope === 'schedule') {
    return {
      day: schedule?.payDay ?? null, methodId: known(schedule?.methodId),
      noDay: usual.day != null ? T.theRowsUsualDay(ordinalDay(usual.day)) : txt.common.noDay,
      noMethod: usual.methodId ? T.theRowsUsualMethod(usualName) : txt.common.noMethod,
      behindDay: usual.day, behindMethodId: usual.methodId,
    }
  }
  const scheduled = { day: schedule?.payDay ?? null, methodId: known(schedule?.methodId) }
  return {
    day: dayOfDate(item?.date, month), methodId: known(item?.methodId),
    noDay: scheduled.day != null ? T.asScheduledDay(ordinalDay(scheduled.day)) : usual.day != null ? T.usualDay(ordinalDay(usual.day)) : txt.common.noDay,
    noMethod: scheduled.methodId ? T.asScheduledMethod(ctx.methods.get(scheduled.methodId)?.name) : usual.methodId ? T.usualMethod(usualName) : txt.common.noMethod,
    behindDay: scheduled.day ?? usual.day, behindMethodId: scheduled.methodId ?? usual.methodId,
  }
}
