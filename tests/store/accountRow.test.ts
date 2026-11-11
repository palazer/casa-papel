import { describe, expect, it } from 'vitest'
import { computeEngine } from '@/engine'
import { monthRange, newId } from '@/model'
import { CasaDb, Store, addAccount, addAccountWithRow, addCategory, addPayOffRow, addRowOfKind, loadTables, payOffRowsOf, quickCreateHousehold, setCellValue } from '@/store'

const months = monthRange('2026-01', '2026-03')
const live = <T extends { deletedAt: number | null }>(xs: T[]) => xs.filter((x) => !x.deletedAt)

async function fresh() {
  const store = new Store(new CasaDb(`test-${newId()}`))
  await quickCreateHousehold(store, { name: 'T', baseCurrency: 'EUR', locale: 'en-IE', startMonth: '2026-01' })
  return store
}

describe('an account and its row, made together', () => {
  it('a loan comes with the row that pays it off: one step, one undo, and the payment brings it down', async () => {
    const store = await fresh()
    const before = await loadTables(store)
    const { account, row } = await addAccountWithRow(store, { name: 'Car loan', type: 'loan', currency: 'EUR', openingMonth: '2026-01', openingBalance: 500000 }, { kind: 'pay-off' })
    expect(row).toMatchObject({ name: 'Car loan – Payment', section: 'expense', kind: 'debt-payment', accountId: account.id, defaultStatus: 'committed' })
    await setCellValue(store, row.id, '2026-01', 25000, 'from-now-on')
    const out = computeEngine({ tables: await loadTables(store), months })
    expect(out.accounts[account.id].months['2026-02'].balance).toBe(450000)

    // the amount, then the account with its row: two steps back and nothing of either is left
    await store.undo()
    await store.undo()
    const after = await loadTables(store)
    expect(live(after.accounts).map((a) => a.id)).toEqual(live(before.accounts).map((a) => a.id))
    expect(live(after.rows).map((r) => r.id)).toEqual(live(before.rows).map((r) => r.id))
  })

  it('where a card\'s payment row lives follows what is recorded for the card', async () => {
    const store = await fresh()
    const itemized = await addAccountWithRow(store, { name: 'Visa', type: 'credit-card', currency: 'EUR', openingMonth: '2026-01', card: { cardMode: 'itemized' } }, { kind: 'pay-off' })
    expect(itemized.row).toMatchObject({ name: 'Visa – Payment', section: 'transfer', kind: 'card-payment', accountId: itemized.account.id })
    const lump = await addAccountWithRow(store, { name: 'Store card', type: 'credit-card', currency: 'EUR', openingMonth: '2026-01', card: { cardMode: 'lump' } }, { kind: 'pay-off', name: 'Store card bill' })
    expect(lump.row).toMatchObject({ name: 'Store card bill', section: 'expense', kind: 'card-payment', accountId: lump.account.id })
  })

  it('a savings or an investment account comes with the row that fills it or takes from it, called after the account', async () => {
    const store = await fresh()
    const fund = await addAccountWithRow(store, { name: 'Fund', type: 'investment', currency: 'EUR', openingMonth: '2026-01' }, { kind: 'to-investment' })
    expect(fund.row).toMatchObject({ name: 'To Fund', section: 'transfer', kind: 'to-investment', accountId: fund.account.id })
    const rainy = await addAccountWithRow(store, { name: 'Rainy day', type: 'savings', currency: 'EUR', openingMonth: '2026-01' }, { kind: 'from-savings' })
    expect(rainy.row).toMatchObject({ name: 'From Rainy day', kind: 'from-savings', accountId: rainy.account.id })
    // the row must fit the account: nothing is saved when it does not
    const count = live((await loadTables(store)).accounts).length
    await expect(addAccountWithRow(store, { name: 'Wrong', type: 'savings', currency: 'EUR', openingMonth: '2026-01' }, { kind: 'to-investment' })).rejects.toThrow(/needs an account of type Investments/)
    await expect(addAccountWithRow(store, { name: 'Wrong', type: 'savings', currency: 'EUR', openingMonth: '2026-01' }, { kind: 'pay-off' })).rejects.toThrow(/not a loan or a credit card/)
    expect(live((await loadTables(store)).accounts)).toHaveLength(count)
  })

  it('a category is kept only in the section it belongs to', async () => {
    const store = await fresh()
    const expense = await addCategory(store, { name: 'Transport', section: 'expense' })
    const loan = await addAccountWithRow(store, { name: 'Loan', type: 'loan', currency: 'EUR', openingMonth: '2026-01' }, { kind: 'pay-off', categoryId: expense.id })
    expect(loan.row.categoryId).toBe(expense.id)
    const visa = await addAccountWithRow(store, { name: 'Visa', type: 'credit-card', currency: 'EUR', openingMonth: '2026-01', card: { cardMode: 'itemized' } }, { kind: 'pay-off', categoryId: expense.id })
    expect(visa.row).toMatchObject({ section: 'transfer', categoryId: null })
  })
})

describe('the row that pays a loan or card off, added later', () => {
  it('a loan without a row gets one, linked and called after it; only a loan or a card can', async () => {
    const store = await fresh()
    const loan = await addAccount(store, { name: 'Car loan', type: 'loan', currency: 'EUR', openingMonth: '2026-01', openingBalance: 500000 })
    expect(payOffRowsOf((await loadTables(store)).rows, loan.id)).toEqual([])
    const row = await addPayOffRow(store, loan.id)
    expect(row).toMatchObject({ name: 'Car loan – Payment', section: 'expense', kind: 'debt-payment', accountId: loan.id })
    expect(payOffRowsOf((await loadTables(store)).rows, loan.id).map((r) => r.id)).toEqual([row.id])
    const savings = (await loadTables(store)).accounts.find((a) => a.type === 'savings')!
    await expect(addPayOffRow(store, savings.id)).rejects.toThrow(/Only a loan or a card/)
  })
})

describe('a row without a name', () => {
  it('is called after the account it names; a row that names none needs its name', async () => {
    const store = await fresh()
    const savings = (await loadTables(store)).accounts.find((a) => a.type === 'savings')!
    const from = await addRowOfKind(store, { section: 'transfer', name: '  ', categoryId: null, kind: 'from-savings', accountId: savings.id })
    expect(from.name).toBe(`From ${savings.name}`)
    const kept = await addRowOfKind(store, { section: 'transfer', name: 'Holiday money', categoryId: null, kind: 'from-savings', accountId: savings.id })
    expect(kept.name).toBe('Holiday money')
    await expect(addRowOfKind(store, { section: 'transfer', name: '', categoryId: null, kind: 'plain' })).rejects.toThrow(/Give the row a name/)
    await expect(addRowOfKind(store, { section: 'expense', name: ' ', categoryId: null, kind: 'plain' })).rejects.toThrow(/Give the row a name/)
  })
})
