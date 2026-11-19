import { describe, expect, it } from 'vitest'
import { cellKey, computeEngine, computePersonBudgets } from '@/engine'
import { monthRange, newId } from '@/model'
import { CasaDb, Store, addAccount, addEntity, addPool, addRowOfKind, loadTables, planArchive, planRemoval, quickCreateHousehold, rowTargets, setCellValue, setRowAccount } from '@/store'

const months = monthRange('2026-01', '2026-03')

async function fresh() {
  const store = new Store(new CasaDb(`test-${newId()}`))
  await quickCreateHousehold(store, { name: 'T', baseCurrency: 'EUR', locale: 'en-IE', startMonth: '2026-01' })
  const t = await loadTables(store)
  return { store, savings: t.accounts.find((a) => a.type === 'savings')! }
}

describe('addRowOfKind under Transfers', () => {
  it('a deposit row needs an investment account and then feeds it', async () => {
    const { store, savings } = await fresh()
    await expect(addRowOfKind(store, { section: 'transfer', name: 'Broker', categoryId: null, kind: 'to-investment', accountId: null })).rejects.toThrow(/needs an account of type Investments\./)
    await expect(addRowOfKind(store, { section: 'transfer', name: 'Broker', categoryId: null, kind: 'to-investment', accountId: savings.id })).rejects.toThrow(/is of type Savings/)
    const fund = await addAccount(store, { name: 'Fund', type: 'investment', currency: 'EUR', openingMonth: '2026-01' })
    const row = await addRowOfKind(store, { section: 'transfer', name: 'Broker', categoryId: null, kind: 'to-investment', accountId: fund.id })
    expect(row).toMatchObject({ section: 'transfer', kind: 'to-investment', accountId: fund.id, defaultStatus: 'committed' })
    await setCellValue(store, row.id, '2026-01', 100000, 'from-now-on')
    const out = computeEngine({ tables: await loadTables(store), months })
    expect(out.accounts[fund.id].months['2026-02'].capital).toBe(200000)
  })

  it('beside the row that takes the rest a second "to savings" row is typed and counts; a virtual account that lost its row can be filled again', async () => {
    const { store, savings } = await fresh()
    const rainy = await addAccount(store, { name: 'Rainy day', type: 'savings', currency: 'EUR', openingMonth: '2026-01' })
    const more = await addRowOfKind(store, { section: 'transfer', name: 'To Rainy day', categoryId: null, kind: 'to-savings', accountId: rainy.id })
    expect(more).toMatchObject({ kind: 'to-savings', accountId: rainy.id, rule: 'fixed' })
    await setCellValue(store, more.id, '2026-01', 20000, 'from-now-on')
    const two = computeEngine({ tables: await loadTables(store), months })
    expect(two.accounts[rainy.id].months['2026-02'].balance).toBe(40000)
    // nothing comes in, so the rest account pays for it
    expect(two.accounts[savings.id].months['2026-02'].balance).toBe(-40000)
    const pool = await addPool(store, { name: 'Travel', accountId: savings.id, openingBalance: 0 })
    await expect(addRowOfKind(store, { section: 'transfer', name: 'Travel again', categoryId: null, kind: 'pool-allocation', poolId: pool.id })).rejects.toThrow(/already filled/)
    await expect(addRowOfKind(store, { section: 'transfer', name: 'Travel again', categoryId: null, kind: 'pool-allocation', poolId: newId() })).rejects.toThrow(/Pick the virtual account/)
    let t = await loadTables(store)
    await store.commit(planRemoval(t, { kind: 'row', id: pool.allocationRowId! }, Date.now()))
    const row = await addRowOfKind(store, { section: 'transfer', name: 'Travel again', categoryId: null, kind: 'pool-allocation', poolId: pool.id })
    t = await loadTables(store)
    expect(t.pools.find((p) => p.id === pool.id)?.allocationRowId).toBe(row.id)
    expect(row.accountId).toBe(savings.id)
    await setCellValue(store, row.id, '2026-01', 5000, 'from-now-on')
    const out = computeEngine({ tables: await loadTables(store), months })
    expect(out.pools[pool.id].months['2026-02'].balance).toBe(10000)
  })

  it('a row can take money out of a savings or an investment account into the month', async () => {
    const { store, savings } = await fresh()
    const fund = await addAccount(store, { name: 'Fund', type: 'investment', currency: 'EUR', openingMonth: '2026-01', openingBalance: 500000 })
    await expect(addRowOfKind(store, { section: 'transfer', name: 'From Savings', categoryId: null, kind: 'from-savings', accountId: fund.id })).rejects.toThrow(/is of type Investments/)
    await expect(addRowOfKind(store, { section: 'expense', name: 'From Savings', categoryId: null, kind: 'from-savings', accountId: savings.id })).rejects.toThrow(/does not belong in this section/)
    const fromSavings = await addRowOfKind(store, { section: 'transfer', name: 'From Savings', categoryId: null, kind: 'from-savings', accountId: savings.id })
    const fromFund = await addRowOfKind(store, { section: 'transfer', name: 'From Fund', categoryId: null, kind: 'from-investment', accountId: fund.id })
    expect(fromSavings).toMatchObject({ section: 'transfer', kind: 'from-savings', accountId: savings.id, defaultStatus: 'committed' })
    await setCellValue(store, fromSavings.id, '2026-02', 30000, 'this-month')
    await setCellValue(store, fromFund.id, '2026-02', 20000, 'this-month')
    const out = computeEngine({ tables: await loadTables(store), months })
    expect(out.totals['2026-02']).toMatchObject({ income: 50000, fromAccounts: 50000, takeHome: 0 })
    expect(out.accounts[fund.id].months['2026-02'].outflow).toBe(20000)
    // 500 came into the month and went on to savings as the rest, 300 of it out of the same account
    expect(out.accounts[savings.id].months['2026-02']).toMatchObject({ inflow: 50000, outflow: 30000, balance: 20000 })
    expect(out.totals['2026-03'].fromAccounts).toBe(0)
  })

  it('pocket money is a fixed amount kept by one adult; a plain row is just a transfer', async () => {
    const { store } = await fresh()
    await expect(addRowOfKind(store, { section: 'transfer', name: 'Pocket', categoryId: null, kind: 'pocket-money', adultId: newId() })).rejects.toThrow(/Pick the adult/)
    const pat = await addEntity(store, { kind: 'adult', name: 'Pat' })
    const pocket = await addRowOfKind(store, { section: 'transfer', name: 'Pat – Pocket', categoryId: null, kind: 'pocket-money', adultId: pat.id })
    expect(pocket).toMatchObject({ kind: 'pocket-money', scope: pat.id, pocketMode: 'fixed', entityTags: [pat.id] })
    await setCellValue(store, pocket.id, '2026-01', 5000, 'from-now-on')
    const t = await loadTables(store)
    const out = computeEngine({ tables: t, months })
    expect(out.cells[cellKey(pocket.id, '2026-02')].value).toBe(5000)
    expect(computePersonBudgets(t, out, '2026-01').find((p) => p.entityId === pat.id)?.pocket).toBe(5000)
    const plain = await addRowOfKind(store, { section: 'transfer', name: 'To the joint account', categoryId: null, kind: 'plain' })
    expect(plain).toMatchObject({ kind: 'plain', accountId: null, defaultStatus: 'projected' })
  })

  it('a row that moves money names the account that receives it: one with a balance of its own, which may name the row', async () => {
    const { store } = await fresh()
    const wallet = await addAccount(store, { name: 'Wallet', type: 'cash', currency: 'EUR', openingMonth: '2026-01', openingBalance: 15000 })
    const current = await addAccount(store, { name: 'Main account', type: 'checking', currency: 'EUR', openingMonth: '2026-01' })
    await addAccount(store, { name: 'Joint account', type: 'joint', currency: 'EUR', openingMonth: '2026-01' })
    const named = await addAccount(store, { name: 'Old savings', type: 'savings', currency: 'EUR', openingMonth: '2026-01', tracked: false })
    expect(rowTargets(await loadTables(store), undefined).balances.map((a) => a.name)).toContain('Wallet')
    // an other current account has a balance of its own (rule B9); the main account is where the money comes from
    expect(rowTargets(await loadTables(store), undefined).balances.map((a) => a.name)).toContain('Joint account')
    expect(rowTargets(await loadTables(store), undefined).balances.map((a) => a.name)).not.toContain('Main account')
    expect(rowTargets(await loadTables(store), undefined).balances.map((a) => a.name)).not.toContain('Old savings')

    const move = await addRowOfKind(store, { section: 'transfer', name: '', categoryId: null, kind: 'plain', accountId: wallet.id })
    expect(move).toMatchObject({ kind: 'plain', section: 'transfer', accountId: wallet.id, name: 'To Wallet' })
    await setCellValue(store, move.id, '2026-01', 10000, 'from-now-on')
    const out = computeEngine({ tables: await loadTables(store), months })
    expect(out.accounts[wallet.id].months['2026-01'].balance).toBe(25000)
    expect(out.totals['2026-01']).toMatchObject({ movedToAccounts: 10000, moved: 0 })

    // the current accounts are one balance, and an account that is only named has none: neither can receive it
    await expect(addRowOfKind(store, { section: 'transfer', name: 'Between', categoryId: null, kind: 'plain', accountId: current.id })).rejects.toThrow(/no balance of its own/)
    await expect(addRowOfKind(store, { section: 'transfer', name: 'Old', categoryId: null, kind: 'plain', accountId: named.id })).rejects.toThrow(/no balance of its own/)
    // the row menu's "Goes into…" follows the same rule, and "no account" takes the money out of the plan again
    await expect(setRowAccount(store, move.id, current.id)).rejects.toThrow(/no balance of its own/)
    await setRowAccount(store, move.id, null)
    const gone = computeEngine({ tables: await loadTables(store), months })
    expect(gone.totals['2026-01']).toMatchObject({ movedToAccounts: 0, moved: 10000 })
    expect(gone.accounts[wallet.id].months['2026-01'].balance).toBe(15000)
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
    await expect(addRowOfKind(store, { section: 'transfer', name: 'Late deposits', categoryId: null, kind: 'to-investment', accountId: fund.id })).rejects.toThrow(/is archived/)
  })
})

describe('addRowOfKind under Expenses', () => {
  it('a payment row takes its kind from the account: loans and cards only, never archived, never under Transfers', async () => {
    const { store, savings } = await fresh()
    const loan = await addAccount(store, { name: 'Car loan', type: 'loan', currency: 'EUR', openingMonth: '2026-01', openingBalance: 500000 })
    const card = await addAccount(store, { name: 'Visa', type: 'credit-card', currency: 'EUR', openingMonth: '2026-01', card: { cardMode: 'lump' } })
    const itemized = await addAccount(store, { name: 'Amex', type: 'credit-card', currency: 'EUR', openingMonth: '2026-01' })
    const old = await addAccount(store, { name: 'Old loan', type: 'loan', currency: 'EUR', openingMonth: '2026-01' })
    let t = await loadTables(store)
    // a card whose purchases are expense rows (the default) belongs under Transfers: its payment is not spending
    expect(rowTargets(t, t.household[0]).payoff.map((a) => a.name)).toEqual(['Car loan', 'Visa', 'Old loan'])
    expect(rowTargets(t, t.household[0]).cardsItemized.map((a) => a.name)).toEqual(['Amex'])
    await expect(addRowOfKind(store, { section: 'expense', name: 'Amex', categoryId: null, kind: 'pay-off', accountId: itemized.id })).rejects.toThrow(/add it under Transfers/)
    await expect(addRowOfKind(store, { section: 'transfer', name: 'Visa', categoryId: null, kind: 'card-payment', accountId: card.id })).rejects.toThrow(/add it under Expenses/)
    expect(await addRowOfKind(store, { section: 'transfer', name: 'Amex payment', categoryId: null, kind: 'card-payment', accountId: itemized.id })).toMatchObject({ section: 'transfer', kind: 'card-payment', accountId: itemized.id, defaultStatus: 'committed' })
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
