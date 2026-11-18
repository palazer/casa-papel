import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { computeEngine, type EngineOutput } from '@/engine'
import { monthRange, newId, poolRef, type Tables } from '@/model'
import {
  CasaDb, Store, addPool, addRecurringItem, addRow, archiveAccount, archivePool, archiveRow, endRecurringItem, exportSnapshot, followRow, importReplace, loadTables,
  mergeTables, quickCreateHousehold, restoreAccount, restorePool, restoreRow, restoredText, setCellValue, setRowFundedBy,
} from '@/store'
import { buildSyncPayload } from '@/sync/snapshot'
import { restoreToday, setToday } from '../today'

const months = monthRange('2026-01', '2026-12')

/**
 * Salary 4,000; Savings takes the rest. "Rent" is on a schedule of 1,200 a month. The virtual account "Holidays" in
 * Savings gets 100 a month, and "Trip" (150 a month) comes out of it; "Storage" (40 a month) comes out of Savings.
 */
async function fresh() {
  const store = new Store(new CasaDb(`test-${newId()}`))
  await quickCreateHousehold(store, { name: 'T', baseCurrency: 'EUR', locale: 'en-IE', startMonth: '2026-01' })
  let t = await loadTables(store)
  const savings = t.accounts.find((a) => a.type === 'savings')!
  const rent = t.rows.find((r) => r.name === 'Rent')!
  await setCellValue(store, t.rows.find((r) => r.name === 'Salary')!.id, '2026-01', 400000, 'from-now-on')
  const schedule = await addRecurringItem(store, { name: 'Rent', rowId: rent.id, amount: 120000, startMonth: '2026-01' })
  const pool = await addPool(store, { name: 'Holidays', accountId: savings.id, openingBalance: 60000, monthlyAllocation: 10000, fromMonth: '2026-01', createSpendRow: false })
  const trip = await addRow(store, { name: 'Trip', section: 'expense' })
  await setCellValue(store, trip.id, '2026-01', 15000, 'from-now-on')
  await setRowFundedBy(store, trip.id, poolRef(pool.id), 'all-months')
  const storage = await addRow(store, { name: 'Storage', section: 'expense' })
  await setCellValue(store, storage.id, '2026-01', 4000, 'from-now-on')
  await setRowFundedBy(store, storage.id, `account:${savings.id}`, 'all-months')
  t = await loadTables(store)
  const fill = t.rows.find((r) => r.id === pool.allocationRowId)!
  return { store, savings, rent, schedule, pool, trip, storage, fill }
}
const engineOf = async (store: Store): Promise<EngineOutput> => computeEngine({ tables: await loadTables(store), months })
/** What the plan shows: every amount, balance and sum. Two states with the same figures look the same on every screen. */
const figures = (out: EngineOutput) => ({
  cells: Object.fromEntries(Object.entries(out.cells).map(([k, c]) => [k, [c.value, c.valueBase, c.source === 'archived', JSON.stringify(c.funding)]])),
  accounts: Object.fromEntries(Object.entries(out.accounts).map(([k, s]) => [k, s.months])),
  pools: Object.fromEntries(Object.entries(out.pools).map(([k, s]) => [k, s.months])),
  totals: out.totals, netWorth: out.netWorth,
})
/** The stored data without the times of the last change, which every write moves. */
const stored = (t: Tables) => JSON.parse(JSON.stringify(t, (k, v: unknown) => (k === 'updatedAt' ? undefined : v))) as unknown

describe('restoring puts back what archiving changed', () => {
  // the plan's end depends on today, and a schedule lands in every month of the plan
  beforeEach(() => setToday('2026-03-15'))
  afterEach(restoreToday)

  it('a row: its schedule runs again, and the row that followed it follows again', async () => {
    const { store, rent, schedule } = await fresh()
    const fee = await addRow(store, { name: 'Service charge', section: 'expense' })
    await followRow(store, fee.id, rent.id)
    const before = figures(await engineOf(store))

    await archiveRow(store, rent.id, '2026-06')
    let t = await loadTables(store)
    expect(t.rows.find((r) => r.id === rent.id)).toMatchObject({ archivedMonth: '2026-06', archiveMemo: { month: '2026-06', schedules: [{ id: schedule.id, endMonth: null, removed: false }], followers: [fee.id] } })
    expect(t.recurringItems.find((r) => r.id === schedule.id)?.endMonth).toBe('2026-05')
    expect(t.rows.find((r) => r.id === fee.id)?.followsRowId).toBeNull()

    const restored = await restoreRow(store, rent.id)
    expect(restoredText(restored)).toBe('Restored "Rent": its schedule "Rent" runs again; "Service charge" follows it again.')
    t = await loadTables(store)
    expect(t.rows.find((r) => r.id === rent.id)).toMatchObject({ archivedMonth: null, archiveMemo: null })
    expect(t.rows.find((r) => r.id === fee.id)?.followsRowId).toBe(rent.id)
    expect(figures(await engineOf(store))).toEqual(before)
  })

  it('a schedule that started after the archive month was removed by it, and comes back', async () => {
    const { store, rent } = await fresh()
    const later = await addRecurringItem(store, { name: 'Parking', rowId: rent.id, amount: 5000, startMonth: '2026-08' })
    const before = figures(await engineOf(store))
    await archiveRow(store, rent.id, '2026-06')
    expect((await loadTables(store)).recurringItems.find((r) => r.id === later.id)?.deletedAt).not.toBeNull()
    expect(restoredText(await restoreRow(store, rent.id))).toBe('Restored "Rent": its schedules "Rent" and "Parking" run again.')
    expect((await loadTables(store)).recurringItems.find((r) => r.id === later.id)).toMatchObject({ deletedAt: null, startMonth: '2026-08' })
    expect(figures(await engineOf(store))).toEqual(before)
  })

  it('a virtual account: the row that fills it comes back, and what came out of it comes out of it again', async () => {
    const { store, pool, trip, fill } = await fresh()
    const before = figures(await engineOf(store))
    await archivePool(store, pool.id, '2026-03')
    let t = await loadTables(store)
    expect(t.rows.find((r) => r.id === fill.id)?.archivedMonth).toBe('2026-03')
    expect(t.rows.find((r) => r.id === trip.id)?.defaultFundedBy).not.toBe(poolRef(pool.id))
    expect(t.pools.find((p) => p.id === pool.id)?.archiveMemo).toMatchObject({ month: '2026-03', with: [{ table: 'rows', id: fill.id, was: null }], sources: [{ was: poolRef(pool.id), rows: [trip.id] }] })

    const restored = await restorePool(store, pool.id)
    expect(restoredText(restored)).toBe(`Restored "Holidays": "${fill.name}" fills it again; "Trip" comes out of it again.`)
    t = await loadTables(store)
    expect(t.rows.find((r) => r.id === fill.id)).toMatchObject({ archivedMonth: null, archiveMemo: null })
    expect(t.rows.find((r) => r.id === trip.id)?.defaultFundedBy).toBe(poolRef(pool.id))
    expect(figures(await engineOf(store))).toEqual(before)
  })

  it('an account: its virtual accounts, their rows and what came out of all of them', async () => {
    const { store, savings, pool, trip, storage, fill } = await fresh()
    const before = figures(await engineOf(store))
    await archiveAccount(store, savings.id, '2026-06')
    let t = await loadTables(store)
    expect(t.pools.find((p) => p.id === pool.id)?.archivedMonth).toBe('2026-06')
    expect([trip, storage].map((r) => t.rows.find((x) => x.id === r.id)?.defaultFundedBy)).toEqual(['cash', 'cash'])

    const restored = await restoreAccount(store, savings.id)
    expect(restoredText(restored)).toBe(`Restored "Savings": its virtual account "Holidays" is back, filled by "${fill.name}" again; "Trip" comes out of "Holidays" again; "Storage" comes out of it again.`)
    t = await loadTables(store)
    expect(t.pools.find((p) => p.id === pool.id)).toMatchObject({ archivedMonth: null, archiveMemo: null })
    expect(t.rows.find((r) => r.id === trip.id)?.defaultFundedBy).toBe(poolRef(pool.id))
    expect(t.rows.find((r) => r.id === storage.id)?.defaultFundedBy).toBe(`account:${savings.id}`)
    expect(figures(await engineOf(store))).toEqual(before)
  })

  it('what was changed between the archive and the restore stays as it is, and the message says so', async () => {
    const { store, savings, rent, schedule, storage } = await fresh()
    await archiveRow(store, rent.id, '2026-06')
    // the schedule the archive ended in May is ended in April by hand
    await endRecurringItem(store, schedule.id, '2026-04')
    expect(restoredText(await restoreRow(store, rent.id))).toBe('Restored "Rent". 1 thing you changed since stays as it is.')
    expect((await loadTables(store)).recurringItems.find((r) => r.id === schedule.id)?.endMonth).toBe('2026-04')

    await archiveAccount(store, savings.id, '2026-06')
    // "Storage" is given another source while the account is away
    await setRowFundedBy(store, storage.id, 'savings', 'all-months')
    const text = restoredText(await restoreAccount(store, savings.id))
    expect(text).toContain('1 thing you changed since stays as it is.')
    expect((await loadTables(store)).rows.find((r) => r.id === storage.id)?.defaultFundedBy).toBe('savings')
  })

  it('one undo archives it again, and redo restores it again: the data is the same each time', async () => {
    const { store, savings } = await fresh()
    await archiveAccount(store, savings.id, '2026-06')
    const archived = stored(await loadTables(store))
    await restoreAccount(store, savings.id)
    const restored = stored(await loadTables(store))
    const shown = figures(await engineOf(store))

    await store.undo()
    expect(stored(await loadTables(store))).toEqual(archived)
    await store.redo()
    expect(stored(await loadTables(store))).toEqual(restored)
    expect(figures(await engineOf(store))).toEqual(shown)
  })

  it('a virtual account is not restored while its account is archived, nor a "To …" row while its virtual account is', async () => {
    const { store, savings, pool, fill } = await fresh()
    await archiveAccount(store, savings.id, '2026-06')
    await expect(restorePool(store, pool.id)).rejects.toThrow('"Holidays" is held in "Savings", which is archived. Restore the account first.')
    await expect(restoreRow(store, fill.id)).rejects.toThrow(/fills the virtual account "Holidays", which is archived\. Restore the virtual account/)
    expect((await loadTables(store)).pools.find((p) => p.id === pool.id)?.archivedMonth).toBe('2026-06')
  })

  it('something archived before the app kept track comes back by itself, and the message says so', async () => {
    const { store, rent, schedule } = await fresh()
    await archiveRow(store, rent.id, '2026-06')
    // as an older version stored it: archived, with nothing remembered
    const t = await loadTables(store)
    await store.commit([{ op: 'put', table: 'rows', record: { ...t.rows.find((r) => r.id === rent.id)!, archiveMemo: null } }])
    expect(restoredText(await restoreRow(store, rent.id))).toBe('Restored "Rent". "Rent" was archived before the app kept track of what archiving changes, so only "Rent" itself is back.')
    expect((await loadTables(store)).recurringItems.find((r) => r.id === schedule.id)?.endMonth).toBe('2026-05')
  })

  it('works two years later, when the history of changes has been cleared', async () => {
    const { store, savings } = await fresh()
    const before = figures(await engineOf(store))
    await archiveAccount(store, savings.id, '2026-06')
    expect(await store.pruneEvents(Date.now() + 2 * 365 * 86_400_000)).toBeGreaterThan(0)
    await restoreAccount(store, savings.id)
    expect(figures(await engineOf(store))).toEqual(before)
  })

  it('works on a device that got the archive from a file', async () => {
    const { store, savings } = await fresh()
    const before = figures(await engineOf(store))
    await archiveAccount(store, savings.id, '2026-06')
    const other = new Store(new CasaDb(`test-${newId()}`))
    await importReplace(other, await exportSnapshot(store))
    await restoreAccount(other, savings.id)
    expect(figures(await engineOf(other))).toEqual(before)
  })

  it('works on a second device that got the archive through sync, which carries no history of changes', async () => {
    const { store, savings } = await fresh()
    const other = new Store(new CasaDb(`test-${newId()}`))
    await importReplace(other, await exportSnapshot(store))
    const before = figures(await engineOf(store))

    await archiveAccount(store, savings.id, '2026-06')
    const payload = await buildSyncPayload(store, 'device-a')
    expect(payload.events.every((e) => e.type === 'delete')).toBe(true)
    await mergeTables(other, payload.tables, payload.events, { synced: true })
    expect((await loadTables(other)).accounts.find((a) => a.id === savings.id)?.archivedMonth).toBe('2026-06')

    await restoreAccount(other, savings.id)
    expect(figures(await engineOf(other))).toEqual(before)
  })
})
