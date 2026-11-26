import { txt } from '@/i18n'
import { generateKeyBetween } from 'fractional-indexing'
import {
  HouseholdSchema, PaymentMethodSchema, RowSchema, compareMonths, dateOn, isPaymentRow, methodNote, newId, payContext,
  type Cell, type CellItem, type MonthKey, type PaymentKind, type PaymentMethod, type Tables,
} from '@/model'
import { NO_QUESTION, type Mutation, type Store } from './store'
import { loadTables, withoutRewritten } from './actions'
import { cellPut } from './cells'
import { applyMutations } from './impact'
import { planChangeRecurringFrom } from './recurring'

const now = () => Date.now()

/** "Plan payments by day and method": the household's switch. Turning it off hides the page and the fields; what was set stays. */
export async function setPaymentsOn(store: Store, on: boolean): Promise<void> {
  const tables = await loadTables(store)
  const household = tables.household.find((h) => !h.deletedAt)
  if (!household) throw new Error(txt.errors.noHouseholdYet)
  if (!!household.payments === on) return
  await store.commit([{ op: 'put', table: 'household', record: HouseholdSchema.parse({ ...household, payments: on, updatedAt: now() }) }], NO_QUESTION)
}

// ---------- the list of methods ----------

export interface PaymentMethodInput {
  name: string
  kind: PaymentKind
  ownerEntityId?: string | null
  /** A few words after the name ("main account"); nothing reads them. */
  note?: string
}

function checkMethod(tables: Tables, m: { name: string; ownerEntityId: string | null }): void {
  if (!m.name.trim()) throw new Error(txt.errors.givePaymentMethodName)
  if (m.ownerEntityId && !tables.entities.some((e) => e.id === m.ownerEntityId && !e.deletedAt)) throw new Error(txt.errors.personNoLongerExists)
}

/** Whether an amount, a schedule or a row names the method: such a method is archived, not deleted, so what was paid with it keeps its name. */
export function methodInUse(tables: Pick<Tables, 'rows' | 'recurringItems' | 'cells'>, id: string): boolean {
  return tables.rows.some((r) => !r.deletedAt && r.payMethodId === id)
    || tables.recurringItems.some((r) => !r.deletedAt && r.methodId === id)
    || tables.cells.some((c) => c.items.some((i) => i.methodId === id))
}

function methodPut(tables: Tables, input: PaymentMethodInput, after: string | null, ts: number): { mutation: Mutation; method: PaymentMethod } {
  const fields = { name: input.name.trim(), kind: input.kind, ownerEntityId: input.ownerEntityId ?? null, note: (input.note ?? '').trim() }
  checkMethod(tables, fields)
  const method = PaymentMethodSchema.parse({ id: newId(), createdAt: ts, updatedAt: ts, ...fields, order: generateKeyBetween(after, null) })
  return { mutation: { op: 'put', table: 'paymentMethods', record: method }, method }
}

const lastOrder = (tables: Tables): string | null => tables.paymentMethods.filter((m) => !m.deletedAt).map((m) => m.order).sort().at(-1) ?? null

export async function addPaymentMethod(store: Store, input: PaymentMethodInput): Promise<PaymentMethod> {
  const tables = await loadTables(store)
  const { mutation, method } = methodPut(tables, input, lastOrder(tables), now())
  await store.commit([mutation], NO_QUESTION)
  return method
}

/** Several methods in one step (the starter list): one undo takes them all back. */
export async function addPaymentMethods(store: Store, inputs: PaymentMethodInput[]): Promise<PaymentMethod[]> {
  const tables = await loadTables(store)
  const ts = now()
  let after = lastOrder(tables)
  const made = inputs.map((input) => {
    const one = methodPut(tables, input, after, ts)
    after = one.method.order
    return one
  })
  if (made.length) await store.commit(made.map((m) => m.mutation), NO_QUESTION)
  return made.map((m) => m.method)
}

/**
 * Change a method's name, kind, owner or note, archive it or bring it back. A method from schema 21 that is edited
 * gets its note written (what it showed until then, unless a new one is given) and lets go of its old account.
 */
export async function updatePaymentMethod(store: Store, id: string, patch: Partial<PaymentMethodInput> & { archived?: boolean }): Promise<void> {
  const tables = await loadTables(store)
  const method = tables.paymentMethods.find((m) => m.id === id && !m.deletedAt)
  if (!method) throw new Error(txt.errors.paymentMethodNotFound)
  const note = (patch.note ?? methodNote(method, tables.accounts)).trim()
  const next = { ...method, ...patch, name: (patch.name ?? method.name).trim(), note, accountId: null }
  // an archived method only has to keep saying what it said; one that is offered has to be sound
  if (!next.archived) checkMethod(tables, next)
  await store.commit([{ op: 'put', table: 'paymentMethods', record: PaymentMethodSchema.parse({ ...next, updatedAt: now() }) }], NO_QUESTION)
}

/** Take a method off the list: deleted where nothing uses it, archived (no longer offered, still shown where it is used) otherwise. */
export async function removePaymentMethod(store: Store, id: string): Promise<'deleted' | 'archived'> {
  const tables = await loadTables(store)
  const method = tables.paymentMethods.find((m) => m.id === id && !m.deletedAt)
  if (!method) throw new Error(txt.errors.paymentMethodNotFound)
  const ts = now()
  const used = methodInUse(tables, id)
  const record = PaymentMethodSchema.parse(used ? { ...method, archived: true, updatedAt: ts } : { ...method, deletedAt: ts, updatedAt: ts })
  await store.commit([{ op: 'put', table: 'paymentMethods', record }], NO_QUESTION)
  return used ? 'archived' : 'deleted'
}

/**
 * The methods a household would start with: a direct debit, a standing order and a transfer by hand, noted with the
 * main account's name where there is one; one per credit card, named after it; cash. Without what is there already
 * (the same kind under the same name).
 */
export function starterMethods(tables: Pick<Tables, 'accounts' | 'paymentMethods'>): PaymentMethodInput[] {
  const have = new Set(tables.paymentMethods.filter((m) => !m.deletedAt).map((m) => `${m.kind}|${m.name.trim().toLowerCase()}`))
  const accounts = tables.accounts.filter((a) => !a.deletedAt && !a.archivedMonth).sort((a, b) => (a.order < b.order ? -1 : a.order > b.order ? 1 : 0))
  const main = accounts.find((a) => a.type === 'checking')
  const out: PaymentMethodInput[] = []
  const offer = (kind: PaymentKind, name: string, ownerEntityId: string | null, note: string) => {
    if (!have.has(`${kind}|${name.trim().toLowerCase()}`)) out.push({ kind, name, ownerEntityId, note })
  }
  offer('direct-debit', txt.names.starterMethod.directDebit, null, main?.name ?? '')
  offer('standing-order', txt.names.starterMethod.standingOrder, null, main?.name ?? '')
  offer('transfer', txt.names.starterMethod.transfer, null, main?.name ?? '')
  for (const a of accounts) if (a.type === 'credit-card') offer('credit-card', a.name, a.ownerEntityId, '')
  offer('cash', txt.names.starterMethod.cash, null, '')
  return out
}

// ---------- a row's usual day and method ----------

export interface UsualPayment {
  payDay: number | null
  payMethodId: string | null
}

/**
 * "Usually paid…": the day and the method of a row's amounts, in every month where an item says nothing of its own.
 * It writes the row and nothing else, and moves no figure (rule W1): where its amounts come out of stays
 * "Comes out of".
 */
export function planUsualPayment(tables: Tables, rowId: string, usual: UsualPayment, ts: number): Mutation[] {
  const row = tables.rows.find((r) => r.id === rowId && !r.deletedAt)
  if (!row) throw new Error(txt.errors.rowNotFound)
  if (!isPaymentRow(row)) throw new Error(txt.errors.moneyComesNoPaymentDay(row.name))
  if (usual.payDay != null && !(Number.isInteger(usual.payDay) && usual.payDay >= 1 && usual.payDay <= 31)) throw new Error(txt.errors.dayDayMonth)
  const method = usual.payMethodId ? payContext(tables).methods.get(usual.payMethodId) : null
  if (usual.payMethodId && !method) throw new Error(txt.errors.paymentMethodNoLongerExists)
  if (method?.archived && method.id !== row.payMethodId) throw new Error(txt.errors.archivedPickMethodStillUse(method.name))
  return [{ op: 'put', table: 'rows', record: RowSchema.parse({ ...row, payDay: usual.payDay, payMethodId: method?.id ?? null, updatedAt: ts }) }]
}

/**
 * A save that also changes its row's usual day or method ("Usually paid" in the amount's dialog): what that change
 * writes is added to the save's own mutations, worked out on the data as the save leaves it, so the month just saved
 * is part of what follows the row. One step, one undo. `mutations` as they are when nothing changes.
 */
export function withUsualPayment(tables: Tables, mutations: Mutation[], rowId: string, pay: UsualPayment | undefined, ts: number): Mutation[] {
  if (!pay) return mutations
  const after = applyMutations(tables, mutations)
  const row = after.rows.find((r) => r.id === rowId && !r.deletedAt)
  if (!row) return mutations
  if ((row.payDay ?? null) === pay.payDay && (row.payMethodId ?? null) === pay.payMethodId) return mutations
  const more = planUsualPayment(after, rowId, pay, ts)
  return [...withoutRewritten(mutations, more), ...more]
}

export async function setUsualPayment(store: Store, rowId: string, usual: UsualPayment): Promise<void> {
  const tables = await loadTables(store)
  await store.commit(planUsualPayment(tables, rowId, usual, now()), NO_QUESTION)
}

// ---------- one amount's day and method, from the Payments page ----------

/**
 * What a day and a method are saved for. The row: every month ("Usually paid"); where the month the dialog stands in
 * is one item, `month` and `itemId` name it, and it follows its row again. One item of a month: that month alone. A
 * schedule: from `month` on, where `itemId` is the item it posted in that month.
 */
export type PaymentTarget =
  | { level: 'row'; rowId: string; month?: MonthKey; itemId?: string }
  | { level: 'item'; rowId: string; month: MonthKey; itemId: string }
  | { level: 'schedule'; rowId: string; month: MonthKey; itemId: string; scheduleId: string }

/** A day of the month and a method; null is "none said here", so the next place counts (item → schedule → row). */
export interface PaymentOf {
  day: number | null
  methodId: string | null
}

/**
 * The "Payment" dialog's save: the day and the method of one amount, written where the dialog said they count, and
 * nothing else. No amount, no "Comes out of" and no tick is touched, so no figure moves (rule W1) and nothing is
 * asked about months that are over.
 *
 * Saved for a schedule or for the row, the month the dialog stands in shows what was saved: its own item gives up a
 * day and a method of its own, also when it is ticked. Other months keep what they hold for themselves.
 */
export function planPaymentOf(tables: Tables, target: PaymentTarget, pay: PaymentOf, ts: number): Mutation[] {
  const row = tables.rows.find((r) => r.id === target.rowId && !r.deletedAt)
  if (!row) throw new Error(txt.errors.rowNotFound)
  const cell = target.month ? tables.cells.find((c) => c.rowId === row.id && c.month === target.month) : undefined
  const item = target.itemId ? cell?.items.find((i) => i.id === target.itemId) : undefined
  if (target.itemId && (!cell || cell.mode !== 'items' || !item)) throw new Error(txt.errors.itemGone)
  /** The month's own item as `change` leaves it, in the month's record as `from` holds it. */
  const itemPut = (from: Cell, change: (i: CellItem) => CellItem): Mutation =>
    cellPut(from, { rowId: from.rowId, month: from.month, items: from.items.map((i) => (i.id === target.itemId ? change(i) : i)) }, ts)
  const follows = (i: CellItem): CellItem => ({ ...i, date: null, methodId: null })

  /** The month's own item gives up what it says for itself; nothing to write where it says nothing. */
  const itemFollows = (from: Cell | undefined): Mutation[] => (from && item && (item.date != null || item.methodId != null) ? [itemPut(from, follows)] : [])

  if (target.level === 'row') {
    const same = (row.payDay ?? null) === pay.day && (row.payMethodId ?? null) === pay.methodId
    return [...(same ? [] : planUsualPayment(tables, row.id, { payDay: pay.day, payMethodId: pay.methodId }, ts)), ...itemFollows(cell)]
  }

  if (!isPaymentRow(row)) throw new Error(txt.errors.moneyComesNoPaymentDay(row.name))
  if (pay.day != null && !(Number.isInteger(pay.day) && pay.day >= 1 && pay.day <= 31)) throw new Error(txt.errors.dayDayMonth)
  const schedule = target.level === 'schedule' ? tables.recurringItems.find((r) => r.id === target.scheduleId && !r.deletedAt) : undefined
  const method = pay.methodId ? payContext(tables).methods.get(pay.methodId) : null
  if (pay.methodId && !method) throw new Error(txt.errors.paymentMethodNoLongerExists)
  const had = target.level === 'schedule' ? schedule?.methodId : item?.methodId
  if (method?.archived && method.id !== had) throw new Error(txt.errors.archivedPickMethodStillUse(method.name))

  if (target.level === 'item') {
    const date = pay.day != null ? dateOn(target.month, pay.day) : null
    if ((item!.date ?? null) === date && (item!.methodId ?? null) === (method?.id ?? null)) return []
    return [itemPut(cell!, (i) => ({ ...i, date, methodId: method?.id ?? null }))]
  }

  if (!schedule || schedule.rowId !== row.id || item?.recurringItemId !== schedule.id) throw new Error(txt.errors.scheduleGone)
  if (schedule.endMonth && compareMonths(target.month, schedule.endMonth) > 0) throw new Error(txt.errors.scheduleEnded)
  // a schedule that says this already is left as it is: changing it from a month on would cut it in two for nothing
  if ((schedule.payDay ?? null) === pay.day && (schedule.methodId ?? null) === (method?.id ?? null)) return itemFollows(cell)
  const { mutations } = planChangeRecurringFrom(tables, schedule, target.month, { payDay: pay.day, methodId: method?.id ?? null }, ts)
  // the schedule's change re-points the month's item to the schedule that now covers the month; on top of that the
  // item gives up its own day and method, and whatever the change wrote into a ticked one to keep it as it was
  const after = applyMutations(tables, mutations).cells.find((c) => c.rowId === row.id && c.month === target.month)
  if (!after) return mutations
  const own = itemPut(after, follows)
  return [...withoutRewritten(mutations, [own]), own]
}

export async function setPaymentOf(store: Store, target: PaymentTarget, pay: PaymentOf): Promise<void> {
  const tables = await loadTables(store)
  const mutations = planPaymentOf(tables, target, pay, now())
  if (mutations.length) await store.commit(mutations, NO_QUESTION)
}
