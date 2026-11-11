import { describe, expect, it } from 'vitest'
import { computeEngine } from '@/engine'
import { monthRange, newId } from '@/model'
import { CasaDb, Store, addAccount, closeMonth, loadTables, quickCreateHousehold, setCurrentBalances } from '@/store'

const months = monthRange('2026-01', '2026-03')

/** A new household with a main account holding 1,200 and a joint account holding 300; nothing comes in or goes out. */
async function fresh() {
  const store = new Store(new CasaDb(`test-${newId()}`))
  await quickCreateHousehold(store, { name: 'T', baseCurrency: 'EUR', locale: 'en-IE', startMonth: '2026-01', closingRule: 'leftover-plug' })
  const before = (await loadTables(store)).accounts.filter((a) => !a.deletedAt && (a.type === 'checking' || a.type === 'joint' || a.type === 'cash'))
  // whatever a new household starts with, these two are the ones the tests type balances for
  const main = before[0] ?? await addAccount(store, { name: 'Main', type: 'checking', currency: 'EUR', openingMonth: '2026-01', openingBalance: 1200_00 })
  const joint = await addAccount(store, { name: 'Joint', type: 'joint', currency: 'EUR', openingMonth: '2026-01', openingBalance: 300_00 })
  return { store, main, joint, others: before.slice(1) }
}
const mainOf = async (store: Store) => computeEngine({ tables: await loadTables(store), months }).main!

describe('the real balances of the current accounts', () => {
  it('are written for all of them in one step, and one undo takes them back', async () => {
    const { store, main, joint, others } = await fresh()
    expect(others).toEqual([])
    const was = await mainOf(store)
    expect(was.months['2026-01'].entered).toBe(false)
    expect(was.months['2026-01'].computed).toBe(1500_00)
    await setCurrentBalances(store, '2026-01', { [main.id]: 1150_00, [joint.id]: 230_00 })
    const now = await mainOf(store)
    expect(now.months['2026-01']).toMatchObject({ entered: true, adjustment: -120_00, balance: 1380_00 })
    expect(now.months['2026-02'].start).toBe(now.months['2026-01'].balance)
    expect((await loadTables(store)).accountMonths.filter((a) => a.month === '2026-01' && a.actualBalance != null)).toHaveLength(2)
    await store.undo()
    expect(await mainOf(store)).toEqual(was)
  })

  it('go back to the calculated amount with null, and writing the same again changes nothing', async () => {
    const { store, main, joint } = await fresh()
    const was = await mainOf(store)
    await setCurrentBalances(store, '2026-02', { [main.id]: 100_00, [joint.id]: 5_00 })
    const version = store.getVersion()
    await setCurrentBalances(store, '2026-02', { [main.id]: 100_00, [joint.id]: 5_00 })
    expect(store.getVersion()).toBe(version)
    await setCurrentBalances(store, '2026-02', null)
    expect(await mainOf(store)).toEqual(was)
    // clearing a month that has nothing typed is nothing to do
    const after = store.getVersion()
    await setCurrentBalances(store, '2026-03', null)
    expect(store.getVersion()).toBe(after)
  })

  it('refuse a half-filled month, a closed month and a month without a current account', async () => {
    const { store, main, joint } = await fresh()
    await expect(setCurrentBalances(store, '2026-01', { [main.id]: 100_00 })).rejects.toThrow('Fill in every account, or leave them all empty to use the calculated amount.')
    await expect(setCurrentBalances(store, '2026-01', { [main.id]: 100_00, [joint.id]: Number.NaN })).rejects.toThrow('Fill in every account')
    await expect(setCurrentBalances(store, '2025-12', { [main.id]: 1, [joint.id]: 1 })).rejects.toThrow('There is no current account in 2025-12.')
    await closeMonth(store, '2026-01')
    await expect(setCurrentBalances(store, '2026-01', { [main.id]: 100_00, [joint.id]: 5_00 })).rejects.toThrow('2026-01 is closed. Reopen it to change a balance.')
    expect((await loadTables(store)).accountMonths.filter((a) => a.actualBalance != null)).toEqual([])
  })
})
