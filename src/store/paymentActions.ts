import { generateKeyBetween } from 'fractional-indexing'
import { HouseholdSchema, PaymentMethodSchema, RowSchema, isPaymentRow, methodNote, newId, payContext, type PaymentKind, type PaymentMethod, type Tables } from '@/model'
import { NO_QUESTION, type Mutation, type Store } from './store'
import { loadTables, withoutRewritten } from './actions'
import { applyMutations } from './impact'

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
  ownerEntityId?: string | null
  /** A few words after the name ("main account"); nothing reads them. */
  note?: string
}

function checkMethod(tables: Tables, m: { name: string; ownerEntityId: string | null }): void {
  if (!m.name.trim()) throw new Error('Give the payment method a name.')
  if (m.ownerEntityId && !tables.entities.some((e) => e.id === m.ownerEntityId && !e.deletedAt)) throw new Error('That person no longer exists.')
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
  if (!method) throw new Error('Payment method not found')
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
  if (!method) throw new Error('Payment method not found')
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
  offer('direct-debit', 'Direct debit', null, main?.name ?? '')
  offer('standing-order', 'Standing order', null, main?.name ?? '')
  offer('transfer', 'Transfer by hand', null, main?.name ?? '')
  for (const a of accounts) if (a.type === 'credit-card') offer('credit-card', a.name, a.ownerEntityId, '')
  offer('cash', 'Cash', null, '')
  return out
}

// ---------- a row's usual day and method ----------

export interface UsualPayment {
  payDay: number | null
  payMethodId: string | null
}

/**
 * "Usually paid…": the day and the method of a row's amounts, in every month where an item says nothing of its own.
 * It writes the row and nothing else, and moves no figure (rule W1): the row's card stays "Paid by card…", and where
 * its amounts come out of stays "Comes out of".
 */
export function planUsualPayment(tables: Tables, rowId: string, usual: UsualPayment, ts: number): Mutation[] {
  const row = tables.rows.find((r) => r.id === rowId && !r.deletedAt)
  if (!row) throw new Error('Row not found')
  if (!isPaymentRow(row)) throw new Error(`"${row.name}" is money that comes in: it has no payment day or method.`)
  if (usual.payDay != null && !(Number.isInteger(usual.payDay) && usual.payDay >= 1 && usual.payDay <= 31)) throw new Error('The day is a day of the month, 1 to 31.')
  const method = usual.payMethodId ? payContext(tables).methods.get(usual.payMethodId) : null
  if (usual.payMethodId && !method) throw new Error('That payment method no longer exists.')
  if (method?.archived && method.id !== row.payMethodId) throw new Error(`"${method.name}" is archived: pick a method that is still in use.`)
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
