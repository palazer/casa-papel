import { generateKeyBetween } from 'fractional-indexing'
import { sortRows } from '@/engine'
import {
  ENTITY_TEMPLATES, HOUSEHOLD_TEMPLATES, compareMonths, resolveRules, templateTitle,
  type AccountType, type Entity, type Money, type MonthKey, type Row, type RowTemplate, type Section, type Tables,
} from '@/model'
import type { Mutation, Store } from './store'
import { loadTables, updateHousehold } from './actions'
import { buildTemplateMutations } from './householdActions'

/**
 * Setting a household up on the Statement: the rows it is likely to need, offered where they will appear. They come
 * from the row templates, once for the household and once for every person and thing in it. Nothing exists until a
 * suggestion is added; one the household does not want is dismissed and then sits behind "More suggestions".
 */
export interface RowSuggestion {
  /** `<entity id or "household">:<template key>`; what a dismissal stores. */
  id: string
  template: RowTemplate
  entityId: string | null
  /** The row's name once added ("Sam – Salary"). */
  title: string
  description: string
  section: Section
  /** The Statement line it sits under: `income`, `expenses`, `set-aside`, or a category as `cat:<section>:<id>`. */
  place: string
  /** One of the rows most households have: listed first, and its category opens by itself so the offer is seen. */
  usual: boolean
  /** The household said "not for us": the Statement no longer lists it. */
  dismissed: boolean
  /** The type of account it needs and the household does not have yet; it cannot be added until one exists. */
  needs: 'savings' | 'investment' | 'loan' | null
  /** It makes a virtual account too: the amount typed with it is what is set aside each month. */
  pool: boolean
}

/** Transfers into a savings or an investment account come from the account's own line and its rule, not from a suggestion. */
const FROM_THE_ACCOUNT = new Set(['h.toSavings', 'h.toInvestments'])
const HOUSEHOLD = 'household'
const byOrder = <T extends { order: string }>(a: T, b: T) => (a.order < b.order ? -1 : a.order > b.order ? 1 : 0)
const sameName = (a: string, b: string) => a.trim().toLocaleLowerCase() === b.trim().toLocaleLowerCase()
const live = <T extends { deletedAt: number | null; archivedMonth?: MonthKey | null }>(xs: T[]) => xs.filter((x) => !x.deletedAt && !x.archivedMonth)

export const suggestionId = (entityId: string | null, key: string) => `${entityId ?? HOUSEHOLD}:${key}`

/** Every row the household could still add from the templates, in the order the Statement lists them. */
export function rowSuggestions(tables: Tables): RowSuggestion[] {
  const household = tables.household.find((h) => !h.deletedAt)
  if (!household) return []
  const dismissed = new Set(household.dismissedSuggestions ?? [])
  // an archived row was wanted once and put away: it is not suggested again; a deleted one is
  const rows = tables.rows.filter((r) => !r.deletedAt)
  const accounts = live(tables.accounts)
  const categories = tables.categories.filter((c) => !c.deletedAt)
  const has = (type: AccountType) => accounts.some((a) => a.type === type)

  const used = (t: RowTemplate, entityId: string | null, title: string) => rows.some((r) => {
    const key = r.templateKey ?? null
    if (key != null) return key === t.key && (r.entityTags[0] ?? null) === entityId
    // rows made before suggestions carried their key: the same name in the same section
    return r.section === t.section && sameName(r.name, title)
  })
  const placeOf = (t: RowTemplate): string => {
    // a loan payment is an expense row, and the Statement lists it with what is set aside and paid off
    if (t.kind === 'debt-payment' || (t.section === 'transfer' && !t.pocket)) return 'set-aside'
    if (t.pocket) return 'expenses'
    if (t.section === 'income') return 'income'
    const category = t.category ? categories.find((c) => c.section === t.section && c.name === t.category) : undefined
    return category ? `cat:${t.section}:${category.id}` : 'expenses'
  }

  const out: RowSuggestion[] = []
  const offer = (t: RowTemplate, entity: Entity | null) => {
    if (FROM_THE_ACCOUNT.has(t.key)) return
    const entityId = entity?.id ?? null
    const title = templateTitle(t, entity?.name)
    if (used(t, entityId, title)) return
    const id = suggestionId(entityId, t.key)
    const needs = t.pool ? (has('savings') ? null : 'savings') : t.account && !has(t.account) ? t.account : null
    out.push({
      id, template: t, entityId, title, description: t.description, section: t.section, place: placeOf(t),
      usual: (t.recommended ?? false) && !dismissed.has(id), dismissed: dismissed.has(id), needs, pool: t.pool ?? false,
    })
  }
  for (const entity of live(tables.entities).sort(byOrder)) for (const t of ENTITY_TEMPLATES[entity.kind]) offer(t, entity)
  for (const t of HOUSEHOLD_TEMPLATES) offer(t, null)
  return out
}

/** What the Statement lists: every suggestion the household has not said no to, the usual ones first. */
export function shownRowSuggestions(tables: Tables): RowSuggestion[] {
  const open = rowSuggestions(tables).filter((s) => !s.dismissed)
  return [...open.filter((s) => s.usual), ...open.filter((s) => !s.usual)]
}

/** An account most households have and this one does not yet: where the money lands, and where the rest can go. */
export interface AccountSuggestion {
  id: string
  name: string
  type: AccountType
  description: string
}

export function accountSuggestions(tables: Tables): AccountSuggestion[] {
  const household = tables.household.find((h) => !h.deletedAt)
  if (!household) return []
  const dismissed = new Set(household.dismissedSuggestions ?? [])
  // an archived account was there once: it is not suggested again
  const accounts = tables.accounts.filter((a) => !a.deletedAt)
  const all: AccountSuggestion[] = []
  if (!accounts.some((a) => a.type === 'checking' || a.type === 'joint')) all.push({ id: 'account:checking', name: 'Main account', type: 'checking', description: 'The current account your income lands in and your bills leave from.' })
  if (!accounts.some((a) => a.type === 'savings')) all.push({ id: 'account:savings', name: 'Savings', type: 'savings', description: 'Where the rest of the month can go. Virtual accounts live inside it.' })
  return all.filter((s) => !dismissed.has(s.id))
}

export type SetupStepKey = 'income' | 'expenses' | 'savings' | 'virtual' | 'investments' | 'debts'
export interface SetupStep {
  key: SetupStepKey
  /** The step's short name, for its number in the guide ("Income"). */
  label: string
  /** What the step asks for is there: its part of the Statement has it. */
  done: boolean
}

/**
 * The guided setup: the main things a household gives the Statement, in the order they build on each other. Savings
 * comes before the virtual accounts because a virtual account sits inside a savings account, and "where the rest
 * goes" needs one too. Every step can be skipped; a step is done when what it asks for exists.
 */
export function setupSteps(tables: Tables): SetupStep[] {
  const household = tables.household.find((h) => !h.deletedAt)
  const rows = live(tables.rows)
  const accounts = live(tables.accounts)
  const rest = household ? resolveRules(sortRows(tables.rows.filter((r) => !r.deletedAt), tables.categories), household.closingRule).restRowId !== null : false
  return [
    { key: 'income', label: 'Income', done: rows.some((r) => r.section === 'income') },
    { key: 'expenses', label: 'Expenses', done: rows.some((r) => r.section === 'expense') },
    { key: 'savings', label: 'Savings', done: rest },
    { key: 'virtual', label: 'Virtual accounts', done: live(tables.pools).length > 0 },
    { key: 'investments', label: 'Investments', done: accounts.some((a) => a.type === 'investment') },
    { key: 'debts', label: 'Loans and cards', done: accounts.some((a) => a.type === 'loan' || a.type === 'credit-card') },
  ]
}

/** A side of the Statement, by its key: the two of the month, the two of the position. */
export type SetupSide = 'in' | 'out' | 'assets' | 'claims'
/**
 * What a step lights on the Statement: whole sides, and single groups by their line id. The second group of Money out
 * is lit with every step that makes an account, because the row that moves the account shows there.
 */
export function setupFocus(step: SetupStepKey): { sides: SetupSide[]; lines: string[] } {
  switch (step) {
    case 'income': return { sides: [], lines: ['income'] }
    case 'expenses': return { sides: [], lines: ['expenses'] }
    case 'debts': return { sides: ['claims'], lines: ['set-aside'] }
    default: return { sides: ['assets'], lines: ['set-aside'] }
  }
}

/**
 * The suggested rows a step offers: those of the part it lights that the step is about. A virtual account is not
 * offered among the expenses of step 2: it waits for its own step, where it is offered under Assets.
 */
export function stepSuggestions(step: SetupStepKey, all: RowSuggestion[]): RowSuggestion[] {
  switch (step) {
    case 'income': return all.filter((s) => s.place === 'income' || s.place.startsWith('cat:income:'))
    case 'expenses': return all.filter((s) => !s.pool && (s.place === 'expenses' || s.place.startsWith('cat:expense:')))
    case 'virtual': return all.filter((s) => s.pool)
    case 'investments': return all.filter((s) => s.place === 'set-aside' && s.template.account === 'investment')
    case 'debts': return all.filter((s) => s.place === 'set-aside' && s.template.account === 'loan')
    default: return []
  }
}

/**
 * Add a suggested row, with its first amount when one was typed: the amount starts in `month` and carries forward.
 * Pure; the caller commits.
 */
export function suggestionMutations(tables: Tables, id: string, opts: { amount?: Money | null; month?: MonthKey } = {}): { mutations: Mutation[]; row: Row } {
  const household = tables.household.find((h) => !h.deletedAt)
  if (!household) throw new Error('No household yet')
  const s = rowSuggestions(tables).find((x) => x.id === id)
  if (!s) throw new Error('That suggestion is no longer there.')
  if (s.needs) throw new Error(`"${s.title}" needs ${s.needs === 'investment' ? 'an investment' : `a ${s.needs}`} account. Add one first.`)
  const amount = opts.amount ?? null
  if (amount != null && (!Number.isFinite(amount) || amount < 0)) throw new Error('The amount cannot be below zero.')
  const month = opts.month ?? household.startMonth
  if (amount != null && amount > 0) {
    if (compareMonths(month, household.startMonth) < 0) throw new Error(`The household starts in ${household.startMonth}.`)
    if (tables.monthStates.find((m) => m.month === month)?.closed) throw new Error(`${month} is closed. Reopen it to edit.`)
  }
  const entity = s.entityId ? tables.entities.find((e) => e.id === s.entityId && !e.deletedAt) : undefined
  const accounts = live(tables.accounts).sort(byOrder)
  // an account of their own comes first (a child's fund for the child's long-term savings)
  const destination = s.template.account
    ? accounts.find((a) => a.type === s.template.account && entity && a.ownerEntityId === entity.id) ?? accounts.find((a) => a.type === s.template.account) ?? null
    : null
  const last = tables.rows.filter((r) => !r.deletedAt).map((r) => r.order).sort().at(-1) ?? null
  return buildTemplateMutations(s.template, { tables, household, entity }, generateKeyBetween(last, null), accounts, { destination, amount, month })
}

/** Add a suggested row; one undoable step. */
export async function addSuggestion(store: Store, id: string, opts: { amount?: Money | null; month?: MonthKey } = {}): Promise<Row> {
  const { mutations, row } = suggestionMutations(await loadTables(store), id, opts)
  await store.commit(mutations)
  return row
}

/** "Not for us": the suggestion leaves the page. Undo brings it back; the row can still be added by hand. */
export async function dismissSuggestion(store: Store, id: string): Promise<void> {
  const household = (await loadTables(store)).household.find((h) => !h.deletedAt)
  if (!household) throw new Error('No household yet')
  const dismissed = household.dismissedSuggestions ?? []
  if (!dismissed.includes(id)) await updateHousehold(store, { dismissedSuggestions: [...dismissed, id] })
}
