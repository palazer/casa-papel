import { parseMonth, type MonthKey } from './month'
import { isTakenFromAccount } from './rules'
import type { Account, CellItem, PaymentKind, PaymentMethod, RecurringItem, Row, Tables } from './schema'

/**
 * Payments by day and method ("Plan payments by day and method").
 *
 * An amount that leaves can say when it goes out ("Paid on": a day of the month) and how ("Paid with": one of the
 * household's payment methods). Both are said in three places, and the nearest one counts: the item of a month, the
 * schedule that posted it, the row ("Usually paid…").
 *
 * None of it reaches a figure (rule W1). Whose money pays for an amount is "Comes out of" (`fundedBy`), and what is
 * bought on a card is the row's "Paid by card…" (`Row.accountId`, rule C2); a method is a label beside them, for the
 * Payments page alone.
 */

/** What a payment asks of the household: nothing (it goes by itself), an action, or it happens at the till. */
export type PaymentAsk = 'itself' | 'hand' | 'buying'

export const PAYMENT_KIND_INFO: ReadonlyArray<{ value: PaymentKind; label: string; ask: PaymentAsk; help: string }> = [
  { value: 'direct-debit', label: 'Direct debit', ask: 'itself', help: 'Collected from the account by whoever is paid (SEPA). The money has to be there on the day.' },
  { value: 'standing-order', label: 'Standing order', ask: 'itself', help: 'Sent by the bank on a fixed day. The money has to be there on the day.' },
  { value: 'transfer', label: 'Transfer by hand', ask: 'hand', help: 'A transfer you make yourself each time.' },
  { value: 'debit-card', label: 'Debit card', ask: 'buying', help: 'A card that takes the money from its account when you pay.' },
  { value: 'credit-card', label: 'Credit card', ask: 'buying', help: 'Paying with a credit card. For the amount to count as owed on the card, put its row on the card with "Paid by card…".' },
  { value: 'wallet', label: 'Wallet', ask: 'buying', help: 'PayPal, Apple Pay and the like.' },
  { value: 'cash', label: 'Cash', ask: 'hand', help: 'Notes and coins.' },
  { value: 'other', label: 'Other', ask: 'hand', help: 'Any other way of paying.' },
]

export const paymentKindInfo = (kind: PaymentKind) => PAYMENT_KIND_INFO.find((k) => k.value === kind) ?? PAYMENT_KIND_INFO[PAYMENT_KIND_INFO.length - 1]

/**
 * What a method says after its name: the note someone typed, and for a method from schema 21 that has none, the name
 * of the account it was tied to then (a deleted account included: its name is still what the method meant).
 */
export function methodNote(method: Pick<PaymentMethod, 'note' | 'accountId'>, accounts: ReadonlyArray<Pick<Account, 'id' | 'name'>>): string {
  if (method.note != null) return method.note
  return (method.accountId ? accounts.find((a) => a.id === method.accountId)?.name : undefined) ?? ''
}

// ---------- the day ----------

export function daysInMonth(month: MonthKey): number {
  const { year, month: m } = parseMonth(month)
  return new Date(Date.UTC(year, m, 0)).getUTCDate()
}

/** A day of the month as it falls in `month`: a day the month does not have is its last day (the 31st in February). */
export const dayIn = (month: MonthKey, day: number): number => Math.max(1, Math.min(day, daysInMonth(month)))

/** That day as an ISO date. */
export const dateOn = (month: MonthKey, day: number): string => `${month}-${String(dayIn(month, day)).padStart(2, '0')}`

/** The day of an ISO date that lies in `month`; null for a date of another month. */
export function dayOfDate(date: string | null | undefined, month: MonthKey): number | null {
  return date != null && date.slice(0, 7) === month ? Number(date.slice(8, 10)) : null
}

// ---------- which amounts ----------

/** Whether a row's amounts leave: an expense, a deposit, pocket money, a payment to a loan or card, money moved. Not income, not money taken out of an account. */
export const isPaymentRow = (row: Pick<Row, 'section' | 'kind'>): boolean =>
  row.section === 'expense' || (row.section === 'transfer' && !isTakenFromAccount(row))

/**
 * Whether what a row spends can be bought on a card: an ordinary expense row. A payment to a loan or to a card names
 * the debt it pays, and a transfer moves money; neither is a purchase.
 */
export const buysOnCard = (row: Pick<Row, 'section' | 'kind'>): boolean =>
  row.section === 'expense' && row.kind !== 'debt-payment' && row.kind !== 'card-payment'

// ---------- item → schedule → row ----------

export interface PayContext {
  /** Every method that is not deleted, archived ones included: what uses one keeps it. */
  methods: ReadonlyMap<string, PaymentMethod>
  /** Every schedule, removed ones included: an item that was paid outlives the schedule that posted it. */
  schedules: ReadonlyMap<string, RecurringItem>
}

export function payContext(tables: Pick<Tables, 'paymentMethods' | 'recurringItems'>): PayContext {
  return {
    methods: new Map((tables.paymentMethods ?? []).filter((m) => !m.deletedAt).map((m) => [m.id, m])),
    schedules: new Map(tables.recurringItems.map((r) => [r.id, r])),
  }
}

type ItemPay = Pick<CellItem, 'date' | 'methodId' | 'recurringItemId'>
type RowPay = Pick<Row, 'payDay' | 'payMethodId'>

/** The method an item names for itself: its own, else its schedule's. */
function ownMethod(item: ItemPay | null, ctx: PayContext): PaymentMethod | null {
  if (!item) return null
  const id = item.methodId ?? (item.recurringItemId ? ctx.schedules.get(item.recurringItemId)?.methodId : null) ?? null
  return id ? ctx.methods.get(id) ?? null : null
}

/** A row's usual method ("Usually paid…"); null where it names none, or one that is gone. */
export const usualMethod = (row: RowPay, ctx: PayContext): PaymentMethod | null => (row.payMethodId ? ctx.methods.get(row.payMethodId) ?? null : null)

/** The method an amount is paid with: the item's own, else its schedule's, else the row's usual one. `item` is null for an amount without items. */
export const methodOf = (item: ItemPay | null, row: RowPay, ctx: PayContext): PaymentMethod | null => ownMethod(item, ctx) ?? usualMethod(row, ctx)

/** The day of `month` an amount goes out on: the item's own date, else its schedule's day, else the row's usual day. */
export function payDayOf(item: ItemPay | null, row: RowPay, month: MonthKey, ctx: PayContext): number | null {
  const own = dayOfDate(item?.date, month)
  if (own != null) return own
  const day = (item?.recurringItemId ? ctx.schedules.get(item.recurringItemId)?.payDay : null) ?? row.payDay ?? null
  return day != null ? dayIn(month, day) : null
}
