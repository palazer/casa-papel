import { describe, expect, it } from 'vitest'
import { buildStatement, computeEngine } from '@/engine'
import { monthRange, newId } from '@/model'
import { CasaDb, Store, addAccount, addPool, loadTables, moveAccount, movePool, quickCreateHousehold, updateAccount } from '@/store'

const months = monthRange('2026-01', '2026-12')

async function fresh() {
  const store = new Store(new CasaDb(`test-${newId()}`))
  await quickCreateHousehold(store, { name: 'T', baseCurrency: 'EUR', locale: 'en-IE', startMonth: '2026-01' })
  const make = (name: string, type: 'savings' | 'investment' | 'loan') => addAccount(store, { name, type, currency: 'EUR', openingMonth: '2026-01', openingBalance: 100000 })
  return { store, make }
}

/** The accounts under one heading of the Statement's lower half, by name, in the order shown. */
async function shown(store: Store, heading: string): Promise<Array<{ id: string; name: string }>> {
  const tables = await loadTables(store)
  const s = buildStatement(tables, computeEngine({ tables, months }), '2026-01')!
  const line = [...s.position.left.lines, ...s.position.right.lines].find((l) => l.id === heading)
  return (line?.children ?? []).filter((c) => c.accountId).map((c) => ({ id: c.accountId!, name: c.label }))
}
const names = (list: Array<{ name: string }>) => list.map((x) => x.name)
const ids = (list: Array<{ id: string }>) => list.map((x) => x.id)

describe('an account moved up or down on the Statement', () => {
  it('swaps with its neighbour under the same heading, stops at the ends, and one undo puts it back', async () => {
    const { store, make } = await fresh()
    const a = await make('Instant', 'savings')
    const fund = await make('Fund', 'investment')
    const b = await make('Rainy day', 'savings')
    const c = await make('Holiday', 'savings')
    // the household starts with one savings account of its own
    expect(names(await shown(store, 'savings-accounts'))).toEqual(['Savings', 'Instant', 'Rainy day', 'Holiday'])

    await moveAccount(store, c.id, 'up', ids(await shown(store, 'savings-accounts')))
    expect(names(await shown(store, 'savings-accounts'))).toEqual(['Savings', 'Instant', 'Holiday', 'Rainy day'])
    await moveAccount(store, a.id, 'up', ids(await shown(store, 'savings-accounts')))
    expect(names(await shown(store, 'savings-accounts'))).toEqual(['Instant', 'Savings', 'Holiday', 'Rainy day'])
    // the other heading is not touched: only the two that swap are written
    expect(names(await shown(store, 'investment-accounts'))).toEqual(['Fund'])
    expect((await loadTables(store)).accounts.find((x) => x.id === fund.id)!.updatedAt).toBe(fund.updatedAt)

    // at an end there is nowhere to go: nothing is written, so there is nothing to undo for it
    const before = JSON.stringify((await loadTables(store)).accounts)
    await moveAccount(store, a.id, 'up', ids(await shown(store, 'savings-accounts')))
    await moveAccount(store, b.id, 'down', ids(await shown(store, 'savings-accounts')))
    expect(JSON.stringify((await loadTables(store)).accounts)).toBe(before)

    await store.undo()
    expect(names(await shown(store, 'savings-accounts'))).toEqual(['Savings', 'Instant', 'Holiday', 'Rainy day'])
  })

  it('accounts whose places are the same get places of their own, so the move shows', async () => {
    const { store, make } = await fresh()
    const a = await make('Car loan', 'loan')
    const b = await make('Loan from a friend', 'loan')
    const c = await make('Study loan', 'loan')
    for (const x of [a, b, c]) await updateAccount(store, x.id, { order: 'a0' })
    const list = await shown(store, 'debts')
    await moveAccount(store, list[2].id, 'up', ids(list))
    const after = await shown(store, 'debts')
    expect(names(after)).toEqual([list[0].name, list[2].name, list[1].name])
    const orders = (await loadTables(store)).accounts.filter((x) => ids(after).includes(x.id)).map((x) => x.order)
    expect(new Set(orders).size).toBe(3)
  })

  it('a virtual account moves among those of its savings account', async () => {
    const { store, make } = await fresh()
    const savings = await make('Savings', 'savings')
    const travel = await addPool(store, { name: 'Travel', accountId: savings.id, openingBalance: 0 })
    const clothing = await addPool(store, { name: 'Clothing', accountId: savings.id, openingBalance: 0 })
    const gifts = await addPool(store, { name: 'Gifts', accountId: savings.id, openingBalance: 0 })
    const order = async () => (await loadTables(store)).pools.filter((p) => !p.deletedAt).sort((x, y) => (x.order < y.order ? -1 : 1)).map((p) => p.name)
    expect(await order()).toEqual(['Travel', 'Clothing', 'Gifts'])
    await movePool(store, gifts.id, 'up', [travel.id, clothing.id, gifts.id])
    expect(await order()).toEqual(['Travel', 'Gifts', 'Clothing'])
    await movePool(store, travel.id, 'up', [travel.id, gifts.id, clothing.id])
    expect(await order()).toEqual(['Travel', 'Gifts', 'Clothing'])
    await store.undo()
    expect(await order()).toEqual(['Travel', 'Clothing', 'Gifts'])
  })
})
