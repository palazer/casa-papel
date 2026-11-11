import { generateKeyBetween, generateNKeysBetween } from 'fractional-indexing'
import { buildDefaultCategoryMutations } from './categoryActions'
import {
  AccountMonthSchema, AccountSchema, CellSchema, EntitySchema, HouseholdSchema, PoolSchema, RowSchema,
  ENTITY_TEMPLATES, HOUSEHOLD_TEMPLATES, monthOfDate, newId, poolRef, templateTitle,
  type Account, type Entity, type EntityKind, type Household, type MonthKey, type Pool, type Row, type RowTemplate, type Tables,
} from '@/model'
import { currentAccountsIn } from '@/engine'
import type { Mutation, Store } from './store'
import { loadTables } from './actions'

const now = () => Date.now()

// ---------- entities ----------

export async function addEntity(store: Store, input: { kind: EntityKind; name: string; attributes?: Record<string, string> }): Promise<Entity> {
  const tables = await loadTables(store)
  const last = tables.entities.filter((e) => !e.deletedAt).map((e) => e.order).sort().at(-1) ?? null
  const ts = now()
  const entity = EntitySchema.parse({ id: newId(), createdAt: ts, updatedAt: ts, order: generateKeyBetween(last, null), attributes: {}, ...input })
  await store.commit([{ op: 'put', table: 'entities', record: entity }])
  return entity
}

export async function updateEntity(store: Store, id: string, patch: Partial<Omit<Entity, 'id' | 'createdAt'>>): Promise<void> {
  const tables = await loadTables(store)
  const e = tables.entities.find((x) => x.id === id)
  if (!e) throw new Error('Not found')
  await store.commit([{ op: 'put', table: 'entities', record: EntitySchema.parse({ ...e, ...patch, updatedAt: now() }) }])
}

// ---------- accounts ----------

export type AccountInput = Pick<Account, 'name' | 'type' | 'currency' | 'openingMonth'> & Partial<Account>

export async function addAccount(store: Store, input: AccountInput): Promise<Account> {
  const tables = await loadTables(store)
  const last = tables.accounts.filter((a) => !a.deletedAt).map((a) => a.order).sort().at(-1) ?? null
  const ts = now()
  const tracked = input.tracked ?? ['savings', 'investment', 'credit-card', 'loan', 'other-asset'].includes(input.type)
  const account = AccountSchema.parse({ id: newId(), createdAt: ts, updatedAt: ts, order: generateKeyBetween(last, null), openingBalance: 0, ...input, tracked })
  await store.commit([{ op: 'put', table: 'accounts', record: account }])
  return account
}

export async function updateAccount(store: Store, id: string, patch: Partial<Omit<Account, 'id' | 'createdAt'>>): Promise<void> {
  const tables = await loadTables(store)
  const a = tables.accounts.find((x) => x.id === id)
  if (!a) throw new Error('Not found')
  await store.commit([{ op: 'put', table: 'accounts', record: AccountSchema.parse({ ...a, ...patch, updatedAt: now() }) }])
}

/** Record (or clear with null) the real balance of an account at the end of a month. */
export async function setAccountActual(store: Store, accountId: string, month: MonthKey, actualBalance: number | null): Promise<void> {
  const tables = await loadTables(store)
  const existing = tables.accountMonths.find((a) => a.accountId === accountId && a.month === month)
  if (actualBalance == null && (!existing || existing.actualBalance == null)) return
  await store.commit([{ op: 'put', table: 'accountMonths', record: AccountMonthSchema.parse({ ...existing, accountId, month, actualBalance, updatedAt: now() }) }])
}

/**
 * The real balances of the current accounts at the end of a month, in each account's own currency: a number for every
 * current account that exists in that month, or null to go back to the calculated amount. All of them or none, because
 * the plan only knows what the current accounts hold together. One undoable step.
 */
export async function setCurrentBalances(store: Store, month: MonthKey, balances: Record<string, number> | null): Promise<void> {
  const tables = await loadTables(store)
  if (tables.monthStates.find((s) => s.month === month)?.closed) throw new Error(`${month} is closed. Reopen it to change a balance.`)
  const open = currentAccountsIn(tables.accounts, month)
  if (open.length === 0) throw new Error(`There is no current account in ${month}.`)
  if (balances && open.some((a) => !Number.isFinite(balances[a.id]))) throw new Error('Fill in every account, or leave them all empty to use the calculated amount.')
  const mutations: Mutation[] = []
  for (const acc of open) {
    const existing = tables.accountMonths.find((a) => a.accountId === acc.id && a.month === month)
    const actualBalance = balances ? balances[acc.id] : null
    if ((existing?.actualBalance ?? null) === actualBalance) continue
    mutations.push({ op: 'put', table: 'accountMonths', record: AccountMonthSchema.parse({ ...existing, accountId: acc.id, month, actualBalance, updatedAt: now() }) })
  }
  if (mutations.length) await store.commit(mutations)
}

// ---------- templates ----------

interface TemplateContext {
  tables: Tables
  household: Household
  entity?: Entity
}

/** What the caller adds to a template: the account it points at (instead of the first of its type) and a first amount. */
export interface TemplateOptions {
  destination?: Account | null
  /** Written into `month`; the engine carries it forward. */
  amount?: number | null
  /** The month the first amount starts in; the household's first month when left out. */
  month?: MonthKey
}

/** The first amount of a suggested row: one value cell in the month it starts, carried forward from there. */
const startAmount = (rowId: string, month: MonthKey, value: number, ts: number): Mutation =>
  ({ op: 'put', table: 'cells', record: CellSchema.parse({ rowId, month, mode: 'value', value, items: [], updatedAt: ts }) })

/** Build the rows (and pools) a template produces. Pure; used by setup, the Statement's suggestions and the household screen. */
export function buildTemplateMutations(t: RowTemplate, ctx: TemplateContext, order: string, accounts: Account[], opts: TemplateOptions = {}): { mutations: Mutation[]; row: Row } {
  const ts = now()
  const name = templateTitle(t, ctx.entity?.name)
  const destination = t.account
    ? (opts.destination && opts.destination.type === t.account ? opts.destination : accounts.find((a) => a.type === t.account && !a.deletedAt))
    : undefined
  const mutations: Mutation[] = []
  let defaultFundedBy: Row['defaultFundedBy'] = 'cash'
  let allocationRowId: string | null = null
  if (t.pool) {
    const savings = accounts.find((a) => a.type === 'savings' && !a.deletedAt)
    if (savings) {
      const pool: Pool = PoolSchema.parse({ id: newId(), createdAt: ts, updatedAt: ts, name, accountId: savings.id, openingBalance: 0, order })
      const alloc = RowSchema.parse({
        id: newId(), createdAt: ts, updatedAt: ts, name: `${name} pool`, section: 'transfer', kind: 'pool-allocation',
        accountId: savings.id, defaultStatus: 'committed', order: `${order}p`,
      })
      pool.allocationRowId = alloc.id
      allocationRowId = alloc.id
      mutations.push({ op: 'put', table: 'pools', record: pool }, { op: 'put', table: 'rows', record: alloc })
      defaultFundedBy = poolRef(pool.id)
    }
  }
  const row = RowSchema.parse({
    id: newId(), createdAt: ts, updatedAt: ts, name, section: t.section, kind: t.kind ?? 'plain',
    defaultStatus: t.defaultStatus ?? 'projected',
    scope: t.scope === 'entity' && ctx.entity ? ctx.entity.id : 'shared',
    entityTags: ctx.entity && (t.tag || t.scope === 'entity') ? [ctx.entity.id] : [],
    accountId: destination?.id ?? null,
    defaultFundedBy,
    categoryId: t.category ? ctx.tables.categories?.find((c) => !c.deletedAt && c.section === t.section && c.name === t.category)?.id ?? null : null,
    // pocket money is a line of its own: an amount that is typed, or a rule set later
    pocketMode: t.pocket ? 'fixed' : null,
    templateKey: t.key,
    order,
  })
  mutations.push({ op: 'put', table: 'rows', record: row })
  // the row that takes the rest of the month takes no amount
  const automatic = t.kind === 'to-savings' && ctx.household.closingRule === 'savings-plug'
  // a pool template's amount is what is set aside each month, so it goes on the "<name> pool" transfer row
  if (opts.amount != null && opts.amount > 0 && !automatic) mutations.push(startAmount(allocationRowId ?? row.id, opts.month ?? ctx.household.startMonth, opts.amount, ts))
  return { mutations, row }
}

export async function applyTemplates(store: Store, keys: string[], entityId?: string): Promise<void> {
  const tables = await loadTables(store)
  const household = tables.household.find((h) => !h.deletedAt)
  if (!household) throw new Error('No household')
  const entity = entityId ? tables.entities.find((e) => e.id === entityId) : undefined
  const all = entity ? ENTITY_TEMPLATES[entity.kind] : HOUSEHOLD_TEMPLATES
  const chosen = all.filter((t) => keys.includes(t.key))
  const last = tables.rows.filter((r) => !r.deletedAt).map((r) => r.order).sort().at(-1) ?? null
  const orders = generateNKeysBetween(last, null, chosen.length)
  const mutations: Mutation[] = []
  chosen.forEach((t, i) => mutations.push(...buildTemplateMutations(t, { tables, household, entity }, orders[i], tables.accounts).mutations))
  if (mutations.length) await store.commit(mutations)
}

// ---------- setup ----------

/** A template chosen at setup, with the account it points at (an index into `accounts`) and a first monthly amount. */
export interface TemplateChoice {
  key: string
  accountIndex?: number | null
  amount?: number | null
}

export interface SetupInput {
  household: Pick<Household, 'name' | 'baseCurrency' | 'locale' | 'startMonth'> & Partial<Household>
  adults: Array<{ name: string }>
  dependents: Array<{ kind: Exclude<EntityKind, 'adult'>; name: string }>
  /** `ownerIndex` points into the entities (adults first, then dependents); null or absent = the household's. */
  accounts: Array<Pick<Account, 'name' | 'type'> & Partial<Account> & { ownerIndex?: number | null }>
  /** household template keys, or choices with an account and an amount */
  householdTemplates: Array<string | TemplateChoice>
  /** per entity index (adults first, then dependents) → template keys or choices */
  entityTemplates: Record<number, Array<string | TemplateChoice>>
  /** "To <account>" rows: a monthly deposit into an investment account, or a savings account when the user decides the savings amount */
  deposits?: Array<{ accountIndex: number; amount?: number | null }>
  /** the user's own rows; `entityIndex` prefixes the name with the subject and scopes or tags the row like a template would */
  customRows?: Array<{ name: string; section: Row['section']; entityIndex?: number | null; amount?: number | null }>
}

/** Everything a new household needs, as one commit. Pure apart from id/time generation. */
export function buildSetupMutations(input: SetupInput): { mutations: Mutation[]; household: Household } {
  const ts = now()
  const household = HouseholdSchema.parse({ id: newId(), createdAt: ts, updatedAt: ts, ...input.household })
  const mutations: Mutation[] = [{ op: 'put', table: 'household', record: household }]

  const entityOrders = generateNKeysBetween(null, null, input.adults.length + input.dependents.length)
  const adults: Entity[] = input.adults.map((a, i) =>
    EntitySchema.parse({ id: newId(), createdAt: ts, updatedAt: ts, kind: 'adult', name: a.name.trim() || `Adult ${i + 1}`, order: entityOrders[i] }),
  )
  const dependents: Entity[] = input.dependents.map((d, i) =>
    EntitySchema.parse({
      id: newId(), createdAt: ts, updatedAt: ts, kind: d.kind, name: d.name.trim() || d.kind, order: entityOrders[input.adults.length + i],
    }),
  )
  const entities = [...adults, ...dependents]
  for (const e of entities) mutations.push({ op: 'put', table: 'entities', record: e })

  const accountOrders = generateNKeysBetween(null, null, input.accounts.length)
  const accounts: Account[] = input.accounts.map(({ ownerIndex, ...a }, i) =>
    AccountSchema.parse({
      id: newId(), createdAt: ts, updatedAt: ts, currency: household.baseCurrency, openingMonth: household.startMonth, openingBalance: 0,
      tracked: ['savings', 'investment', 'credit-card', 'loan', 'other-asset'].includes(a.type), order: accountOrders[i],
      ownerEntityId: ownerIndex != null ? entities[ownerIndex]?.id ?? null : null, ...a,
    }),
  )
  for (const a of accounts) mutations.push({ op: 'put', table: 'accounts', record: a })

  // the usual expense categories come with every new household, so the suggested rows land in their groups
  const { mutations: categoryMutations, categories } = buildDefaultCategoryMutations([], ts)
  mutations.push(...categoryMutations)
  const tables = { household: [household], entities, accounts, categories } as unknown as Tables
  const ctxBase = { tables, household }
  const choice = (c: string | TemplateChoice): TemplateChoice => (typeof c === 'string' ? { key: c } : c)
  type Planned =
    | { kind: 'template'; t: RowTemplate; entity?: Entity; c: TemplateChoice }
    | { kind: 'deposit'; account: Account; amount: number | null }
    | { kind: 'custom'; name: string; section: Row['section']; entity?: Entity; amount: number | null }
  const plan: Planned[] = []
  entities.forEach((e, i) => {
    const chosen = (input.entityTemplates[i] ?? []).map(choice)
    for (const t of ENTITY_TEMPLATES[e.kind]) {
      const c = chosen.find((x) => x.key === t.key)
      if (c) plan.push({ kind: 'template', t, entity: e, c })
    }
  })
  const householdChoices = input.householdTemplates.map(choice)
  for (const t of HOUSEHOLD_TEMPLATES) {
    const c = householdChoices.find((x) => x.key === t.key)
    if (c) plan.push({ kind: 'template', t, c })
  }
  // a deposit row per chosen account; under the savings plug a savings account takes no typed row (the plug fills the first one)
  for (const dep of input.deposits ?? []) {
    const account = accounts[dep.accountIndex]
    if (!account) continue
    if (account.type === 'investment' || (account.type === 'savings' && household.closingRule !== 'savings-plug')) plan.push({ kind: 'deposit', account, amount: dep.amount ?? null })
  }
  for (const r of input.customRows ?? []) {
    if (r.name.trim()) plan.push({ kind: 'custom', name: r.name.trim(), section: r.section, entity: r.entityIndex != null ? entities[r.entityIndex] : undefined, amount: r.amount ?? null })
  }
  const orders = generateNKeysBetween(null, null, plan.length)
  plan.forEach((p, i) => {
    if (p.kind === 'template') {
      const destination = p.c.accountIndex != null ? accounts[p.c.accountIndex] ?? null : null
      mutations.push(...buildTemplateMutations(p.t, { ...ctxBase, entity: p.entity }, orders[i], accounts, { destination, amount: p.c.amount }).mutations)
      return
    }
    const row = p.kind === 'deposit'
      ? RowSchema.parse({
          id: newId(), createdAt: ts, updatedAt: ts, name: `To ${p.account.name}`, section: 'transfer',
          kind: p.account.type === 'investment' ? 'to-investment' : 'to-savings', accountId: p.account.id, defaultStatus: 'committed', order: orders[i],
        })
      : RowSchema.parse({
          id: newId(), createdAt: ts, updatedAt: ts, name: p.entity ? `${p.entity.name} – ${p.name}` : p.name, section: p.section,
          defaultStatus: p.section === 'expense' ? 'projected' : 'committed',
          scope: p.entity && (p.entity.kind === 'adult' || p.entity.kind === 'child') ? p.entity.id : 'shared',
          entityTags: p.entity ? [p.entity.id] : [], order: orders[i],
        })
    mutations.push({ op: 'put', table: 'rows', record: row })
    if (p.amount != null && p.amount > 0) mutations.push(startAmount(row.id, household.startMonth, p.amount, ts))
  })
  return { mutations, household }
}

export async function createHouseholdFromSetup(store: Store, input: SetupInput): Promise<Household> {
  const { mutations, household } = buildSetupMutations(input)
  await store.commit(mutations)
  return household
}

// ---------- pools ----------

export interface PoolInput {
  name: string
  /** Savings account that holds the pool account. */
  accountId: string
  openingBalance?: number
  /** Monthly amount set aside, written into the allocation row from `fromMonth` on. */
  monthlyAllocation?: number | null
  fromMonth?: MonthKey
  /** Also create an expense row that spends from the pool. */
  createSpendRow?: boolean
}

/** A pool, its allocation row (transfer) and optionally a spend row funded by it. */
export async function addPool(store: Store, input: PoolInput): Promise<Pool> {
  const tables = await loadTables(store)
  const ts = now()
  const lastPool = tables.pools.filter((p) => !p.deletedAt).map((p) => p.order).sort().at(-1) ?? null
  const lastRow = tables.rows.filter((r) => !r.deletedAt).map((r) => r.order).sort().at(-1) ?? null
  const [allocOrder, spendOrder] = generateNKeysBetween(lastRow, null, 2)
  const pool: Pool = PoolSchema.parse({ id: newId(), createdAt: ts, updatedAt: ts, name: input.name.trim(), accountId: input.accountId, openingBalance: input.openingBalance ?? 0, order: generateKeyBetween(lastPool, null) })
  const alloc = RowSchema.parse({
    id: newId(), createdAt: ts, updatedAt: ts, name: `${pool.name} pool`, section: 'transfer', kind: 'pool-allocation',
    accountId: input.accountId, defaultStatus: 'committed', order: allocOrder,
  })
  pool.allocationRowId = alloc.id
  const mutations: Mutation[] = [{ op: 'put', table: 'pools', record: pool }, { op: 'put', table: 'rows', record: alloc }]
  if (input.createSpendRow) {
    mutations.push({ op: 'put', table: 'rows', record: RowSchema.parse({ id: newId(), createdAt: ts, updatedAt: ts, name: pool.name, section: 'expense', defaultFundedBy: poolRef(pool.id), defaultStatus: 'projected', order: spendOrder }) })
  }
  if (input.monthlyAllocation != null && input.monthlyAllocation > 0) {
    const month = input.fromMonth ?? monthOfDate()
    mutations.push({ op: 'put', table: 'cells', record: CellSchema.parse({ rowId: alloc.id, month, mode: 'value', value: input.monthlyAllocation, items: [], updatedAt: ts }) })
  }
  await store.commit(mutations)
  return pool
}

export async function updatePool(store: Store, id: string, patch: Partial<Pick<Pool, 'name' | 'accountId' | 'openingBalance'>>): Promise<void> {
  const tables = await loadTables(store)
  const p = tables.pools.find((x) => x.id === id)
  if (!p) throw new Error('Pool not found')
  await store.commit([{ op: 'put', table: 'pools', record: PoolSchema.parse({ ...p, ...patch, updatedAt: now() }) }])
}
