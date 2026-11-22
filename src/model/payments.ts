import { paysExpenses } from './accountGroup'
import { cardIsItemized } from './cards'
import { accountRef, type FundedBy } from './fundedBy'
import { parseMonth, type MonthKey } from './month'
import { isTakenFromAccount } from './rules'
import type { Account, CellItem, PaymentKind, PaymentMethod, RecurringItem, Row, Tables } from './schema'

/**
 * Payments by day and method ("Plan payments by day and method").
 *
 * An amount that leaves can say when it goes out ("Paid on": a day of the month) and how ("Paid with": one of the
 * household's payment methods, each tied to the account or card it draws on). Both are said in three places, and the
 * nearest one counts: the item of a month, the schedule that posted it, the row ("Usually paid…").
 *
 * Whose money pays for an amount stays "Comes out of" (`fundedBy`); a method says how it physically leaves. One thing
 * about a method reaches a figure: a method that draws on a card whose purchases are recorded means "bought on that
 * card" (rule C2), for the item that names it. Everything else here is for the Payments page.
 */

/** What a payment asks of the household: nothing (it goes by itself), an action, or it happens at the till. */
export type PaymentAsk = 'itself' | 'hand' | 'buying'

export const PAYMENT_KIND_INFO: ReadonlyArray<{ value: PaymentKind; label: string; ask: PaymentAsk; help: string }> = [
  { value: 'direct-debit', label: 'Direct debit', ask: 'itself', help: 'Collected from the account by whoever is paid (SEPA). The money has to be there on the day.' },
  { value: 'standing-order', label: 'Standing order', ask: 'itself', help: 'Sent by the bank on a fixed day. The money has to be there on the day.' },
  { value: 'transfer', label: 'Transfer by hand', ask: 'hand', help: 'A transfer you make yourself each time.' },
  { value: 'debit-card', label: 'Debit card', ask: 'buying', help: 'A card that takes the money from its account when you pay.' },
  { value: 'credit-card', label: 'Credit card', ask: 'buying', help: 'Paying with one of your credit cards: the amount is owed on the card until the card is paid.' },
  { value: 'wallet', label: 'Wallet', ask: 'buying', help: 'PayPal, Apple Pay and the like, drawing on an account or on a card.' },
  { value: 'cash', label: 'Cash', ask: 'hand', help: 'Notes and coins.' },
  { value: 'other', label: 'Other', ask: 'hand', help: 'Any other way of paying.' },
]

export const paymentKindInfo = (kind: PaymentKind) => PAYMENT_KIND_INFO.find((k) => k.value === kind) ?? PAYMENT_KIND_INFO[PAYMENT_KIND_INFO.length - 1]

/** The types of account a payment method can draw on: money you pay from, and credit cards. */
export const METHOD_ACCOUNT_TYPES: ReadonlyArray<Account['type']> = ['checking', 'joint', 'cash', 'savings', 'credit-card']

/** Why a method of this kind cannot draw on this account, or null: a credit card method is a card, and a card is not a bank account. */
export function methodAccountReason(kind: PaymentKind, account: Pick<Account, 'type' | 'name'>): string | null {
  if (!METHOD_ACCOUNT_TYPES.includes(account.type)) return `A payment method cannot draw on "${account.name}": pick a current account, cash, a savings account or a credit card.`
  const card = account.type === 'credit-card'
  if (kind === 'credit-card' && !card) return `A credit card method draws on one of your credit cards, and "${account.name}" is not one.`
  if (card && kind !== 'credit-card' && kind !== 'wallet' && kind !== 'other') return `"${account.name}" is a credit card: the method is a credit card, a wallet that draws on it, or "Other".`
  return null
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
  accounts: ReadonlyMap<string, Account>
}

export function payContext(tables: Pick<Tables, 'paymentMethods' | 'recurringItems' | 'accounts'>): PayContext {
  return {
    methods: new Map((tables.paymentMethods ?? []).filter((m) => !m.deletedAt).map((m) => [m.id, m])),
    schedules: new Map(tables.recurringItems.map((r) => [r.id, r])),
    accounts: new Map(tables.accounts.filter((a) => !a.deletedAt).map((a) => [a.id, a])),
  }
}

type ItemPay = Pick<CellItem, 'date' | 'methodId' | 'recurringItemId'>
type RowPay = Pick<Row, 'section' | 'kind' | 'accountId' | 'payDay' | 'payMethodId'>

/** The method an item names for itself: its own, else its schedule's. */
function ownMethod(item: ItemPay | null, ctx: PayContext): PaymentMethod | null {
  if (!item) return null
  const id = item.methodId ?? (item.recurringItemId ? ctx.schedules.get(item.recurringItemId)?.methodId : null) ?? null
  return id ? ctx.methods.get(id) ?? null : null
}

/**
 * A row's usual method. A row that was put on a card before methods existed ("Paid by card…") names none: it reads
 * as the first method that draws on that card, so the card it counts on and the method it shows are the same thing.
 */
export function usualMethod(row: RowPay, ctx: PayContext): PaymentMethod | null {
  const named = row.payMethodId ? ctx.methods.get(row.payMethodId) : undefined
  if (named) return named
  if (!buysOnCard(row) || !row.accountId || ctx.accounts.get(row.accountId)?.type !== 'credit-card') return null
  let first: PaymentMethod | null = null
  for (const m of ctx.methods.values()) {
    if (m.accountId === row.accountId && !m.archived && (!first || m.order < first.order)) first = m
  }
  return first
}

/** The method an amount is paid with: the item's own, else its schedule's, else the row's usual one. `item` is null for an amount without items. */
export const methodOf = (item: ItemPay | null, row: RowPay, ctx: PayContext): PaymentMethod | null => ownMethod(item, ctx) ?? usualMethod(row, ctx)

/** The day of `month` an amount goes out on: the item's own date, else its schedule's day, else the row's usual day. */
export function payDayOf(item: ItemPay | null, row: RowPay, month: MonthKey, ctx: PayContext): number | null {
  const own = dayOfDate(item?.date, month)
  if (own != null) return own
  const day = (item?.recurringItemId ? ctx.schedules.get(item.recurringItemId)?.payDay : null) ?? row.payDay ?? null
  return day != null ? dayIn(month, day) : null
}

/**
 * The card an amount is bought on (rule C2), where its purchases are recorded: the card the item's own method draws
 * on, and for an item that names no method, or an amount without items, the row's card (`Row.accountId`). An item
 * whose own method draws on something else is not on the row's card.
 */
export function cardOf(item: ItemPay | null, row: RowPay, ctx: PayContext): string | null {
  if (!buysOnCard(row)) return null
  const own = ownMethod(item, ctx)
  const accountId = own ? own.accountId : row.accountId
  const account = accountId ? ctx.accounts.get(accountId) : undefined
  return account && cardIsItemized(account) ? account.id : null
}

/**
 * What "Comes out of" has to say for an expense paid with this method, or null where the method leaves it free. A
 * method on cash, on a current account other than the main one or on a savings account pays from that account, so
 * that is where the expense comes out of. The main account is the month's income, whatever covers it (savings, a
 * virtual account), and a card is paid later: both leave "Comes out of" as it is.
 */
export function sourceForMethod(method: Pick<PaymentMethod, 'accountId'> | null, accounts: ReadonlyMap<string, Account>): FundedBy | null {
  const account = method ? accounts.get(method.accountId) : undefined
  return account && paysExpenses(account) ? accountRef(account.id) : null
}
