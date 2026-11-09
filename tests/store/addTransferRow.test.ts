import { describe, expect, it } from 'vitest'
import { cellKey, computeEngine, computePersonBudgets } from '@/engine'
import { monthRange, newId } from '@/model'
import { CasaDb, Store, addAccount, addEntity, addPool, addRowOfKind, addTransferRow, loadTables, planArchive, planRemoval, quickCreateHousehold, rowTargets, setCellValue } from '@/store'

const months = monthRange('2026-01', '2026-03')

async function fresh() {
  const store = new Store(new CasaDb(`test-${newId()}`))
  await quickCreateHousehold(store, { name: 'T', baseCurrency: 'EUR', locale: 'en-IE', startMonth: '2026-01' })
  const t = await loadTables(store)
  return { store, savings: t.accounts.find((a) => a.type === 'savings')! }
}

describe('addTransferRow', () => {
  it('a deposit row needs an investment account and then feeds it', async () => {
    const { store, savings } = await fresh()
    await expect(addTransferRow(store, { name: 'Broker', categoryId: null, kind: 'to-investment', accountId: null })).rejects.toThrow(/needs an account of type Investments\./)
    await expect(addTransferRow(store, { name: 'Broker', categoryId: null, kind: 'to-investment', accountId: savings.id })).rejects.toThrow(/is of type Savings/)
    const fund = await addAccount(store, { name: 'Fund', type: 'investment', currency: 'EUR', openingMonth: '2026-01' })
    const row = await addTransferRow(store, { name: 'Broker', categoryId: null, kind: 'to-investment', accountId: fund.id })
    expect(row).toMatchObject({ section: 'transfer', kind: 'to-investment', accountId: fund.id, defaultStatus: 'committed' })
    await setCellValue(store, row.id, '2026-01', 100000, 'from-now-on')
    const out = computeEngine({ tables: await loadTables(store), months })
    expect(out.accounts[fund.id].months['2026-02'].capital).toBe(200000)
  })

  it('under the savings plug a second "to savings" row is refused; a pool account that lost its row can be filled again', async () => {
    const { store, savings } = await fresh()
    await expect(addTransferRow(store, { name: 'More savings', categoryId: null, kind: 'to-savings', accountId: savings.id })).rejects.toThrow(/would stay at zero/)
    const pool = await addPool(store, { name: 'Travel', accountId: savings.id, openingBalance: 0 })
    await expect(addTransferRow(store, { name: 'Travel again', categoryId: null, kind: 'pool-allocation', poolId: pool.id })).rejects.toThrow(/already filled/)
    await expect(addTransferRow(store, { name: 'Travel again', categoryId: null, kind: 'pool-allocation', poolId: newId() })).rejects.toThrow(/Pick the pool account/)
    let t = await loadTables(store)
    await store.commit(planRemoval(t, { kind: 'row', id: pool.allocationRowId! }, Date.now()))
    const row = await addTransferRow(store, { name: 'Travel again', categoryId: null, kind: 'pool-allocation', poolId: pool.id })
    t = await loadTables(store)
    expect(t.pools.find((p) => p.id === pool.id)?.allocationRowId).toBe(row.id)
    expect(row.accountId).toBe(savings.id)
    await setCellValue(store, row.id, '2026-01', 5000, 'from-now-on')
    const out = computeEngine({ tables: await loadTables(store), months })
    expect(out.pools[pool.id].months['2026-02'].balance).toBe(10000)
  })

  it('pocket money is a fixed amount kept by one adult; a plain row is just a transfer', async () => {
    const { store } = await fresh()
    await expect(addTransferRow(store, { name: 'Pocket', categoryId: null, kind: 'pocket-money', adultId: newId() })).rejects.toThrow(/Pick the adult/)
    const pat = await addEntity(store, { kind: 'adult', name: 'Pat' })
    const pocket = await addTransferRow(store, { name: 'Pat – Pocket', categoryId: null, kind: 'pocket-money', adultId: pat.id })
    expect(pocket).toMatchObject({ kind: 'pocket-money', scope: pat.id, pocketMode: 'fixed', entityTags: [pat.id] })
    await setCellValue(store, pocket.id, '2026-01', 5000, 'from-now-on')
    const t = await loadTables(store)
    const out = computeEngine({ tables: t, months })
    expect(out.cells[cellKey(pocket.id, '2026-02')].value).toBe(5000)
    expect(computePersonBudgets(t, out, '2026-01').find((p) => p.entityId === pat.id)?.pocket).toBe(5000)
    const plain = await addTransferRow(store, { name: 'To the joint account', categoryId: null, kind: 'plain' })
    expect(plain).toMatchObject({ kind: 'plain', accountId: null, defaultStatus: 'projected' })
  })
})

describe('rowTargets', () => {
  it('leaves archived accounts out, and the store refuses them too', async () => {
    const { store } = await fresh()
    const fund = await addAccount(store, { name: 'Old fund', type: 'investment', currency: 'EUR', openingMonth: '2026-01' })
    let t = await loadTables(store)
    expect(rowTargets(t, t.household[0]).investments.map((a) => a.id)).toEqual([fund.id])
    await store.commit(planArchive(t, { kind: 'account', id: fund.id }, '2026-02', Date.now()))
    t = await loadTables(store)
    expect(rowTargets(t, t.household[0]).investments).toEqual([])
    expect(rowTargets(t, t.household[0]).plugTaken).toBe(true)
    await expect(addTransferRow(store, { name: 'Late deposits', categoryId: null, kind: 'to-investment', accountId: fund.id })).rejects.toThrow(/is archived/)
  })
})

describe('addRowOfKind under Expenses', () => {
  it('a payment row takes its kind from the account: loans and cards only, never archived, never under Transfers', async () => {
    const { store, savings } = await fresh()
    const loan = await addAccount(store, { name: 'Car loan', type: 'loan', currency: 'EUR', openingMonth: '2026-01', openingBalance: 500000 })
    const card = await addAccount(store, { name: 'Visa', type: 'credit-card', currency: 'EUR', openingMonth: '2026-01' })
    const old = await addAccount(store, { name: 'Old loan', type: 'loan', currency: 'EUR', openingMonth: '2026-01' })
    let t = await loadTables(store)
    expect(rowTargets(t, t.household[0]).payoff.map((a) => a.name)).toEqual(['Car loan', 'Visa', 'Old loan'])
    await expect(addRowOfKind(store, { section: 'expense', name: 'Loan', categoryId: null, kind: 'pay-off', accountId: savings.id })).rejects.toThrow(/not a loan or a credit card/)
    await expect(addRowOfKind(store, { section: 'expense', name: 'Loan', categoryId: null, kind: 'pay-off', accountId: null })).rejects.toThrow(/Pick the loan or card/)
    await expect(addRowOfKind(store, { section: 'transfer', name: 'Loan', categoryId: null, kind: 'pay-off', accountId: loan.id })).rejects.toThrow(/does not belong/)
    await expect(addRowOfKind(store, { section: 'expense', name: 'Dep', categoryId: null, kind: 'to-investment', accountId: loan.id })).rejects.toThrow(/does not belong/)
    const pay = await addRowOfKind(store, { section: 'expense', name: 'Car loan payment', categoryId: null, kind: 'pay-off', accountId: loan.id })
    expect(pay).toMatchObject({ section: 'expense', kind: 'debt-payment', accountId: loan.id, defaultStatus: 'committed' })
    expect(await addRowOfKind(store, { section: 'expense', name: 'Visa payment', categoryId: null, kind: 'pay-off', accountId: card.id })).toMatchObject({ kind: 'card-payment', accountId: card.id })
    await setCellValue(store, pay.id, '2026-01', 20000, 'from-now-on')
    const out = computeEngine({ tables: await loadTables(store), months })
    expect(out.accounts[loan.id].months['2026-03'].balance).toBe(440000)
    t = await loadTables(store)
    await store.commit(planArchive(t, { kind: 'account', id: old.id }, '2026-02', Date.now()))
    await expect(addRowOfKind(store, { section: 'expense', name: 'Late', categoryId: null, kind: 'pay-off', accountId: old.id })).rejects.toThrow(/is archived/)
  })
})
