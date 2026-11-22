import type { Payment, PaymentState } from '@/engine'
import type { Money } from '@/model'

/**
 * What the Payments page shows of a month's payments (`buildPayments`): which of them a pressed sum leaves in view,
 * and under which heading each one stands. Pure, so the page's list can be checked without a browser.
 */

/** A sum that was pressed: one method, or a person. `null` ids are "No method" and the household. */
export type PaymentFilter =
  | { kind: 'method'; methodId: string | null }
  | { kind: 'person'; ownerId: string | null }

export function sameFilter(a: PaymentFilter | null, b: PaymentFilter | null): boolean {
  if (!a || !b) return a === b
  if (a.kind === 'method' && b.kind === 'method') return a.methodId === b.methodId
  if (a.kind === 'person' && b.kind === 'person') return a.ownerId === b.ownerId
  return false
}

/** Whether a tracked payment is one of a pressed sum's. The sums are over what is tracked, so nothing untracked is in any of them. */
export function inFilter(p: Payment, f: PaymentFilter | null): boolean {
  if (!f) return true
  if (!p.tracked) return false
  return f.kind === 'method' ? p.methodId === f.methodId : p.ownerId === f.ownerId
}

/** A heading of the days list. What is untracked stands in a list of its own, below it. */
export type PaymentGroupKey = Exclude<PaymentState, 'untracked'>

export interface PaymentGroup {
  key: PaymentGroupKey
  payments: Payment[]
  total: Money
}

/** The headings, top to bottom: what is late first, what is done last. */
const ORDER: PaymentGroupKey[] = ['overdue', 'today', 'coming', 'open', 'no-day', 'done']

/** What a heading says. In the current month a payment with a day is late, due today or still coming; in any other month it is simply to pay. */
export const GROUP_TITLE: Record<PaymentGroupKey, string> = {
  overdue: 'Overdue',
  today: 'Today',
  coming: 'Coming',
  open: 'To pay',
  'no-day': 'No day',
  done: 'Done',
}

/**
 * The tracked payments under their headings, each heading's by day (the ones without a day last) and, within a day,
 * in the Statement's order. A heading with nothing under it is left out.
 */
export function groupPayments(payments: Payment[]): PaymentGroup[] {
  const byDay = (a: Payment, b: Payment) => (a.day ?? 32) - (b.day ?? 32)
  return ORDER.map((key) => {
    // `sort` is stable: equal days keep the Statement's order
    const list = payments.filter((p) => p.state === key).sort(byDay)
    return { key, payments: list, total: list.reduce((s, p) => s + p.amount, 0) }
  }).filter((g) => g.payments.length > 0)
}
