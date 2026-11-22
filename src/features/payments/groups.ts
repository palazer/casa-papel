import type { Payment, PaymentState } from '@/engine'
import type { Money } from '@/model'

/**
 * What the Payments page shows of a month's payments (`buildPayments`): which of them a pressed total leaves in view,
 * and under which heading each one stands. Pure, so the page's list can be checked without a browser.
 */

/** A total that was pressed: an account, one method on an account, or a person. `null` ids are the "no …" totals. */
export type PaymentFilter =
  | { kind: 'account'; accountId: string | null }
  | { kind: 'method'; accountId: string | null; methodId: string | null }
  | { kind: 'person'; ownerId: string | null }

export function sameFilter(a: PaymentFilter | null, b: PaymentFilter | null): boolean {
  if (!a || !b) return a === b
  if (a.kind === 'account' && b.kind === 'account') return a.accountId === b.accountId
  if (a.kind === 'method' && b.kind === 'method') return a.accountId === b.accountId && a.methodId === b.methodId
  if (a.kind === 'person' && b.kind === 'person') return a.ownerId === b.ownerId
  return false
}

export function inFilter(p: Payment, f: PaymentFilter | null): boolean {
  if (!f) return true
  if (f.kind === 'account') return p.accountId === f.accountId
  if (f.kind === 'method') return p.accountId === f.accountId && p.methodId === f.methodId
  return p.ownerId === f.ownerId
}

export interface PaymentGroup {
  key: PaymentState
  payments: Payment[]
  total: Money
}

/** The headings, top to bottom: what is late first, what is done last. */
const ORDER: PaymentState[] = ['overdue', 'today', 'coming', 'open', 'no-day', 'done']

/** What a heading says. In the current month a payment with a day is late, due today or still coming; in any other month it is simply to pay. */
export const GROUP_TITLE: Record<PaymentState, string> = {
  overdue: 'Overdue',
  today: 'Today',
  coming: 'Coming',
  open: 'To pay',
  'no-day': 'No day yet',
  done: 'Done',
}

/**
 * The payments under their headings, each heading's by day (the ones without a day last) and, within a day, in the
 * Statement's order. A heading with nothing under it is left out.
 */
export function groupPayments(payments: Payment[]): PaymentGroup[] {
  const byDay = (a: Payment, b: Payment) => (a.day ?? 32) - (b.day ?? 32)
  return ORDER.map((key) => {
    // `sort` is stable: equal days keep the Statement's order
    const list = payments.filter((p) => p.state === key).sort(byDay)
    return { key, payments: list, total: list.reduce((s, p) => s + p.amount, 0) }
  }).filter((g) => g.payments.length > 0)
}
