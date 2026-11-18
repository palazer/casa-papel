import type { MonthKey } from '@/model'
import type { Store } from './store'
import { loadTables } from './actions'
import { describeRemoval, planArchive, planRemoval, planRestore, type RemovalTarget, type Restored } from './impact'

const now = () => Date.now()

/** Delete something and settle everything that pointed at it, as one undoable commit. Refused when the impact says so. */
export async function removeThing(store: Store, target: RemovalTarget): Promise<void> {
  const tables = await loadTables(store)
  await store.commit(planRemoval(tables, target, now()))
}

/**
 * Delete without asking, when there is nothing to ask about: the thing can be deleted and nothing else changes with
 * it. That is the cheap delete of a household that is still being set up. Returns the name of what was deleted, or
 * null when the dialog has to be shown instead: something else would change with it, something stands in the way, or
 * a month that is over holds its amounts (the dialog says which). Nothing is touched in that case. One undoable
 * commit.
 */
export async function removeIfFree(store: Store, target: RemovalTarget): Promise<string | null> {
  const tables = await loadTables(store)
  const impact = describeRemoval(tables, target)
  // a goal that watches it would go with it: that is more than the thing itself, so the dialog says it first
  const watched = tables.goals.some((g) => !g.deletedAt && (g.accountId === target.id || g.poolId === target.id))
  if (!impact.canDelete || impact.changes.length > 0 || watched || impact.over) return null
  await store.commit(planRemoval(tables, target, now()))
  return impact.subject
}

/** Archive something from `month` on. Earlier months stay exactly as they are. */
export async function archiveThing(store: Store, target: RemovalTarget, month: MonthKey): Promise<void> {
  const tables = await loadTables(store)
  await store.commit(planArchive(tables, target, month, now()))
}

/**
 * Bring an archived row, account, virtual account or person back, with what its archive changed: one undoable commit.
 * Returns what came back and what stayed as it is, for the message the screen shows (`restoredText`).
 */
export async function restoreThing(store: Store, target: RemovalTarget): Promise<Restored> {
  const tables = await loadTables(store)
  const { mutations, ...restored } = planRestore(tables, target, now())
  await store.commit(mutations)
  return restored
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
