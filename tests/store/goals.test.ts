import { describe, expect, it } from 'vitest'
import { computeEngine, computeGoals } from '@/engine'
import { SCHEMA_VERSION, monthRange, newId } from '@/model'
import { CasaDb, Store, addAccount, addGoal, deleteGoal, exportSnapshot, loadTables, parseExportFile, quickCreateHousehold, updateGoal } from '@/store'

async function fresh() {
  const store = new Store(new CasaDb(`test-${newId()}`))
  await quickCreateHousehold(store, { name: 'T', baseCurrency: 'EUR', locale: 'en-IE', startMonth: '2026-01' })
  return store
}

describe('goal actions', () => {
  it('adds, validates, updates and deletes goals', async () => {
    const store = await fresh()
    const t0 = await loadTables(store)
    const savings = t0.accounts.find((a) => a.type === 'savings')!
    await expect(addGoal(store, { name: 'x', kind: 'account-balance', accountId: savings.id, target: 0 })).rejects.toThrow(/more than zero/)
    await expect(addGoal(store, { name: 'x', kind: 'pay-off', accountId: savings.id })).rejects.toThrow(/card or loan/)
    await expect(addGoal(store, { name: '  ', kind: 'net-worth', target: 100 })).rejects.toThrow(/name/)
    const g = await addGoal(store, { name: 'Cushion', kind: 'account-balance', accountId: savings.id, target: 5000_00, targetMonth: '2027-06' })
    expect(g).toMatchObject({ poolId: null, target: 5000_00, targetMonth: '2027-06', deletedAt: null })
    expect(g.startMonth).toMatch(/^\d{4}-\d{2}$/)
    const loan = await addAccount(store, { name: 'Loan', type: 'loan', currency: 'EUR', openingMonth: '2026-01', openingBalance: 1000_00 })
    // a debt is cleared at zero unless an amount to bring it down to is named
    const p = await addGoal(store, { name: 'Clear', kind: 'pay-off', accountId: loan.id })
    expect(p.target).toBe(0)
    const half = await addGoal(store, { name: 'Halfway', kind: 'pay-off', accountId: loan.id, target: 500_00 })
    expect(half).toMatchObject({ accountId: loan.id, poolId: null, target: 500_00 })
    await expect(addGoal(store, { name: 'x', kind: 'pay-off', accountId: loan.id, target: -1 })).rejects.toThrow(/less than zero/)
    await deleteGoal(store, half.id)
    expect(p.order > g.order).toBe(true)
    await updateGoal(store, g.id, { name: 'Bigger cushion', target: 6000_00 })
    let t = await loadTables(store)
    expect(t.goals.find((x) => x.id === g.id)).toMatchObject({ name: 'Bigger cushion', target: 6000_00 })
    await deleteGoal(store, p.id)
    t = await loadTables(store)
    expect(t.goals.find((x) => x.id === p.id)?.deletedAt).not.toBeNull()
    const res = computeGoals(t, computeEngine({ tables: t, months: monthRange('2026-01', '2026-03') }), '2026-01')
    expect(res.map((r) => r.goal.name)).toEqual(['Bigger cushion'])
    await store.undo()
    expect((await loadTables(store)).goals.find((x) => x.id === p.id)?.deletedAt).toBeNull()
  })
  it('exports goals, and still reads export files from before goals existed', async () => {
    const store = await fresh()
    const t0 = await loadTables(store)
    await addGoal(store, { name: 'Cushion', kind: 'account-balance', accountId: t0.accounts.find((a) => a.type === 'savings')!.id, target: 100 })
    const snap = await exportSnapshot(store)
    expect(snap.schemaVersion).toBe(SCHEMA_VERSION)
    expect(snap.tables.goals).toHaveLength(1)
    // a schema-1 file has no goals table at all
    const old = JSON.parse(JSON.stringify(snap)) as { schemaVersion: number; tables: Record<string, unknown> }
    old.schemaVersion = 1
    delete old.tables.goals
    const parsed = parseExportFile(old)
    expect(parsed.schemaVersion).toBe(SCHEMA_VERSION)
    expect(parsed.tables.goals).toEqual([])
  })
})
