import { generateKeyBetween } from 'fractional-indexing'
import { computeEngine, cellKey, sortRows, type EngineOutput } from '@/engine'
import {
  ACCOUNT_TYPE_INFO, AccountMonthSchema, AccountSchema, CellSchema, HouseholdSchema, MonthStateSchema, PoolSchema, RowSchema, addMonths, canCarryRule, canTakeRest, cardIsItemized, compareMonths, isOldPocketShare, isShareRule, monthKey, monthOfDate, monthRange, newId, parseMonth, poolIdOf, resolveRules, sharePercent,
  type Account, type Category, type Cell, type CellInput, type CellItem, type FundedBy, type Household, type ItemStatus, type Money, type MonthKey, type Pool, type Row, type RowKind, type Tables,
} from '@/model'
import type { Mutation, Store } from './store'
import { planEnd } from './months'

export type EditScope = 'this-month' | 'from-now-on'

const now = () => Date.now()

/** Read every data table once. Cheap at household scale. */
export async function loadTables(store: Store): Promise<Tables> {
  const out: Record<string, unknown[]> = {}
  for (const t of store.db.dataTables) out[t] = await store.db.table(t).toArray()
  return out as unknown as Tables
}

async function engineUpTo(store: Store, month: MonthKey): Promise<{ tables: Tables; engine: EngineOutput; household: Household }> {
  const tables = await loadTables(store)
  const household = tables.household.find((h) => !h.deletedAt)
  if (!household) throw new Error('No household yet')
  const start = compareMonths(household.startMonth, month) < 0 ? household.startMonth : month
  const engine = computeEngine({ tables, months: monthRange(start, addMonths(month, 1)) })
  return { tables, engine, household }
}

function assertOpen(tables: Tables, month: MonthKey): void {
  if (tables.monthStates.find((s) => s.month === month)?.closed) throw new Error(`${month} is closed. Reopen it to edit.`)
}

function cellOf(tables: Tables, rowId: string, month: MonthKey): Cell | undefined {
  return tables.cells.find((c) => c.rowId === rowId && c.month === month)
}

const putCell = (cell: CellInput): Mutation => ({ op: 'put', table: 'cells', record: CellSchema.parse({ ...cell, updatedAt: now() }) })

// ---------- cells ----------

/**
 * Set a plain value. `from-now-on` lets later inheriting months follow;
 * `this-month` freezes the next month at the old value so the chain continues as before.
 */
/** When editing only this month, pin the following month at the old value if it was inheriting. */
function freezeNext(tables: Tables, engine: EngineOutput, rowId: string, month: MonthKey): Mutation[] {
  // a scheduled row never carries forward, so there is nothing to freeze (and a value cell there would post a phantom amount)
  if (engine.recurringRowIds.includes(rowId)) return []
  const next = addMonths(month, 1)
  const nextCell = cellOf(tables, rowId, next)
  const current = engine.cells[cellKey(rowId, month)]
  if (!current) return []
  if (nextCell && nextCell.mode !== 'inherit') return []
  // A row that had no amount yet goes back to none after this month: without the zero the new amount would carry on.
  // A category's estimate carries what was typed, not what its rows have left of it.
  const held = current.source === 'empty' ? 0 : current.estimate ?? current.value
  return [putCell({ rowId, month: next, mode: 'value', value: held, items: [], note: null, currencyOverride: null, updatedAt: now() })]
}

export async function setCellValue(store: Store, rowId: string, month: MonthKey, value: Money, scope: EditScope): Promise<void> {
  const { tables, engine } = await engineUpTo(store, month)
  assertOpen(tables, month)
  const mutations: Mutation[] = scope === 'this-month' ? freezeNext(tables, engine, rowId, month) : []
  const existing = cellOf(tables, rowId, month)
  mutations.push(putCell({ rowId, month, mode: 'value', value, items: [], note: existing?.note ?? null, currencyOverride: existing?.currencyOverride ?? null, updatedAt: now() }))
  await store.commit(mutations)
}

export async function setCellItems(store: Store, rowId: string, month: MonthKey, items: CellItem[], scope: EditScope = 'from-now-on'): Promise<void> {
  const { tables, engine } = await engineUpTo(store, month)
  assertOpen(tables, month)
  const mutations: Mutation[] = scope === 'this-month' ? freezeNext(tables, engine, rowId, month) : []
  const existing = cellOf(tables, rowId, month)
  mutations.push(putCell({ rowId, month, mode: 'items', value: null, items, note: existing?.note ?? null, currencyOverride: existing?.currencyOverride ?? null, updatedAt: now() }))
  await store.commit(mutations)
}

/** Back to inheriting from the previous month. Stored as an inherit record (not a delete) so the change travels between devices. */
export async function clearCell(store: Store, rowId: string, month: MonthKey): Promise<void> {
  const tables = await loadTables(store)
  assertOpen(tables, month)
  const existing = cellOf(tables, rowId, month)
  if (!existing || existing.mode === 'inherit') return
  await store.commit([putCell({ rowId, month, mode: 'inherit', value: null, items: [], note: existing.note, currencyOverride: existing.currencyOverride, updatedAt: now() })])
}

/** Turn whatever the cell shows into an items list so single entries can be added. */
export function itemsFromCurrent(engineCell: { source: string; value: Money; items: CellItem[] } | undefined, defaultFundedBy: CellItem['fundedBy'], defaultStatus: ItemStatus): CellItem[] {
  if (!engineCell || engineCell.source === 'empty' || engineCell.source === 'archived') return []
  if (engineCell.source === 'items') return engineCell.items.map(({ ...it }) => ({ ...it }))
  if (engineCell.source === 'inherit') {
    return [{ id: newId(), label: '', amount: 0, status: defaultStatus, fundedBy: defaultFundedBy, date: null, note: null, recurringItemId: null, kind: 'carry', skipped: false }]
  }
  return [{ id: newId(), label: '', amount: engineCell.value, status: defaultStatus, fundedBy: defaultFundedBy, date: null, note: null, recurringItemId: null, kind: 'normal', skipped: false }]
}

export async function setItemStatus(store: Store, rowId: string, month: MonthKey, itemId: string, status: ItemStatus): Promise<void> {
  const tables = await loadTables(store)
  assertOpen(tables, month)
  const cell = cellOf(tables, rowId, month)
  if (!cell || cell.mode !== 'items') throw new Error('Cell has no items')
  if (!cell.items.some((it) => it.id === itemId)) throw new Error('That item is gone.')
  await store.commit([putCell({ ...cell, items: cell.items.map((it) => (it.id === itemId ? { ...it, status } : it)) })])
}

// ---------- rows ----------

/** The category a row sorts under: a live category of its own section, or none. */
function groupKey(tables: Tables, r: Pick<Row, 'section' | 'categoryId'>): string | null {
  const c = r.categoryId ? tables.categories.find((x) => x.id === r.categoryId && !x.deletedAt) : undefined
  return c && c.section === r.section ? c.id : null
}

/** The rows a row is placed among: its section and its category group, in display order. */
function groupRows(tables: Tables, r: Pick<Row, 'section' | 'categoryId'>): Row[] {
  const key = groupKey(tables, r)
  return sortRows(tables.rows.filter((x) => !x.deletedAt && x.section === r.section && groupKey(tables, x) === key), tables.categories)
}

/** The put for a new row at the end of its group, or right after `afterRowId`; the caller commits. */
export function newRowMutation(tables: Tables, input: Partial<Row> & { name: string; section: Row['section'] }, afterRowId?: string): { row: Row; mutation: Mutation } {
  const after = afterRowId ? tables.rows.find((r) => r.id === afterRowId && !r.deletedAt) : undefined
  const categoryId = input.categoryId !== undefined ? input.categoryId : after?.categoryId ?? null
  if (categoryId && groupKey(tables, { section: input.section, categoryId }) === null) throw new Error('That category is not in this section.')
  const list = groupRows(tables, { section: input.section, categoryId })
  let prev: string | null = list.length ? list[list.length - 1].order : null
  let next: string | null = null
  if (after) {
    const i = list.findIndex((r) => r.id === after.id)
    if (i >= 0) {
      prev = list[i].order
      next = list[i + 1]?.order ?? null
    }
  }
  const ts = now()
  const row = RowSchema.parse({ id: newId(), createdAt: ts, updatedAt: ts, ...input, categoryId, order: generateKeyBetween(prev, next) })
  return { row, mutation: { op: 'put', table: 'rows', record: row } }
}

/** Add a row at the end of its category group, or right after `afterRowId`, whose category it inherits unless given one. */
export async function addRow(store: Store, input: Partial<Row> & { name: string; section: Row['section'] }, afterRowId?: string): Promise<Row> {
  const { row, mutation } = newRowMutation(await loadTables(store), input, afterRowId)
  await store.commit([mutation])
  return row
}

/**
 * What a new row under Transfers does; `plain` just moves money between your accounts, `card-payment` pays a card whose
 * purchases are already expense rows, `from-savings` and `from-investment` take money out of an account into the month.
 */
export type TransferRowKind = 'plain' | 'to-savings' | 'to-investment' | 'pool-allocation' | 'pocket-money' | 'card-payment' | 'from-savings' | 'from-investment'
/** What a new row under Expenses does: a normal expense, or a payment that brings a loan or card down. */
export type ExpenseRowKind = 'plain' | 'pay-off'

/**
 * What a new row can point at: live, unarchived accounts and pool accounts, live adults, and whether the savings plug
 * already has its row. The grid's "Add row" and `addRowOfKind` both read this, so what is offered is what is accepted.
 */
export function rowTargets(tables: Tables, household: Household | undefined) {
  const live = <T extends { deletedAt: number | null; archivedMonth: MonthKey | null }>(xs: T[]) => xs.filter((x) => !x.deletedAt && !x.archivedMonth)
  const accounts = live(tables.accounts)
  const rows = tables.rows.filter((r) => !r.deletedAt)
  return {
    savings: accounts.filter((a) => a.type === 'savings'),
    investments: accounts.filter((a) => a.type === 'investment'),
    /** what a payment row under Expenses brings down: loans, and cards whose payment is the recorded spending */
    payoff: accounts.filter((a) => a.type === 'loan' || (a.type === 'credit-card' && !cardIsItemized(a))),
    /** cards whose purchases are expense rows: their payment is a transfer, so it is offered under Transfers */
    cardsItemized: accounts.filter(cardIsItemized),
    /** pool accounts whose row was deleted, so they can be filled again */
    orphanPools: live(tables.pools).filter((p) => !p.allocationRowId || !rows.some((r) => r.id === p.allocationRowId)),
    adults: live(tables.entities).filter((e) => e.kind === 'adult'),
    /** the rest of the month already has its row: a further "to savings" row gets a fixed amount of its own */
    plugTaken: !!household && resolveRules(sortRows(rows, tables.categories), household.closingRule).restRowId !== null,
  }
}

export interface RowOfKindInput {
  section: 'expense' | 'transfer'
  name: string
  categoryId: string | null
  kind: TransferRowKind | ExpenseRowKind
  accountId?: string | null
  poolId?: string | null
  adultId?: string | null
}

/**
 * "Add row" under Transfers and Expenses. A deposit row needs its account, a pool row the pool account it fills (one
 * that lost its row), pocket money the adult it is for, a payment row the loan or card it brings down; everything is
 * checked here so the grid can say what is missing.
 */
export async function addRowOfKind(store: Store, input: RowOfKindInput): Promise<Row> {
  const tables = await loadTables(store)
  const targets = rowTargets(tables, tables.household.find((h) => !h.deletedAt))
  const transferOnly: string[] = ['to-savings', 'to-investment', 'pool-allocation', 'pocket-money', 'card-payment', 'from-savings', 'from-investment']
  if ((input.section === 'expense' && transferOnly.includes(input.kind)) || (input.section === 'transfer' && input.kind === 'pay-off')) {
    throw new Error('That kind of row does not belong in this section.')
  }
  const base: Partial<Row> & { name: string; section: Row['section'] } = { name: input.name, section: input.section, categoryId: input.categoryId, kind: input.kind === 'pay-off' ? 'plain' : input.kind }
  if (input.kind !== 'plain') base.defaultStatus = 'committed'
  if (input.kind === 'pay-off') {
    const acc = tables.accounts.find((a) => a.id === input.accountId && !a.deletedAt)
    if (!acc) throw new Error('Pick the loan or card this row pays off.')
    if (acc.archivedMonth) throw new Error(`"${acc.name}" is archived.`)
    if (cardIsItemized(acc)) throw new Error(`Purchases on "${acc.name}" are recorded as expense rows, so its payment is a transfer: add it under Transfers with "Pays off a credit card".`)
    if (!targets.payoff.some((a) => a.id === acc.id)) throw new Error(`"${acc.name}" is not a loan or a credit card.`)
    base.kind = acc.type === 'loan' ? 'debt-payment' : 'card-payment'
    base.accountId = acc.id
  } else if (input.kind === 'card-payment') {
    const acc = tables.accounts.find((a) => a.id === input.accountId && !a.deletedAt)
    if (!acc) throw new Error('Pick the card this row pays off.')
    if (acc.archivedMonth) throw new Error(`"${acc.name}" is archived.`)
    if (!targets.cardsItemized.some((a) => a.id === acc.id)) throw new Error(`"${acc.name}" records only its payment, as spending: add it under Expenses with "Pays off a loan or card".`)
    base.accountId = acc.id
  } else if (input.kind === 'to-savings' || input.kind === 'to-investment' || input.kind === 'from-savings' || input.kind === 'from-investment') {
    const acc = checkAccountForRow(tables, { kind: input.kind, name: input.name }, input.accountId ?? null)
    if (acc) base.accountId = acc.id
    // beside the row that takes the rest, a further savings row is typed: said outright, or it would read as idle
    if (input.kind === 'to-savings' && targets.plugTaken) base.rule = 'fixed'
  } else if (input.kind === 'pocket-money') {
    const adult = targets.adults.find((e) => e.id === input.adultId)
    if (!adult) throw new Error('Pick the adult the pocket money is for.')
    Object.assign(base, { scope: adult.id, entityTags: [adult.id], pocketMode: 'fixed' })
  }
  let pool: Pool | undefined
  if (input.kind === 'pool-allocation') {
    const found = tables.pools.find((p) => p.id === input.poolId && !p.deletedAt)
    if (!found) throw new Error('Pick the pool account this row fills.')
    if (found.archivedMonth) throw new Error(`"${found.name}" is archived.`)
    if (!targets.orphanPools.some((p) => p.id === found.id)) throw new Error(`"${found.name}" is already filled by another row.`)
    base.accountId = found.accountId
    pool = found
  }
  const { row, mutation } = newRowMutation(tables, base)
  const mutations: Mutation[] = [mutation]
  if (pool) mutations.push({ op: 'put', table: 'pools', record: PoolSchema.parse({ ...pool, allocationRowId: row.id, updatedAt: now() }) })
  await store.commit(mutations)
  return row
}

// ---------- category estimates ----------

/** The row that carries a category's estimate; the Grid shows it by this name. */
export const estimateRowName = (category: Pick<Category, 'name'>): string => `${category.name} – Not broken down yet`

/** A category's estimate row, archived or not; there is one per category at most. */
export const estimateRowOf = (tables: Tables, categoryId: string): Row | undefined =>
  tables.rows.find((r) => !r.deletedAt && r.kind === 'category-estimate' && r.categoryId === categoryId)

/**
 * The puts that give an expense category its estimate from `month`: the estimate row on first use (at the end of the
 * category, back from the archive if it was there) and its amount for the month. `this-month` holds the following
 * month at what it was before, 0 for a category that had none. `previous` is the estimate the month showed until now.
 * Pure; the caller commits, so a new category and its estimate can be one step.
 */
export function categoryEstimateMutations(tables: Tables, category: Category, month: MonthKey, amount: Money, scope: EditScope, previous: Money = 0): { row: Row; mutations: Mutation[] } {
  if (category.section !== 'expense') throw new Error('Only an expense category can have an estimate.')
  if (!Number.isFinite(amount) || amount < 0) throw new Error('An estimate cannot be below zero.')
  const mutations: Mutation[] = []
  let row = estimateRowOf(tables, category.id)
  if (!row) {
    const made = newRowMutation(tables, { name: estimateRowName(category), section: 'expense', kind: 'category-estimate', categoryId: category.id })
    row = made.row
    mutations.push(made.mutation)
  } else if (row.archivedMonth) {
    row = RowSchema.parse({ ...row, archivedMonth: null, updatedAt: now() })
    mutations.push({ op: 'put', table: 'rows', record: row })
  }
  const existing = cellOf(tables, row.id, month)
  mutations.push(putCell({ rowId: row.id, month, mode: 'value', value: amount, items: [], note: existing?.note ?? null, currencyOverride: null, markedDone: existing?.markedDone, updatedAt: now() }))
  if (scope === 'this-month') {
    const next = addMonths(month, 1)
    const nextCell = cellOf(tables, row.id, next)
    if (!nextCell || nextCell.mode === 'inherit') mutations.push(putCell({ rowId: row.id, month: next, mode: 'value', value: previous, items: [], note: nextCell?.note ?? null, currencyOverride: null, updatedAt: now() }))
  }
  return { row, mutations }
}

/**
 * What an expense category is expected to come to in a month, typed before its rows are known. The category's rows
 * are taken off it and the rest counts as "Not broken down yet"; once they add up to more, they are the category.
 * 0 takes the estimate away from this month on (or for this month only). One commit.
 */
export async function setCategoryEstimate(store: Store, categoryId: string, month: MonthKey, amount: Money, scope: EditScope = 'from-now-on'): Promise<Row> {
  const { tables, engine } = await engineUpTo(store, month)
  assertOpen(tables, month)
  const category = tables.categories.find((c) => c.id === categoryId && !c.deletedAt)
  if (!category) throw new Error('That category no longer exists.')
  const known = estimateRowOf(tables, categoryId)
  const previous = known ? engine.cells[cellKey(known.id, month)]?.estimate ?? 0 : 0
  const { row, mutations } = categoryEstimateMutations(tables, category, month, amount, scope, previous)
  await store.commit(mutations)
  return row
}

/** The row a card's unrecorded spending is booked on: named after the card and paid from it. */
export const unrecordedRowName = (card: Pick<Account, 'name'>): string => `${card.name} – Not recorded`

/**
 * Pin what is really owed on a card and, when that is more than the plan expects, book the difference as that month's
 * spending on the card, so the month's expenses and the debt agree. Only for a card whose purchases are expense rows:
 * on any other card the payment is the recorded spending, and booking purchases as well would count them twice.
 * The difference lands as a done item "Not recorded" on the card's own "<card> – Not recorded" row (made on first use);
 * the following month is held at zero so the amount does not carry forward. One commit, so one undo takes it all back.
 * Returns what was booked, 0 when the real balance is not above the expected one.
 */
export async function setCardBalanceBooked(store: Store, accountId: string, month: MonthKey, actualBalance: Money): Promise<Money> {
  const { tables, engine, household } = await engineUpTo(store, month)
  assertOpen(tables, month)
  const card = tables.accounts.find((a) => a.id === accountId && !a.deletedAt)
  if (!card || !cardIsItemized(card)) throw new Error('Only a card whose purchases are expense rows can count a difference as spending.')
  const expected = engine.accounts[card.id]?.months[month]?.computed
  if (expected == null) throw new Error(`"${card.name}" has no balance in ${month}.`)
  const extra = actualBalance - expected
  const mutations: Mutation[] = []
  if (extra > 0) {
    const name = unrecordedRowName(card)
    let row = tables.rows.find((r) => !r.deletedAt && !r.archivedMonth && r.section === 'expense' && r.kind === 'plain' && r.accountId === card.id && r.name === name)
    if (!row) {
      const made = newRowMutation(tables, { name, section: 'expense', categoryId: null, accountId: card.id, currency: card.currency === household.baseCurrency ? null : card.currency, defaultStatus: 'committed' })
      row = made.row
      mutations.push(made.mutation)
    }
    const existing = cellOf(tables, row.id, month)
    const kept: CellItem[] = existing?.mode === 'items' ? [...existing.items]
      : existing?.mode === 'value' && existing.value ? [{ id: newId(), label: '', amount: existing.value, status: row.defaultStatus, fundedBy: row.defaultFundedBy, date: null, note: null, recurringItemId: null, kind: 'normal', skipped: false }]
      : []
    const booked: CellItem = { id: newId(), label: 'Not recorded', amount: extra, status: 'done', fundedBy: 'cash', date: null, note: null, recurringItemId: null, kind: 'normal', skipped: false }
    mutations.push(putCell({ rowId: row.id, month, mode: 'items', value: null, items: [...kept, booked], note: existing?.note ?? null, currencyOverride: existing?.currencyOverride ?? null, updatedAt: now() }))
    const next = addMonths(month, 1)
    const nextCell = cellOf(tables, row.id, next)
    if (!nextCell || nextCell.mode === 'inherit') mutations.push(putCell({ rowId: row.id, month: next, mode: 'value', value: 0, items: [], note: nextCell?.note ?? null, currencyOverride: nextCell?.currencyOverride ?? null, updatedAt: now() }))
  }
  const known = tables.accountMonths.find((a) => a.accountId === accountId && a.month === month)
  mutations.push({ op: 'put', table: 'accountMonths', record: AccountMonthSchema.parse({ ...known, accountId, month, actualBalance, updatedAt: now() }) })
  await store.commit(mutations)
  return Math.max(0, extra)
}

export async function updateRow(store: Store, rowId: string, patch: Partial<Omit<Row, 'id' | 'createdAt'>>): Promise<void> {
  const tables = await loadTables(store)
  const row = tables.rows.find((r) => r.id === rowId)
  if (!row) throw new Error('Row not found')
  await store.commit([{ op: 'put', table: 'rows', record: RowSchema.parse({ ...row, ...patch, updatedAt: now() }) }])
}

export const renameRow = (store: Store, rowId: string, name: string) => updateRow(store, rowId, { name })

export async function moveRow(store: Store, rowId: string, direction: 'up' | 'down'): Promise<void> {
  const tables = await loadTables(store)
  const row = tables.rows.find((r) => r.id === rowId)
  if (!row) throw new Error('Row not found')
  const list = groupRows(tables, row)
  const i = list.findIndex((r) => r.id === rowId)
  const j = direction === 'up' ? i - 1 : i + 1
  if (j < 0 || j >= list.length) return
  // place between the neighbour on the far side and the neighbour we jump over
  const far = direction === 'up' ? list[j - 1]?.order ?? null : list[j + 1]?.order ?? null
  const order = direction === 'up' ? generateKeyBetween(far, list[j].order) : generateKeyBetween(list[j].order, far)
  await store.commit([{ op: 'put', table: 'rows', record: RowSchema.parse({ ...row, order, updatedAt: now() }) }])
}

// ---------- months ----------

/** Freeze a month: inherited values become explicit, items become done, settings are pinned. */
export async function closeMonth(store: Store, month: MonthKey): Promise<void> {
  const { tables, engine, household } = await engineUpTo(store, month)
  const mutations: Mutation[] = []
  for (const row of engine.rows) {
    const c = engine.cells[cellKey(row.id, month)]
    if (!c || c.source === 'derived' || c.source === 'archived' || c.source === 'empty') continue
    if (c.source === 'inherit') {
      mutations.push(putCell({ rowId: row.id, month, mode: 'value', value: c.value, items: [], note: null, currencyOverride: null, updatedAt: now() }))
    } else if (c.source === 'items' && c.cell) {
      if (c.cell.items.some((it) => it.status !== 'done' && !it.skipped)) {
        mutations.push(putCell({ ...c.cell, items: c.cell.items.map((it) => (it.skipped ? it : { ...it, status: 'done' })) }))
      }
    }
  }
  const state = tables.monthStates.find((s) => s.month === month)
  mutations.push({
    op: 'put', table: 'monthStates',
    record: MonthStateSchema.parse({
      month, closed: true, closedAt: now(),
      pocketTotalOverride: state?.pocketTotalOverride ?? household.pocketTotal,
      cashBufferOverride: state?.cashBufferOverride ?? household.cashBuffer,
      updatedAt: now(),
    }),
  })
  await store.commit(mutations)
}

export async function reopenMonth(store: Store, month: MonthKey): Promise<void> {
  const tables = await loadTables(store)
  const state = tables.monthStates.find((s) => s.month === month)
  if (!state?.closed) return
  await store.commit([{ op: 'put', table: 'monthStates', record: MonthStateSchema.parse({ ...state, closed: false, closedAt: null, updatedAt: now() }) }])
}

// ---------- household ----------

export interface QuickHousehold {
  name: string
  baseCurrency: string
  locale: string
  startMonth: MonthKey
  closingRule?: Household['closingRule']
}

/** Minimal household: settings, one savings account, a handful of starter rows. */
export async function quickCreateHousehold(store: Store, input: QuickHousehold): Promise<Household> {
  const ts = now()
  const household = HouseholdSchema.parse({ id: newId(), createdAt: ts, updatedAt: ts, ...input })
  const savings: Account = AccountSchema.parse({
    id: newId(), createdAt: ts, updatedAt: ts, name: 'Savings', type: 'savings', currency: input.baseCurrency,
    openingBalance: 0, openingMonth: input.startMonth, tracked: true,
  })
  const starters: Array<Partial<Row> & { name: string; section: Row['section'] }> = [
    { name: 'Salary', section: 'income', kind: 'salary', defaultStatus: 'committed' },
    { name: 'Other income', section: 'income' },
    { name: 'Rent', section: 'expense', defaultStatus: 'committed' },
    { name: 'Groceries', section: 'expense' },
    { name: 'Other', section: 'expense' },
    { name: 'To savings', section: 'transfer', kind: 'to-savings', accountId: savings.id, defaultStatus: 'committed' },
  ]
  let prev: string | null = null
  const rows = starters.map((s) => {
    const order = generateKeyBetween(prev, null)
    prev = order
    return RowSchema.parse({ id: newId(), createdAt: ts, updatedAt: ts, ...s, order })
  })
  await store.commit([
    { op: 'put', table: 'household', record: household },
    { op: 'put', table: 'accounts', record: savings },
    ...rows.map((r): Mutation => ({ op: 'put', table: 'rows', record: r })),
  ])
  return household
}

export async function updateHousehold(store: Store, patch: Partial<Omit<Household, 'id' | 'createdAt'>>): Promise<void> {
  const tables = await loadTables(store)
  const h = tables.household.find((x) => !x.deletedAt)
  if (!h) throw new Error('No household yet')
  await store.commit([{ op: 'put', table: 'household', record: HouseholdSchema.parse({ ...h, ...patch, updatedAt: now() }) }])
}

/** "Add <year>": plan one more calendar year after the last one shown. Stored on the household, so every screen and device shows it. */
export async function addPlanYear(store: Store, today: MonthKey = monthOfDate()): Promise<MonthKey> {
  const tables = await loadTables(store)
  const household = tables.household.find((h) => !h.deletedAt)
  if (!household) throw new Error('No household yet')
  const planUntil = monthKey(parseMonth(planEnd(household, tables, today)).year + 1, 12)
  await store.commit([{ op: 'put', table: 'household', record: HouseholdSchema.parse({ ...household, planUntil, updatedAt: now() }) }])
  return planUntil
}

/** Mark a whole cell done (or back to the row default). Plain values become a single item. */
export async function setCellDone(store: Store, rowId: string, month: MonthKey, done: boolean): Promise<void> {
  const { tables, engine } = await engineUpTo(store, month)
  assertOpen(tables, month)
  const row = tables.rows.find((r) => r.id === rowId)
  if (!row) throw new Error('Row not found')
  const current = engine.cells[cellKey(rowId, month)]
  if (!current || current.source === 'archived') return
  if (current.source === 'derived') return setDerivedDone(store, rowId, month, done)
  const existing = cellOf(tables, rowId, month)
  const status = done ? 'done' : row.defaultStatus
  const items: CellItem[] =
    existing?.mode === 'items'
      ? existing.items.map((it) => (it.skipped ? it : { ...it, status }))
      : current.value === 0
        ? []
        : [{ id: newId(), label: '', amount: current.value, status, fundedBy: row.defaultFundedBy, date: null, note: null, recurringItemId: null, kind: 'normal', skipped: false }]
  if (items.length === 0 && !existing) return
  await store.commit([putCell({ rowId, month, mode: 'items', value: null, items, note: existing?.note ?? null, currencyOverride: existing?.currencyOverride ?? null, updatedAt: now() })])
}

/**
 * Tick an automatic row (the savings plug, a pocket share, a follower) as moved this month, or back. The flag lives on
 * the cell record; the engine keeps working the amount out and only reads the flag for the status.
 */
export async function setDerivedDone(store: Store, rowId: string, month: MonthKey, done: boolean): Promise<void> {
  const tables = await loadTables(store)
  assertOpen(tables, month)
  const existing = cellOf(tables, rowId, month)
  if ((existing?.markedDone ?? false) === done) return
  await store.commit([putCell({
    rowId, month, mode: existing?.mode ?? 'inherit', value: existing?.value ?? null, items: existing?.items ?? [],
    note: existing?.note ?? null, currencyOverride: existing?.currencyOverride ?? null, markedDone: done, updatedAt: now(),
  })])
}

// ---------- monthly defaults with a scope ----------

export type MonthlyDefaultScope = 'from-now-on' | 'this-month' | 'all-open'

/**
 * Change the cash buffer (the cash kept in the account at month end). Closed months are never touched.
 * - 'this-month': an override for that month only; the default stays
 * - 'from-now-on': earlier open months are frozen at what they show now, the default changes
 * - 'all-open': every open month follows the new default (overrides dropped)
 */
export async function setMonthlyDefault(store: Store, value: Money, scope: MonthlyDefaultScope, month: MonthKey): Promise<void> {
  const tables = await loadTables(store)
  const household = tables.household.find((h) => !h.deletedAt)
  if (!household) throw new Error('No household yet')
  const key = 'cashBuffer' as const
  const overrideKey = 'cashBufferOverride' as const
  const states = new Map(tables.monthStates.map((s) => [s.month, s]))
  const ts = now()
  const mutations: Mutation[] = []
  const putState = (m: MonthKey, override: Money | null) => {
    const prev = states.get(m)
    mutations.push({ op: 'put', table: 'monthStates', record: MonthStateSchema.parse({ month: m, closed: false, closedAt: null, ...prev, [overrideKey]: override, updatedAt: ts }) })
  }
  if (scope === 'this-month') {
    if (states.get(month)?.closed) throw new Error('Month is closed')
    putState(month, value)
  } else {
    if (scope === 'from-now-on' && compareMonths(month, household.startMonth) > 0) {
      for (const m of monthRange(household.startMonth, addMonths(month, -1))) {
        const s = states.get(m)
        if (s?.closed || s?.[overrideKey] != null) continue
        putState(m, household[key])
      }
    }
    for (const s of tables.monthStates) {
      if (s.closed || s[overrideKey] == null) continue
      if (scope === 'all-open' || compareMonths(s.month, month) >= 0) putState(s.month, null)
    }
    mutations.push({ op: 'put', table: 'household', record: HouseholdSchema.parse({ ...household, [key]: value, updatedAt: ts }) })
  }
  await store.commit(mutations)
}

// ---------- row sources, accounts and followers ----------

export type RowSourceScope = { from: MonthKey } | 'all-months'

/**
 * Change where a row's single amounts come out of. With `{ from }`, every earlier month that showed
 * an amount is pinned to the old source (as one unlabelled item), so past savings and pool balances stay put.
 */
export async function setRowFundedBy(store: Store, rowId: string, fundedBy: FundedBy, scope: RowSourceScope): Promise<void> {
  const tables = await loadTables(store)
  const row = tables.rows.find((r) => r.id === rowId && !r.deletedAt)
  if (!row) throw new Error('Row not found')
  if (row.section !== 'expense') throw new Error('Only spending rows have a source.')
  await store.commit(planRowFundedBy(tables, row, fundedBy, scope, now()))
}

/** The mutations behind `setRowFundedBy`; archiving a pool account uses them too. */
export function planRowFundedBy(tables: Tables, row: Row, fundedBy: FundedBy, scope: RowSourceScope, ts: number): Mutation[] {
  const poolId = poolIdOf(fundedBy)
  if (poolId && !tables.pools.some((p) => p.id === poolId && !p.deletedAt)) throw new Error('That pool account no longer exists.')
  const mutations: Mutation[] = []
  if (scope !== 'all-months' && fundedBy !== row.defaultFundedBy) {
    const household = tables.household.find((h) => !h.deletedAt)
    if (!household) throw new Error('No household yet')
    if (compareMonths(household.startMonth, scope.from) < 0) {
      // Compute with closed flags lifted so the certainty we store is the real one, not "done because closed".
      const open: Tables = { ...tables, monthStates: tables.monthStates.map((s) => ({ ...s, closed: false })) }
      const months = monthRange(household.startMonth, addMonths(scope.from, -1))
      const engine = computeEngine({ tables: open, months })
      for (const m of months) {
        const c = engine.cells[cellKey(row.id, m)]
        if (!c || (c.source !== 'value' && c.source !== 'inherit') || c.value === 0) continue
        const existing = cellOf(tables, row.id, m)
        const item: CellItem = {
          id: newId(), label: '', amount: c.value, status: c.status === 'derived' ? row.defaultStatus : c.status, fundedBy: row.defaultFundedBy,
          date: null, note: null, recurringItemId: null, kind: 'normal', skipped: false,
        }
        mutations.push({ op: 'put', table: 'cells', record: CellSchema.parse({ rowId: row.id, month: m, mode: 'items', value: null, items: [item], note: existing?.note ?? null, currencyOverride: existing?.currencyOverride ?? null, markedDone: existing?.markedDone ?? false, updatedAt: ts }) })
      }
    }
  }
  mutations.push({ op: 'put', table: 'rows', record: RowSchema.parse({ ...row, defaultFundedBy: fundedBy, updatedAt: ts }) })
  return mutations
}

/** Why a row has no amount of its own to mirror or replace, or null when it is an ordinary row. */
export function derivedRowReason(row: Row, closingRule: Household['closingRule']): string | null {
  if (row.kind === 'category-estimate') return `"${row.name}" is what is left of its category's estimate.`
  const rule = row.rule ?? null
  if (canCarryRule(row) && isShareRule(rule)) {
    return `"${row.name}" is worked out by its rule: ${sharePercent(row.ruleShare ?? 0)} of ${rule === 'share-of-income' ? 'income' : rule === 'share-of-own-income' ? 'their own income' : 'what is left'}.`
  }
  // the row that takes the rest (a transfer to any account), and under the first-savings-row default the idle ones
  // beside it; a savings row with a fixed amount is typed like any other
  const takesRest = closingRule === 'savings-plug' && ((canTakeRest(row) && rule === 'rest') || (row.kind === 'to-savings' && rule !== 'fixed'))
  if (takesRest) return `"${row.name}" is worked out by the app from the rest of the month.`
  if (isOldPocketShare(row)) return `"${row.name}" is a share of the pocket money total the household had before. Give it an amount or a rule of its own: row menu, "Rule…".`
  return null
}

/** Make a row mirror another row's amount month by month (or a share of it, 0.25 for a quarter), or stop with `null`. The row's own cells are kept. */
export async function followRow(store: Store, rowId: string, targetId: string | null, share: number | null = null): Promise<void> {
  const tables = await loadTables(store)
  const row = tables.rows.find((r) => r.id === rowId && !r.deletedAt)
  if (!row) throw new Error('Row not found')
  if (targetId) {
    const household = tables.household.find((h) => !h.deletedAt)
    const rule = household?.closingRule ?? 'savings-plug'
    const own = derivedRowReason(row, rule)
    if (own) throw new Error(`${own} It cannot follow another row.`)
    if (targetId === rowId) throw new Error('A row cannot follow itself.')
    const target = tables.rows.find((r) => r.id === targetId && !r.deletedAt)
    if (!target) throw new Error('Pick a row to follow.')
    const why = derivedRowReason(target, rule)
    if (why) throw new Error(`${why} It cannot be followed.`)
    if (target.followsRowId) throw new Error(`"${target.name}" follows another row itself. Follow that row instead.`)
    if (target.archivedMonth) throw new Error(`"${target.name}" is archived.`)
    if (tables.rows.some((r) => !r.deletedAt && r.followsRowId === rowId)) throw new Error(`Another row already follows "${row.name}". Chains are not supported.`)
    if (share != null && !(share > 0)) throw new Error('A share must be above zero, like 0.25 for a quarter.')
  }
  // the whole amount is stored as null, so "= Salary" and "= 100% of Salary" are one state
  const followShare = targetId && share != null && share !== 1 ? share : null
  await store.commit([{ op: 'put', table: 'rows', record: RowSchema.parse({ ...row, followsRowId: targetId, followShare, updatedAt: now() }) }])
}

/** The scope and tags a row gets when it belongs to `scope`: the person or thing it is scoped to is also among its tags, as templates do it. */
function scopePatch(row: Row, scope: string): Pick<Row, 'scope' | 'entityTags'> {
  const entityTags = row.entityTags.filter((t) => t !== row.scope)
  if (scope !== 'shared' && !entityTags.includes(scope)) entityTags.push(scope)
  return { scope, entityTags }
}

/**
 * Who a row belongs to: 'shared' or a person or thing. An income row takes the rows deducted from it along, since a
 * tax on one person's salary is that person's.
 */
export async function setRowScope(store: Store, rowId: string, scope: string): Promise<void> {
  const tables = await loadTables(store)
  const row = tables.rows.find((r) => r.id === rowId && !r.deletedAt)
  if (!row) throw new Error('Row not found')
  if (scope !== 'shared' && !tables.entities.some((e) => e.id === scope && !e.deletedAt)) throw new Error('That person or thing no longer exists.')
  const ts = now()
  const mutations: Mutation[] = [{ op: 'put', table: 'rows', record: RowSchema.parse({ ...row, ...scopePatch(row, scope), updatedAt: ts }) }]
  if (row.section === 'income') {
    for (const d of tables.rows) if (!d.deletedAt && d.deductedFromRowId === row.id) mutations.push({ op: 'put', table: 'rows', record: RowSchema.parse({ ...d, ...scopePatch(d, scope), updatedAt: ts }) })
  }
  await store.commit(mutations)
}

/** Take a spending row out of an income row (tax, a pension contribution): the income's net is what its owner takes home. `null` undoes it. */
export async function setRowDeductedFrom(store: Store, rowId: string, incomeRowId: string | null): Promise<void> {
  const tables = await loadTables(store)
  const row = tables.rows.find((r) => r.id === rowId && !r.deletedAt)
  if (!row) throw new Error('Row not found')
  if (row.section !== 'expense') throw new Error('Only spending rows can be deducted from an income.')
  let patch: Partial<Row> = { deductedFromRowId: null }
  if (incomeRowId) {
    const target = tables.rows.find((r) => r.id === incomeRowId && !r.deletedAt)
    if (!target || target.section !== 'income') throw new Error('Pick an income row to deduct from.')
    const why = derivedRowReason(target, tables.household.find((h) => !h.deletedAt)?.closingRule ?? 'savings-plug')
    if (why) throw new Error(`${why} Nothing can be deducted from it.`)
    if (target.archivedMonth) throw new Error(`"${target.name}" is archived.`)
    patch = { deductedFromRowId: target.id, ...(target.scope !== 'shared' ? scopePatch(row, target.scope) : {}) }
  }
  await store.commit([{ op: 'put', table: 'rows', record: RowSchema.parse({ ...row, ...patch, updatedAt: now() }) }])
}

const ACCOUNT_TYPE_FOR_KIND: Partial<Record<RowKind, Account['type']>> = {
  'to-savings': 'savings', 'to-investment': 'investment', 'from-investment': 'investment', 'from-savings': 'savings', 'debt-payment': 'loan', 'card-payment': 'credit-card',
}

/** The account type a row of this kind must point at, or null when any account (or none) will do. */
export function accountTypeForRow(row: Pick<Row, 'kind'>): Account['type'] | null {
  return ACCOUNT_TYPE_FOR_KIND[row.kind] ?? null
}

/** Point a row at an account: destination for transfers, the card or loan it pays, the paying account otherwise. */
export async function setRowAccount(store: Store, rowId: string, accountId: string | null): Promise<void> {
  const tables = await loadTables(store)
  const row = tables.rows.find((r) => r.id === rowId && !r.deletedAt)
  if (!row) throw new Error('Row not found')
  checkAccountForRow(tables, row, accountId)
  await updateRow(store, rowId, { accountId })
}

/** The account a row may point at: it must exist, and a typed row (deposits, payments) needs the matching type. */
function checkAccountForRow(tables: Tables, row: Pick<Row, 'kind' | 'name'>, accountId: string | null): Account | null {
  const need = accountTypeForRow(row)
  const label = (t: Account['type']) => ACCOUNT_TYPE_INFO.find((i) => i.value === t)?.label ?? t
  if (!accountId) {
    if (need) throw new Error(`"${row.name}" needs an account of type ${label(need)}.`)
    return null
  }
  const acc = tables.accounts.find((a) => a.id === accountId && !a.deletedAt)
  if (!acc) throw new Error('That account no longer exists.')
  if (acc.archivedMonth) throw new Error(`"${acc.name}" is archived.`)
  if (need && acc.type !== need) throw new Error(`"${row.name}" needs an account of type ${label(need)}, and "${acc.name}" is of type ${label(acc.type)}.`)
  return acc
}
