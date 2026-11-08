import { generateKeyBetween } from 'fractional-indexing'
import { computeEngine, cellKey, sortRows, type EngineOutput } from '@/engine'
import {
  ACCOUNT_TYPE_INFO, AccountSchema, CellSchema, HouseholdSchema, MonthStateSchema, RowSchema, addMonths, compareMonths, monthKey, monthOfDate, monthRange, newId, parseMonth, poolIdOf,
  type Account, type Cell, type CellInput, type CellItem, type FundedBy, type Household, type ItemStatus, type Money, type MonthKey, type Row, type RowKind, type Tables,
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
  if (!current || current.source === 'empty') return []
  if (nextCell && nextCell.mode !== 'inherit') return []
  return [putCell({ rowId, month: next, mode: 'value', value: current.value, items: [], note: null, currencyOverride: null, updatedAt: now() })]
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

/** Add a row at the end of its category group, or right after `afterRowId`, whose category it inherits unless given one. */
export async function addRow(store: Store, input: Partial<Row> & { name: string; section: Row['section'] }, afterRowId?: string): Promise<Row> {
  const tables = await loadTables(store)
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
  await store.commit([{ op: 'put', table: 'rows', record: row }])
  return row
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
    { name: 'Salary', section: 'income', kind: 'salary', defaultStatus: 'committed', inShareBasis: true },
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

export interface PaidInput {
  amount: Money
  status: ItemStatus
  date: string | null
  note: string | null
}

const itemSig = (items: CellItem[]) =>
  JSON.stringify(items.map((i) => [i.id, i.label, i.amount, i.status, i.fundedBy, i.date, i.note, i.recurringItemId, i.kind, i.skipped, i.pinned ?? false]))

/**
 * The Month view's "Paid…" sheet: record what actually moved for one line this month. The target is the given item,
 * the cell's single live item, or a plain amount turned into one unlabelled item. Only this month changes: when the
 * amount differs from what the month showed, the next month is frozen at the old amount (never for scheduled rows,
 * which do not carry forward), and a scheduled item with a new amount is pinned so the schedule leaves it alone.
 */
export async function markPaid(store: Store, rowId: string, month: MonthKey, itemId: string | null, input: PaidInput): Promise<void> {
  const { tables, engine, household } = await engineUpTo(store, month)
  assertOpen(tables, month)
  const row = tables.rows.find((r) => r.id === rowId && !r.deletedAt)
  if (!row) throw new Error('Row not found')
  const why = derivedRowReason(row, household.closingRule)
  if (why) throw new Error(`${why} Tick it instead.`)
  if (row.followsRowId) throw new Error(`"${row.name}" follows another row. Tick it instead.`)
  const current = engine.cells[cellKey(rowId, month)]
  if (!current || current.source === 'archived') throw new Error(`"${row.name}" is archived in ${month}.`)
  const existing = cellOf(tables, rowId, month)
  let items: CellItem[] = existing?.mode === 'items' ? [...existing.items] : []
  let target: CellItem | undefined
  if (itemId) {
    target = items.find((i) => i.id === itemId)
    if (!target) throw new Error('That item is gone.')
  } else {
    const live = items.filter((i) => !i.skipped)
    if (live.length > 1) throw new Error('This cell has several items. Pick one.')
    target = live[0]
    if (!target) {
      target = { id: newId(), label: '', amount: current.value, status: row.defaultStatus, fundedBy: row.defaultFundedBy, date: null, note: null, recurringItemId: null, kind: 'normal', skipped: false }
      items.push(target)
    }
  }
  const shown = target.kind === 'carry' ? (current.items.find((i) => i.id === target!.id)?.effectiveAmount ?? 0) : target.amount
  const changed = shown !== input.amount
  const paid: CellItem = {
    ...target, kind: 'normal', amount: input.amount, status: input.status, date: input.date, note: input.note, skipped: false,
    pinned: target.recurringItemId ? target.pinned || changed : target.pinned,
  }
  items = items.map((i) => (i.id === paid.id ? paid : i))
  if (existing?.mode === 'items' && itemSig(items) === itemSig(existing.items)) return
  const mutations: Mutation[] = changed && current.source !== 'empty' ? freezeNext(tables, engine, rowId, month) : []
  mutations.push(putCell({ rowId, month, mode: 'items', value: null, items, note: existing?.note ?? null, currencyOverride: existing?.currencyOverride ?? null, markedDone: existing?.markedDone ?? false, updatedAt: now() }))
  await store.commit(mutations)
}

// ---------- monthly defaults with a scope ----------

export type MonthlyDefaultScope = 'from-now-on' | 'this-month' | 'all-open'

/**
 * Change the pocket money total or the cash buffer. Closed months are never touched.
 * - 'this-month': an override for that month only; the default stays
 * - 'from-now-on': earlier open months are frozen at what they show now, the default changes
 * - 'all-open': every open month follows the new default (overrides dropped)
 */
export async function setMonthlyDefault(store: Store, key: 'pocketTotal' | 'cashBuffer', value: Money, scope: MonthlyDefaultScope, month: MonthKey): Promise<void> {
  const tables = await loadTables(store)
  const household = tables.household.find((h) => !h.deletedAt)
  if (!household) throw new Error('No household yet')
  const overrideKey = key === 'pocketTotal' ? 'pocketTotalOverride' : 'cashBufferOverride'
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
  if (row.kind === 'to-savings' && closingRule === 'savings-plug') return `"${row.name}" is worked out by the app from the rest of the month.`
  if (row.kind === 'pocket-money' && row.pocketMode === 'share-of-pocket-total') return `"${row.name}" is a share of the pocket total.`
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
  await store.commit([{ op: 'put', table: 'rows', record: RowSchema.parse({ ...row, followsRowId: targetId, followShare: targetId ? share : null, updatedAt: now() }) }])
}

/** The scope and tags a row gets when it belongs to `scope`: the person or thing it is scoped to is also among its tags, as templates do it. */
function scopePatch(row: Row, scope: string): Pick<Row, 'scope' | 'entityTags'> {
  const entityTags = row.entityTags.filter((t) => t !== row.scope)
  if (scope !== 'shared' && !entityTags.includes(scope)) entityTags.push(scope)
  return { scope, entityTags }
}

/**
 * Who a row belongs to: 'shared' or a person or thing. Income rows can also join or leave the share basis. An income row
 * takes the rows deducted from it along, since a tax on one person's salary is that person's.
 */
export async function setRowScope(store: Store, rowId: string, scope: string, inShareBasis?: boolean): Promise<void> {
  const tables = await loadTables(store)
  const row = tables.rows.find((r) => r.id === rowId && !r.deletedAt)
  if (!row) throw new Error('Row not found')
  if (scope !== 'shared' && !tables.entities.some((e) => e.id === scope && !e.deletedAt)) throw new Error('That person or thing no longer exists.')
  if (inShareBasis != null && row.section !== 'income') throw new Error('Only income rows can count for the split.')
  const ts = now()
  const mutations: Mutation[] = [{ op: 'put', table: 'rows', record: RowSchema.parse({ ...row, ...scopePatch(row, scope), inShareBasis: inShareBasis ?? row.inShareBasis, updatedAt: ts }) }]
  if (row.section === 'income') {
    for (const d of tables.rows) if (!d.deletedAt && d.deductedFromRowId === row.id) mutations.push({ op: 'put', table: 'rows', record: RowSchema.parse({ ...d, ...scopePatch(d, scope), updatedAt: ts }) })
  }
  await store.commit(mutations)
}

/** Take a spending row out of an income row (tax, a pension contribution): the income's net is what the shares count. `null` undoes it. */
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
  'to-savings': 'savings', 'to-investment': 'investment', 'from-investment': 'investment', 'debt-payment': 'loan', 'card-payment': 'credit-card',
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
  const need = accountTypeForRow(row)
  const label = (t: Account['type']) => ACCOUNT_TYPE_INFO.find((i) => i.value === t)?.label ?? t
  if (accountId) {
    const acc = tables.accounts.find((a) => a.id === accountId && !a.deletedAt)
    if (!acc) throw new Error('That account no longer exists.')
    if (need && acc.type !== need) throw new Error(`"${row.name}" needs an account of type ${label(need)}, and "${acc.name}" is of type ${label(acc.type)}.`)
  } else if (need) {
    throw new Error(`"${row.name}" needs an account of type ${label(need)}.`)
  }
  await updateRow(store, rowId, { accountId })
}
