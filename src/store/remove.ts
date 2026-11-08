import { AccountSchema, EntitySchema, PoolSchema, RowSchema, type MonthKey } from '@/model'
import type { Mutation, Store } from './store'
import { loadTables } from './actions'
import { planArchive, planRemoval, type RemovalTarget } from './impact'

const now = () => Date.now()

/** Delete something and settle everything that pointed at it, as one undoable commit. Refused when the impact says so. */
export async function removeThing(store: Store, target: RemovalTarget): Promise<void> {
  const tables = await loadTables(store)
  await store.commit(planRemoval(tables, target, now()))
}

/** Archive something from `month` on. Earlier months stay exactly as they are. */
export async function archiveThing(store: Store, target: RemovalTarget, month: MonthKey): Promise<void> {
  const tables = await loadTables(store)
  await store.commit(planArchive(tables, target, month, now()))
}

/** Bring an archived row, account, pool account or person back. */
export async function restoreThing(store: Store, target: RemovalTarget): Promise<void> {
  const tables = await loadTables(store)
  const ts = now()
  const pick = <T extends { id: string; deletedAt: number | null }>(list: T[], what: string): T => {
    const x = list.find((r) => r.id === target.id && !r.deletedAt)
    if (!x) throw new Error(`That ${what} no longer exists.`)
    return x
  }
  let mutation: Mutation
  switch (target.kind) {
    case 'row': mutation = { op: 'put', table: 'rows', record: RowSchema.parse({ ...pick(tables.rows, 'row'), archivedMonth: null, updatedAt: ts }) }; break
    case 'account': mutation = { op: 'put', table: 'accounts', record: AccountSchema.parse({ ...pick(tables.accounts, 'account'), archivedMonth: null, updatedAt: ts }) }; break
    case 'pool': mutation = { op: 'put', table: 'pools', record: PoolSchema.parse({ ...pick(tables.pools, 'pool account'), archivedMonth: null, updatedAt: ts }) }; break
    case 'entity': mutation = { op: 'put', table: 'entities', record: EntitySchema.parse({ ...pick(tables.entities, 'person or thing'), archivedMonth: null, updatedAt: ts }) }; break
    default: throw new Error(`A ${target.kind} is never archived; there is nothing to restore.`)
  }
  await store.commit([mutation])
}

export const removeRow = (store: Store, id: string) => removeThing(store, { kind: 'row', id })
export const removeAccount = (store: Store, id: string) => removeThing(store, { kind: 'account', id })
export const removePool = (store: Store, id: string) => removeThing(store, { kind: 'pool', id })
export const removeEntity = (store: Store, id: string) => removeThing(store, { kind: 'entity', id })
export const removeRecurringItem = (store: Store, id: string) => removeThing(store, { kind: 'schedule', id })
export const removeGoal = (store: Store, id: string) => removeThing(store, { kind: 'goal', id })
export const removeCategory = (store: Store, id: string) => removeThing(store, { kind: 'category', id })

export const archiveRow = (store: Store, id: string, month: MonthKey) => archiveThing(store, { kind: 'row', id }, month)
export const archiveAccount = (store: Store, id: string, month: MonthKey) => archiveThing(store, { kind: 'account', id }, month)
export const archivePool = (store: Store, id: string, month: MonthKey) => archiveThing(store, { kind: 'pool', id }, month)
export const archiveEntity = (store: Store, id: string, month: MonthKey) => archiveThing(store, { kind: 'entity', id }, month)

export const restoreRow = (store: Store, id: string) => restoreThing(store, { kind: 'row', id })
export const restoreAccount = (store: Store, id: string) => restoreThing(store, { kind: 'account', id })
export const restorePool = (store: Store, id: string) => restoreThing(store, { kind: 'pool', id })
export const restoreEntity = (store: Store, id: string) => restoreThing(store, { kind: 'entity', id })
