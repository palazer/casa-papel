import { describe, expect, it } from 'vitest'
import { computeEngine, cellKey } from '@/engine'
import { newId, poolRef, type Tables } from '@/model'
import {
  CasaDb, Store, addPool, addRow, archiveAccount, archiveEntity, archiveRow, defaultMonths, followRow, loadTables, postRecurring, removeAccount, removeEntity,
  removePool, removeRecurringItem, removeRow, restoreAccount, restoreRow, setRecurringPaid,
} from '@/store'
import { loadDemo } from '@/demo/loadDemo'

const TODAY = '2026-11'

type Named = 'rows' | 'accounts' | 'pools' | 'entities' | 'recurringItems'
const idOf = (t: Tables, table: Named, name: string) => {
  const x = (t[table] as Array<{ id: string; name: string; deletedAt: number | null }>).find((r) => r.name === name && !r.deletedAt)
  if (!x) throw new Error(`no ${table} named ${name}`)
  return x.id
}

/** The demo, with its schedules posted the way the app does on load. */
async function demo() {
  const store = new Store(new CasaDb(`test-${newId()}`))
  await loadDemo(store)
  const t = await loadTables(store)
  const household = t.household[0]
  const months = defaultMonths(household, t, TODAY)
  await postRecurring(store, months)
  return { store, months, tables: () => loadTables(store), engine: async () => computeEngine({ tables: await loadTables(store), months }) }
}

describe('remove', () => {
  it('deleting a row takes its cells and schedules with it and unlinks followers; undo brings everything back', async () => {
    const { store, tables, engine } = await demo()
    let t = await tables()
    const car = idOf(t, 'rows', 'Car insurance')
    const mirror = await addRow(store, { name: 'Mirror', section: 'transfer' })
    await followRow(store, mirror.id, car)
    const cellsBefore = t.cells.filter((c) => c.rowId === car).length
    expect(cellsBefore).toBeGreaterThan(0)

    await removeRow(store, car)
    t = await tables()
    expect(t.rows.find((r) => r.id === car)?.deletedAt).not.toBeNull()
    expect(t.cells.filter((c) => c.rowId === car)).toHaveLength(0)
    expect(t.recurringItems.find((r) => r.name === 'Car insurance')?.deletedAt).not.toBeNull()
    expect(t.rows.find((r) => r.id === mirror.id)?.followsRowId).toBeNull()
    expect((await engine()).rows.some((r) => r.id === car)).toBe(false)

    await store.undo()
    t = await tables()
    expect(t.rows.find((r) => r.id === car)?.deletedAt).toBeNull()
    expect(t.cells.filter((c) => c.rowId === car)).toHaveLength(cellsBefore)
    expect(t.recurringItems.find((r) => r.name === 'Car insurance')?.deletedAt).toBeNull()
    expect(t.rows.find((r) => r.id === mirror.id)?.followsRowId).toBe(car)
  })

  it('refuses to delete or archive into closed history', async () => {
    const { store, tables } = await demo()
    const groceries = idOf(await tables(), 'rows', 'Groceries')
    await expect(removeRow(store, groceries)).rejects.toThrow(/closed months \(Sept 2026\)/)
    await expect(archiveRow(store, groceries, '2026-09')).rejects.toThrow(/Sept 2026 is closed/)
    await expect(archiveRow(store, groceries, '2026-10')).resolves.toBeUndefined()
    expect((await tables()).rows.find((r) => r.id === groceries)?.archivedMonth).toBe('2026-10')
  })

  it('archiving a row pins what its followers mirrored, ends its schedules and leaves closed months alone', async () => {
    const { store, tables, engine } = await demo()
    let t = await tables()
    const benefit = idOf(t, 'rows', 'Child benefit')
    const saver = await addRow(store, { name: 'Robin savings', section: 'transfer' })
    await followRow(store, saver.id, benefit)
    const before = await engine()
    expect(before.totals['2026-09'].income).toBe(725500)

    await archiveRow(store, benefit, TODAY)
    t = await tables()
    expect(t.rows.find((r) => r.id === benefit)?.archivedMonth).toBe(TODAY)
    const follower = t.rows.find((r) => r.id === saver.id)!
    expect(follower.followsRowId).toBeNull()
    expect(t.cells.filter((c) => c.rowId === saver.id).map((c) => [c.month, c.mode, c.value])).toEqual([['2026-09', 'value', 25500], ['2026-10', 'value', 25500]])
    const after = await engine()
    expect(after.totals['2026-09'].income).toBe(725500) // the closed month did not move
    expect(after.cells[cellKey(benefit, TODAY)].source).toBe('archived')
    expect(after.cells[cellKey(saver.id, TODAY)]).toMatchObject({ value: 25500, source: 'inherit' })
    expect(after.totals[TODAY].income).toBe(715000) // no benefit, but the other income

    // a scheduled row: the schedule ends the month before, its open postings go
    const rent = idOf(t, 'rows', 'Rent')
    expect(t.cells.find((c) => c.rowId === rent && c.month === '2026-12')?.items.some((i) => i.recurringItemId)).toBe(true)
    await archiveRow(store, rent, TODAY)
    t = await tables()
    expect(t.recurringItems.find((r) => r.name === 'Rent')).toMatchObject({ endMonth: '2026-10', deletedAt: null })
    expect(t.cells.find((c) => c.rowId === rent && c.month === '2026-12')?.items.some((i) => i.recurringItemId) ?? false).toBe(false)
    expect(t.cells.find((c) => c.rowId === rent && c.month === '2026-10')?.items.some((i) => i.recurringItemId)).toBe(true)

    await restoreRow(store, rent)
    expect((await tables()).rows.find((r) => r.id === rent)?.archivedMonth).toBeNull()
  })

  it('deleting an account clears the plain rows and schedules that named it; pool accounts block; archiving stops the balance and takes its pool accounts along', async () => {
    const { store, tables, engine } = await demo()
    let t = await tables()
    const main = idOf(t, 'accounts', 'Main account')
    await removeAccount(store, main)
    t = await tables()
    expect(t.accounts.find((a) => a.id === main)?.deletedAt).not.toBeNull()
    expect(t.rows.filter((r) => !r.deletedAt && r.accountId === main)).toHaveLength(0)
    expect(t.recurringItems.filter((r) => !r.deletedAt && r.accountId === main)).toHaveLength(0)
    await store.undo()
    t = await tables()
    expect(t.rows.find((r) => r.name === 'Rent')?.accountId).toBe(main)

    const savings = idOf(t, 'accounts', 'Savings')
    await expect(removeAccount(store, savings)).rejects.toThrow(/closed months/)
    await archiveAccount(store, savings, TODAY)
    t = await tables()
    expect(t.accounts.find((a) => a.id === savings)?.archivedMonth).toBe(TODAY)
    expect(t.pools.filter((p) => p.accountId === savings).map((p) => p.archivedMonth)).toEqual([TODAY, TODAY])
    expect(t.rows.find((r) => r.name === 'Travel pool')?.archivedMonth).toBe(TODAY)
    expect(t.rows.find((r) => r.name === 'Travel')?.defaultFundedBy).toBe('savings')
    // October's pool spending keeps its source, November's moves to savings
    const travelId = idOf(t, 'pools', 'Travel')
    const clothingId = idOf(t, 'pools', 'Clothing')
    expect(t.cells.find((c) => c.rowId === idOf(t, 'rows', 'Travel') && c.month === '2026-10')?.items[0].fundedBy).toBe(poolRef(travelId))
    expect(t.cells.find((c) => c.rowId === idOf(t, 'rows', 'Clothing') && c.month === TODAY)?.items[0].fundedBy).toBe('savings')
    const out = await engine()
    expect(out.accounts[savings].months['2026-10']).toBeDefined()
    expect(out.accounts[savings].months[TODAY]).toBeUndefined()
    expect(out.pools[clothingId].months[TODAY]).toBeUndefined()
    expect(out.netWorth[TODAY]).toBeLessThan(out.netWorth['2026-10'])

    await restoreAccount(store, savings)
    t = await tables()
    expect(t.accounts.find((a) => a.id === savings)?.archivedMonth).toBeNull()
    expect(t.pools.find((p) => p.id === travelId)?.archivedMonth).toBe(TODAY) // pool accounts stay put until restored themselves
  })

  it('deleting a fresh pool account removes the row that fills it and moves its spending to savings', async () => {
    const { store, tables } = await demo()
    let t = await tables()
    const gifts = await addPool(store, { name: 'Gifts', accountId: idOf(t, 'accounts', 'Savings'), monthlyAllocation: 5000, fromMonth: TODAY, createSpendRow: true })
    t = await tables()
    const alloc = t.rows.find((r) => r.id === gifts.allocationRowId)!
    const spend = t.rows.find((r) => r.name === 'Gifts' && r.section === 'expense')!
    expect(spend.defaultFundedBy).toBe(poolRef(gifts.id))
    await removePool(store, gifts.id)
    t = await tables()
    expect(t.pools.find((p) => p.id === gifts.id)?.deletedAt).not.toBeNull()
    expect(t.rows.find((r) => r.id === alloc.id)?.deletedAt).not.toBeNull()
    expect(t.cells.filter((c) => c.rowId === alloc.id)).toHaveLength(0)
    expect(t.rows.find((r) => r.id === spend.id)?.defaultFundedBy).toBe('savings')
  })

  it('deleting a thing untags its rows; a person with closed amounts is archived instead', async () => {
    const { store, tables } = await demo()
    let t = await tables()
    const car = idOf(t, 'entities', 'The car')
    expect(t.rows.find((r) => r.name === 'Car insurance')?.entityTags).toEqual([car])
    await removeEntity(store, car)
    t = await tables()
    expect(t.entities.find((e) => e.id === car)?.deletedAt).not.toBeNull()
    expect(t.rows.find((r) => r.name === 'Car insurance')?.entityTags).toEqual([])

    const alex = idOf(t, 'entities', 'Alex')
    await expect(removeEntity(store, alex)).rejects.toThrow(/closed months/)
    await archiveEntity(store, alex, TODAY)
    expect((await tables()).entities.find((e) => e.id === alex)?.archivedMonth).toBe(TODAY)
  })

  it('deleting a schedule removes its open postings and keeps what was paid', async () => {
    const { store, tables } = await demo()
    let t = await tables()
    const rentSchedule = idOf(t, 'recurringItems', 'Rent')
    const rent = idOf(t, 'rows', 'Rent')
    await setRecurringPaid(store, rentSchedule, '2026-10', true)
    await removeRecurringItem(store, rentSchedule)
    t = await tables()
    expect(t.recurringItems.find((r) => r.id === rentSchedule)?.deletedAt).not.toBeNull()
    expect(t.cells.find((c) => c.rowId === rent && c.month === '2026-10')?.items.map((i) => [i.amount, i.status])).toEqual([[165000, 'done']])
    expect(t.cells.find((c) => c.rowId === rent && c.month === TODAY)?.items ?? []).toEqual([])
    expect(t.cells.find((c) => c.rowId === rent && c.month === '2026-09')?.value).toBe(165000) // closed, untouched
  })
})
