import { describe, expect, it } from 'vitest'
import { newId } from '@/model'
import { CasaDb, Store } from '@/store'
import { buildDemoTables } from '@/demo/demoHousehold'
import { loadDemo } from '@/demo/loadDemo'

describe('demo household', () => {
  it('validates and is internally consistent', () => {
    const t = buildDemoTables()
    const ids = new Set<string>()
    for (const list of Object.values(t)) for (const r of list as Array<{ id?: string }>) if (r.id) {
      expect(ids.has(r.id)).toBe(false)
      ids.add(r.id)
    }
    const rowIds = new Set(t.rows.map((r) => r.id))
    for (const c of t.cells) expect(rowIds.has(c.rowId)).toBe(true)
    for (const r of t.recurringItems) expect(rowIds.has(r.rowId)).toBe(true)
    const accountIds = new Set(t.accounts.map((a) => a.id))
    for (const p of t.pools) expect(accountIds.has(p.accountId)).toBe(true)
  })
  it('loads into a store', async () => {
    const s = new Store(new CasaDb(`test-${newId()}`))
    await loadDemo(s)
    expect(await s.db.household.count()).toBe(1)
    expect(await s.db.rows.count()).toBeGreaterThan(15)
    expect(await s.db.events.count()).toBeGreaterThan(15)
  })
})
