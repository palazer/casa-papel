import type { Mutation, Store } from '@/store'
import { applyMutations, defaultMonths, planRecurringPosts, wipeAll } from '@/store'
import { buildDemoTables } from './demoHousehold'

/**
 * Replace the store's contents with the demo household (one undoable action). Its schedules are landed in every month
 * of its plan in the same step, the months that are over included: the demo is written for the autumn of 2026 and is
 * loaded on any later day, and the app's own pass fills only the current month and later.
 */
export async function loadDemo(store: Store): Promise<void> {
  await wipeAll(store)
  const base = buildDemoTables()
  const household = base.household[0]
  const tables = applyMutations(base, planRecurringPosts(base, defaultMonths(household, base)))
  const mutations: Mutation[] = []
  for (const [table, records] of Object.entries(tables)) {
    for (const record of records) mutations.push({ op: 'put', table, record } as Mutation)
  }
  await store.commit(mutations)
}
