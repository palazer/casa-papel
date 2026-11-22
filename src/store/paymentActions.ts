import { generateKeyBetween } from 'fractional-indexing'
import {
  HouseholdSchema, PaymentMethodSchema, RecurringItemSchema, RowSchema, buysOnCard, isPaymentRow, methodAccountReason, newId, payContext, sourceForMethod, usualMethod,
  type CellItem, type PaymentKind, type PaymentMethod, type Tables,
} from '@/model'
import { NO_QUESTION, type Mutation, type Store } from './store'
import { loadTables, withoutRewritten } from './actions'
import { applyMutations } from './impact'
import { cellPut } from './cells'
import { refuseThirdCurrency } from './currencies'

const now = () => Date.now()

/** "Plan payments by day and method": the household's switch. Turning it off hides the page and the fields; what was set stays. */
export async function setPaymentsOn(store: Store, on: boolean): Promise<void> {
  const tables = await loadTables(store)
  const household = tables.household.find((h) => !h.deletedAt)
  if (!household) throw new Error('No household yet')
  if (!!household.payments === on) return
  await store.commit([{ op: 'put', table: 'household', record: HouseholdSchema.parse({ ...household, payments: on, updatedAt: now() }) }], NO_QUESTION)
}

// ---------- the list of methods ----------

export interface PaymentMethodInput {
  name: string
  kind: PaymentKind
  accountId: string
  ownerEntityId?: string | null
}

function checkMethod(tables: Tables, m: { name: string; kind: PaymentKind; accountId: string; ownerEntityId: string | null }): void {
  if (!m.name.trim()) throw new Error('Give the payment method a name.')
  const account = tables.accounts.find((a) => a.id === m.accountId && !a.deletedAt)
  if (!account) throw new Error('Pick the account or card the method draws on.')
  if (account.archivedMonth) throw new Error(`"${account.name}" is archived: pick an account that is still open.`)
  const why = methodAccountReason(m.kind, account)
  if (why) throw new Error(why)
  if (m.ownerEntityId && !tables.entities.some((e) => e.id === m.ownerEntityId && !e.deletedAt)) throw new Error('That person no longer exists.')
}

/** Whether an amount, a schedule or a row names the method: such a method keeps its account, and is archived, not deleted. */
export function methodInUse(tables: Pick<Tables, 'rows' | 'recurringItems' | 'cells'>, id: string): boolean {
  return tables.rows.some((r) => !r.deletedAt && r.payMethodId === id)
    || tables.recurringItems.some((r) => !r.deletedAt && r.methodId === id)
    || tables.cells.some((c) => c.items.some((i) => i.methodId === id))
}

function methodPut(tables: Tables, input: PaymentMethodInput, after: string | null, ts: number): { mutation: Mutation; method: PaymentMethod } {
  const fields = { name: input.name.trim(), kind: input.kind, accountId: input.accountId, ownerEntityId: input.ownerEntityId ?? null }
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
 * Change a method's name, kind or owner, archive it or bring it back. The account it draws on stays once something
 * uses the method: on that account hangs whether past amounts count as bought on a card (rule C2) and which account
 * they left. A method for another account is a new method.
 */
export async function updatePaymentMethod(store: Store, id: string, patch: Partial<PaymentMethodInput> & { archived?: boolean }): Promise<void> {
  const tables = await loadTables(store)
  const method = tables.paymentMethods.find((m) => m.id === id && !m.deletedAt)
  if (!method) throw new Error('Payment method not found')
  const next = { ...method, ...patch, name: (patch.name ?? method.name).trim() }
  if (next.accountId !== method.accountId && methodInUse(tables, id)) {
    throw new Error(`"${method.name}" is in use, so the account it draws on stays as it is. Add a method for the other account, and archive this one when nothing new should use it.`)
  }
  // an archived method only has to keep saying what it said; one that is offered has to be sound
  if (!next.archived) checkMethod(tables, next)
  await store.commit([{ op: 'put', table: 'paymentMethods', record: PaymentMethodSchema.parse({ ...next, updatedAt: now() }) }])
}

/** Take a method off the list: deleted where nothing uses it, archived (no longer offered, still shown where it is used) otherwise. */
export async function removePaymentMethod(store: Store, id: string): Promise<'deleted' | 'archived'> {
  const tables = await loadTables(store)
  const method = tables.paymentMethods.find((m) => m.id === id && !m.deletedAt)
  if (!method) throw new Error('Payment method not found')
  const ts = now()
  const used = methodInUse(tables, id)
  const record = PaymentMethodSchema.parse(used ? { ...method, archived: true, updatedAt: ts } : { ...method, deletedAt: ts, updatedAt: ts })
  await store.commit([{ op: 'put', table: 'paymentMethods', record }], NO_QUESTION)
  return used ? 'archived' : 'deleted'
}

/**
 * The methods a household would start with, from the accounts it has: for the main account and every other current
 * account a direct debit, a standing order and a transfer by hand; one per credit card; cash. Without what is there
 * already (the same kind on the same account).
 */
export function starterMethods(tables: Pick<Tables, 'accounts' | 'paymentMethods'>): PaymentMethodInput[] {
  const have = new Set(tables.paymentMethods.filter((m) => !m.deletedAt).map((m) => `${m.kind}|${m.accountId}`))
  const accounts = tables.accounts.filter((a) => !a.deletedAt && !a.archivedMonth).sort((a, b) => (a.order < b.order ? -1 : a.order > b.order ? 1 : 0))
  const current = [...accounts.filter((a) => a.type === 'checking'), ...accounts.filter((a) => a.type === 'joint')]
  const several = current.length > 1
  const out: PaymentMethodInput[] = []
  const offer = (kind: PaymentKind, name: string, accountId: string, ownerEntityId: string | null) => {
    if (!have.has(`${kind}|${accountId}`)) out.push({ kind, name, accountId, ownerEntityId })
  }
  for (const a of current) {
    const of = several ? ` · ${a.name}` : ''
    offer('direct-debit', `Direct debit${of}`, a.id, a.ownerEntityId)
    offer('standing-order', `Standing order${of}`, a.id, a.ownerEntityId)
    offer('transfer', `Transfer by hand${of}`, a.id, a.ownerEntityId)
  }
  for (const a of accounts) if (a.type === 'credit-card') offer('credit-card', a.name, a.id, a.ownerEntityId)
  for (const a of accounts) if (a.type === 'cash') offer('cash', a.name, a.id, a.ownerEntityId)
  return out
}

// ---------- a row's usual day and method ----------

export interface UsualPayment {
  payDay: number | null
  payMethodId: string | null
}

/**
 * "Usually paid…": the day and the method of a row's amounts, in every month where an item says nothing of its own.
 *
 * A method is how the amount leaves, and two things follow from the account it draws on, for an ordinary expense row:
 * - the row's account is that account, so a method on a card whose purchases are recorded puts the row on that card
 *   (rule C2), and any other method takes it off the card it was on;
 * - a method on cash, on an other current account or on a savings account pays from that account, so "Comes out of"
 *   says that account too: for the row's single amounts, for its schedules and for the items that name no method of
 *   their own. A method on the main account or on a card leaves "Comes out of" as it is.
 *
 * It counts for every month, the ones that are over included, so the store's question for a change to the past asks
 * where a figure of such a month moves. A day moves no figure.
 */
export function planUsualPayment(tables: Tables, rowId: string, usual: UsualPayment, ts: number): Mutation[] {
  const row = tables.rows.find((r) => r.id === rowId && !r.deletedAt)
  if (!row) throw new Error('Row not found')
  if (!isPaymentRow(row)) throw new Error(`"${row.name}" is money that comes in: it has no payment day or method.`)
  if (usual.payDay != null && !(Number.isInteger(usual.payDay) && usual.payDay >= 1 && usual.payDay <= 31)) throw new Error('The day is a day of the month, 1 to 31.')
  const ctx = payContext(tables)
  const method = usual.payMethodId ? ctx.methods.get(usual.payMethodId) : null
  if (usual.payMethodId && !method) throw new Error('That payment method no longer exists.')
  if (method?.archived && method.id !== row.payMethodId) throw new Error(`"${method.name}" is archived: pick a method that is still in use.`)

  const mutations: Mutation[] = []
  let next = { ...row, payDay: usual.payDay, payMethodId: method?.id ?? null }
  if (buysOnCard(row)) {
    // "no method" takes the row off the card its method drew on; a card it was put on before methods existed, and
    // that no method draws on, is not something this dialog showed, so it stays
    next = { ...next, accountId: method ? method.accountId : usualMethod(row, ctx) ? null : row.accountId }
    const source = sourceForMethod(method ?? null, ctx.accounts)
    if (source) {
      next = { ...next, defaultFundedBy: source }
      // what follows the row's method has to come out of the same account: its schedules, and the items of its months
      const followers = new Set<string>()
      for (const s of tables.recurringItems) {
        if (s.deletedAt || s.rowId !== row.id || s.methodId) continue
        followers.add(s.id)
        if (s.fundedBy !== source) mutations.push({ op: 'put', table: 'recurringItems', record: RecurringItemSchema.parse({ ...s, fundedBy: source, updatedAt: ts }) })
      }
      const follows = (i: CellItem) => !i.methodId && (!i.recurringItemId || followers.has(i.recurringItemId) || !ctx.schedules.get(i.recurringItemId)?.methodId)
      for (const c of tables.cells) {
        if (c.rowId !== row.id || !c.items.some((i) => follows(i) && i.fundedBy !== source)) continue
        mutations.push(cellPut(c, { rowId: c.rowId, month: c.month, items: c.items.map((i) => (follows(i) ? { ...i, fundedBy: source } : i)) }, ts))
      }
    }
  }
  mutations.push({ op: 'put', table: 'rows', record: RowSchema.parse({ ...next, updatedAt: ts }) })
  return mutations
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
  const shown = usualMethod(row, payContext(after))?.id ?? null
  if ((row.payDay ?? null) === pay.payDay && shown === pay.payMethodId) return mutations
  const more = planUsualPayment(after, rowId, pay, ts)
  return [...withoutRewritten(mutations, more), ...more]
}

export async function setUsualPayment(store: Store, rowId: string, usual: UsualPayment): Promise<void> {
  const tables = await loadTables(store)
  const mutations = planUsualPayment(tables, rowId, usual, now())
  refuseThirdCurrency(tables, mutations)
  await store.commit(mutations)
}
