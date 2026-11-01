import type { Mutation, Store } from '@/store'
import { wipeAll } from '@/store'
import { buildDemoTables } from './demoHousehold'

/** Replace the store's contents with the demo household (one undoable action). */
export async function loadDemo(store: Store): Promise<void> {
  await wipeAll(store)
  const tables = buildDemoTables()
  const mutations: Mutation[] = []
  for (const [table, records] of Object.entries(tables)) {
    for (const record of records) mutations.push({ op: 'put', table, record } as Mutation)
  }
  await store.commit(mutations)
}
