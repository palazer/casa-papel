import { generateKeyBetween } from 'fractional-indexing'
import { GoalSchema, monthOfDate, newId, type Goal, type GoalKind, type MonthKey, type Tables } from '@/model'
import type { Store } from './store'
import { loadTables } from './actions'

const now = () => Date.now()

export interface GoalInput {
  name: string
  kind: GoalKind
  accountId?: string | null
  poolId?: string | null
  target?: number | null
  targetMonth?: MonthKey | null
  notes?: string
  startMonth?: MonthKey
}

/** Keep only the reference the kind needs and refuse what cannot be measured. */
function normalize(tables: Tables, g: { kind: GoalKind; accountId: string | null; poolId: string | null; target: number }): { accountId: string | null; poolId: string | null; target: number } {
  const acc = g.accountId ? tables.accounts.find((a) => a.id === g.accountId && !a.deletedAt) : undefined
  const positive = () => { if (!(g.target > 0)) throw new Error('Target must be more than zero.') }
  switch (g.kind) {
    case 'account-balance':
      if (!acc || !['savings', 'investment', 'other-asset'].includes(acc.type)) throw new Error('Pick a savings, investment or other asset account.')
      positive()
      return { accountId: acc.id, poolId: null, target: g.target }
    case 'pay-off':
      if (!acc || !['credit-card', 'loan'].includes(acc.type)) throw new Error('Pick a card or loan.')
      // zero clears the debt; another amount is where it is brought down to
      if (!(g.target >= 0)) throw new Error('A debt cannot be brought down to less than zero.')
      return { accountId: acc.id, poolId: null, target: g.target }
    case 'pool-balance':
      if (!g.poolId || !tables.pools.some((p) => p.id === g.poolId && !p.deletedAt)) throw new Error('Pick a virtual account.')
      positive()
      return { accountId: null, poolId: g.poolId, target: g.target }
    default:
      positive()
      return { accountId: null, poolId: null, target: g.target }
  }
}

export async function addGoal(store: Store, input: GoalInput): Promise<Goal> {
  const tables = await loadTables(store)
  if (!input.name.trim()) throw new Error('Give the goal a name.')
  const refs = normalize(tables, { kind: input.kind, accountId: input.accountId ?? null, poolId: input.poolId ?? null, target: input.target ?? 0 })
  const last = tables.goals.filter((g) => !g.deletedAt).map((g) => g.order).sort().at(-1) ?? null
  const ts = now()
  const goal = GoalSchema.parse({
    id: newId(), createdAt: ts, updatedAt: ts, name: input.name.trim(), kind: input.kind, ...refs,
    startMonth: input.startMonth ?? monthOfDate(), targetMonth: input.targetMonth ?? null, notes: input.notes ?? '', order: generateKeyBetween(last, null),
  })
  await store.commit([{ op: 'put', table: 'goals', record: goal }])
  return goal
}

export async function updateGoal(store: Store, id: string, patch: Partial<Omit<Goal, 'id' | 'createdAt'>>): Promise<void> {
  const tables = await loadTables(store)
  const g = tables.goals.find((x) => x.id === id)
  if (!g) throw new Error('Goal not found')
  const merged = { ...g, ...patch }
  if (patch.name != null && !patch.name.trim()) throw new Error('Give the goal a name.')
  const refs = patch.deletedAt ? {} : normalize(tables, merged)
  await store.commit([{ op: 'put', table: 'goals', record: GoalSchema.parse({ ...merged, ...refs, name: merged.name.trim(), updatedAt: now() }) }])
}

export const deleteGoal = (store: Store, id: string) => updateGoal(store, id, { deletedAt: now() })
