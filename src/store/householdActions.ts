import { generateKeyBetween, generateNKeysBetween } from 'fractional-indexing'
import {
  AccountMonthSchema, AccountSchema, CellSchema, EntitySchema, HouseholdSchema, PoolSchema, RowSchema,
  ENTITY_TEMPLATES, HOUSEHOLD_TEMPLATES, monthOfDate, newId, poolRef, templateTitle,
  type Account, type Entity, type EntityKind, type Household, type MonthKey, type Pool, type Row, type RowTemplate, type Tables,
} from '@/model'
import type { Mutation, Store } from './store'
import { loadTables } from './actions'

const now = () => Date.now()

// ---------- entities ----------

export async function addEntity(store: Store, input: { kind: EntityKind; name: string; paidBy?: string | null; attributes?: Record<string, string> }): Promise<Entity> {
  const tables = await loadTables(store)
  const last = tables.entities.filter((e) => !e.deletedAt).map((e) => e.order).sort().at(-1) ?? null
  const ts = now()
  const entity = EntitySchema.parse({ id: newId(), createdAt: ts, updatedAt: ts, order: generateKeyBetween(last, null), attributes: {}, paidBy: null, ...input })
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

// ---------- templates ----------

interface TemplateContext {
  tables: Tables
  household: Household
  entity?: Entity
  adultCount: number
}

/** Build the rows (and pools) a template produces. Pure; used by the wizard and the household screen. */
export function buildTemplateMutations(t: RowTemplate, ctx: TemplateContext, order: string, accounts: Account[]): { mutations: Mutation[]; row: Row } {
  const ts = now()
  const name = templateTitle(t, ctx.entity?.name)
  const destination = t.account ? accounts.find((a) => a.type === t.account && !a.deletedAt) : undefined
  const mutations: Mutation[] = []
  let defaultFundedBy: Row['defaultFundedBy'] = 'cash'
  if (t.pool) {
    const savings = accounts.find((a) => a.type === 'savings' && !a.deletedAt)
    if (savings) {
      const pool: Pool = PoolSchema.parse({ id: newId(), createdAt: ts, updatedAt: ts, name, accountId: savings.id, openingBalance: 0, order })
      const alloc = RowSchema.parse({
        id: newId(), createdAt: ts, updatedAt: ts, name: `${name} pool`, section: 'transfer', kind: 'pool-allocation',
        accountId: savings.id, defaultStatus: 'committed', order: `${order}p`,
      })
      pool.allocationRowId = alloc.id
      mutations.push({ op: 'put', table: 'pools', record: pool }, { op: 'put', table: 'rows', record: alloc })
      defaultFundedBy = poolRef(pool.id)
    }
  }
  const row = RowSchema.parse({
    id: newId(), createdAt: ts, updatedAt: ts, name, section: t.section, kind: t.kind ?? 'plain',
    defaultStatus: t.defaultStatus ?? 'projected',
    scope: t.scope === 'entity' && ctx.entity ? ctx.entity.id : 'shared',
    entityTags: ctx.entity && (t.tag || t.scope === 'entity') ? [ctx.entity.id] : [],
    inShareBasis: t.inShareBasis ?? false,
    accountId: destination?.id ?? null,
    defaultFundedBy,
    pocketMode: t.pocket ? 'share-of-pocket-total' : null,
    pocketShare: t.pocket ? 1 / Math.max(1, ctx.adultCount) : null,
    order,
  })
  mutations.push({ op: 'put', table: 'rows', record: row })
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
  const adultCount = tables.entities.filter((e) => e.kind === 'adult' && !e.deletedAt).length
  const mutations: Mutation[] = []
  chosen.forEach((t, i) => mutations.push(...buildTemplateMutations(t, { tables, household, entity, adultCount }, orders[i], tables.accounts).mutations))
  if (mutations.length) await store.commit(mutations)
}

// ---------- setup wizard ----------

export interface SetupInput {
  household: Pick<Household, 'name' | 'baseCurrency' | 'locale' | 'startMonth'> & Partial<Household>
  adults: Array<{ name: string }>
  dependents: Array<{ kind: Exclude<EntityKind, 'adult'>; name: string; paidByIndex?: number | null }>
  accounts: Array<Pick<Account, 'name' | 'type'> & Partial<Account>>
  /** household template keys */
  householdTemplates: string[]
  /** per entity index (adults first, then dependents) → template keys */
  entityTemplates: Record<number, string[]>
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
      id: newId(), createdAt: ts, updatedAt: ts, kind: d.kind, name: d.name.trim() || d.kind,
      paidBy: d.paidByIndex != null ? adults[d.paidByIndex]?.id ?? null : null, order: entityOrders[input.adults.length + i],
    }),
  )
  const entities = [...adults, ...dependents]
  for (const e of entities) mutations.push({ op: 'put', table: 'entities', record: e })

  const accountOrders = generateNKeysBetween(null, null, input.accounts.length)
  const accounts: Account[] = input.accounts.map((a, i) =>
    AccountSchema.parse({
      id: newId(), createdAt: ts, updatedAt: ts, currency: household.baseCurrency, openingMonth: household.startMonth, openingBalance: 0,
      tracked: ['savings', 'investment', 'credit-card', 'loan', 'other-asset'].includes(a.type), order: accountOrders[i], ...a,
    }),
  )
  for (const a of accounts) mutations.push({ op: 'put', table: 'accounts', record: a })

  const tables = { household: [household], entities, accounts } as unknown as Tables
  const ctxBase = { tables, household, adultCount: adults.length }
  const plan: Array<{ t: RowTemplate; entity?: Entity }> = []
  entities.forEach((e, i) => {
    const keys = input.entityTemplates[i] ?? []
    for (const t of ENTITY_TEMPLATES[e.kind]) if (keys.includes(t.key)) plan.push({ t, entity: e })
  })
  for (const t of HOUSEHOLD_TEMPLATES) if (input.householdTemplates.includes(t.key)) plan.push({ t })
  const orders = generateNKeysBetween(null, null, plan.length)
  plan.forEach(({ t, entity }, i) => {
    if (t.pocket && household.moneyMode !== 'pooled') return
    mutations.push(...buildTemplateMutations(t, { ...ctxBase, entity }, orders[i], accounts).mutations)
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
  /** Savings account that holds the envelope. */
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
