import { describe, expect, it } from 'vitest'
import { computeEngine } from '@/engine'
import { monthRange, newId } from '@/model'
import { CasaDb, Store, addAccount, addEntity, addRowOfKind, loadTables, quickCreateHousehold, setCellValue, setRowAccount, updateAccount } from '@/store'
import { accountVerb, landingAccounts } from '@/features/grid/rowAccount'

const months = monthRange('2026-01', '2026-03')

/** A fresh household with Sam, Sam's pocket money of 235 a month, and a savings account "Pocket savings" holding 2,000. */
async function fresh(over: { outside?: boolean } = {}) {
  const store = new Store(new CasaDb(`test-${newId()}`))
  await quickCreateHousehold(store, { name: 'T', baseCurrency: 'EUR', locale: 'en-IE', startMonth: '2026-01' })
  const sam = await addEntity(store, { kind: 'adult', name: 'Sam' })
  const pocket = await addRowOfKind(store, { section: 'transfer', name: 'Sam – Pocket', categoryId: null, kind: 'pocket-money', adultId: sam.id })
  await setCellValue(store, pocket.id, '2026-01', 235_00, 'from-now-on')
  const pocketSavings = await addAccount(store, { name: 'Pocket savings', type: 'savings', currency: 'EUR', openingMonth: '2026-01', openingBalance: 2000_00, outsideNetWorth: over.outside ?? true })
  const counted = (await loadTables(store)).accounts.find((a) => a.type === 'savings' && a.id !== pocketSavings.id)!
  return { store, pocket, pocketSavings, counted }
}
const balance = async (store: Store, accountId: string, month = '2026-01') => computeEngine({ tables: await loadTables(store), months }).accounts[accountId].months[month].balance

describe('"Lands in" on a pocket money row', () => {
  it('offers the accounts left out of net worth, and the row menu calls it "Lands in"', async () => {
    const { store, pocket, pocketSavings } = await fresh()
    const wallet = await addAccount(store, { name: 'Wallet', type: 'cash', currency: 'EUR', openingMonth: '2026-01', outsideNetWorth: true })
    // a named-only account has no balance for anything to land in; a loan is never left out
    await addAccount(store, { name: 'Named only', type: 'savings', currency: 'EUR', openingMonth: '2026-01', tracked: false, outsideNetWorth: true })
    await addAccount(store, { name: 'Car loan', type: 'loan', currency: 'EUR', openingMonth: '2026-01', outsideNetWorth: true })
    const t = await loadTables(store)
    expect(landingAccounts(t.accounts).map((a) => a.id)).toEqual([pocketSavings.id, wallet.id])
    expect(accountVerb(t.rows.find((r) => r.id === pocket.id)!)).toBe('Lands in')
  })

  it('lands the pocket money in the account, and "Nowhere" stops it', async () => {
    const { store, pocket, pocketSavings } = await fresh()
    expect(await balance(store, pocketSavings.id)).toBe(2000_00)
    await setRowAccount(store, pocket.id, pocketSavings.id)
    expect(await balance(store, pocketSavings.id)).toBe(2235_00)
    expect(await balance(store, pocketSavings.id, '2026-03')).toBe(2705_00)
    await setRowAccount(store, pocket.id, null)
    expect(await balance(store, pocketSavings.id)).toBe(2000_00)
    // one step each: undo brings the link back
    await store.undo()
    expect(await balance(store, pocketSavings.id)).toBe(2235_00)
  })

  it('refuses an account that net worth counts, and one without a balance, and says what to tick', async () => {
    const { store, pocket, counted } = await fresh()
    await expect(setRowAccount(store, pocket.id, counted.id)).rejects.toThrow(`Pocket money can only land in an account that is left out of net worth. Tick "Leave out of net worth" in the form of "${counted.name}" first.`)
    const named = await addAccount(store, { name: 'Named only', type: 'savings', currency: 'EUR', openingMonth: '2026-01', tracked: false, outsideNetWorth: true })
    await expect(setRowAccount(store, pocket.id, named.id)).rejects.toThrow(/has no balance of its own for the pocket money to land in/)
    expect((await loadTables(store)).rows.find((r) => r.id === pocket.id)?.accountId).toBeNull()
  })
})

describe('"Leave out of net worth" on an account', () => {
  it('is stored with the account, and net worth follows it at once', async () => {
    const { store, pocketSavings } = await fresh({ outside: false })
    const netWorth = async () => computeEngine({ tables: await loadTables(store), months }).netWorth['2026-01']
    const counted = await netWorth()
    await updateAccount(store, pocketSavings.id, { outsideNetWorth: true })
    expect((await loadTables(store)).accounts.find((a) => a.id === pocketSavings.id)).toMatchObject({ outsideNetWorth: true })
    expect(await netWorth()).toBe(counted - 2000_00)
    await updateAccount(store, pocketSavings.id, { outsideNetWorth: false })
    expect(await netWorth()).toBe(counted)
  })

  it('cannot be unticked while a pocket money row lands in the account', async () => {
    const { store, pocket, pocketSavings } = await fresh()
    await setRowAccount(store, pocket.id, pocketSavings.id)
    const refusal = '"Sam – Pocket" lands in "Pocket savings", and pocket money can only land in an account that is left out of net worth. Change "Lands in…" in the row\'s menu first.'
    await expect(updateAccount(store, pocketSavings.id, { outsideNetWorth: false })).rejects.toThrow(refusal)
    // a type that cannot be left out at all is the same change
    await expect(updateAccount(store, pocketSavings.id, { type: 'checking' })).rejects.toThrow(refusal)
    // anything else about the account still saves
    await updateAccount(store, pocketSavings.id, { name: 'My pocket' })
    expect((await loadTables(store)).accounts.find((a) => a.id === pocketSavings.id)).toMatchObject({ name: 'My pocket', outsideNetWorth: true })
    // once the row lands nowhere, the account can be counted again
    await setRowAccount(store, pocket.id, null)
    await updateAccount(store, pocketSavings.id, { outsideNetWorth: false })
    expect((await loadTables(store)).accounts.find((a) => a.id === pocketSavings.id)?.outsideNetWorth).toBe(false)
  })
})
