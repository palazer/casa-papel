import { describe, expect, it } from 'vitest'
import { computeEngine } from '@/engine'
import { monthRange, newId } from '@/model'
import { CasaDb, Store, addAccount, addAccountWithRow, addCategory, addPayOffRow, addPool, addRow, addRowOfKind, archiveThing, loadTables, payOffRowsOf, planAccountChange, quickCreateHousehold, setCellValue, setRowAccount, updateAccount } from '@/store'

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

  it('a card comes with the row that pays it off too, under Expenses, called after the card or as typed', async () => {
    const store = await fresh()
    const visa = await addAccountWithRow(store, { name: 'Visa', type: 'credit-card', currency: 'EUR', openingMonth: '2026-01' }, { kind: 'pay-off' })
    expect(visa.row).toMatchObject({ name: 'Visa – Payment', section: 'expense', kind: 'card-payment', accountId: visa.account.id })
    const named = await addAccountWithRow(store, { name: 'Store card', type: 'credit-card', currency: 'EUR', openingMonth: '2026-01' }, { kind: 'pay-off', name: 'Store card bill' })
    expect(named.row).toMatchObject({ name: 'Store card bill', section: 'expense', kind: 'card-payment', accountId: named.account.id })
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
    const visa = await addAccountWithRow(store, { name: 'Visa', type: 'credit-card', currency: 'EUR', openingMonth: '2026-01' }, { kind: 'pay-off', categoryId: expense.id })
    expect(visa.row).toMatchObject({ section: 'expense', categoryId: expense.id })
    // a category of another section does not come along
    const transfers = await addCategory(store, { name: 'Moves', section: 'transfer' })
    const amex = await addAccountWithRow(store, { name: 'Amex', type: 'credit-card', currency: 'EUR', openingMonth: '2026-01' }, { kind: 'pay-off', categoryId: transfers.id })
    expect(amex.row).toMatchObject({ section: 'expense', categoryId: null })
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

describe('a loan and a card become each other with everything they have', () => {
  const rowOf = async (store: Store, id: string) => (await loadTables(store)).rows.find((r) => r.id === id)!
  const accountOf = async (store: Store, id: string) => (await loadTables(store)).accounts.find((a) => a.id === id)!
  const engineOf = async (store: Store) => computeEngine({ tables: await loadTables(store), months })

  it('a card that becomes a loan, and back: no figure changes, the row keeps its category and takes the kind of what it pays, and one undo takes account and row back', async () => {
    const store = await fresh()
    const cat = await addCategory(store, { name: 'Debts', section: 'expense' })
    const { account, row } = await addAccountWithRow(store, { name: 'Card', type: 'credit-card', currency: 'EUR', openingMonth: '2026-01', openingBalance: 94000_00 }, { kind: 'pay-off', categoryId: cat.id })
    await setCellValue(store, row.id, '2026-01', 5000_00, 'from-now-on')
    const figures = async () => { const out = await engineOf(store); return months.map((m) => [out.accounts[account.id].months[m].balance, out.totals[m].expensesTotal, out.netWorth[m]]) }
    const before = await figures()
    expect(before.map((f) => f[0])).toEqual([89000_00, 84000_00, 79000_00])

    await updateAccount(store, account.id, { type: 'loan' })
    expect(await rowOf(store, row.id)).toMatchObject({ kind: 'debt-payment', section: 'expense', accountId: account.id, categoryId: cat.id })
    expect(await figures()).toEqual(before)

    await store.undo()
    expect((await accountOf(store, account.id)).type).toBe('credit-card')
    expect((await rowOf(store, row.id)).kind).toBe('card-payment')

    await updateAccount(store, account.id, { type: 'loan' })
    await updateAccount(store, account.id, { type: 'credit-card' })
    expect(await rowOf(store, row.id)).toMatchObject({ kind: 'card-payment', section: 'expense', categoryId: cat.id })
    expect(await figures()).toEqual(before)
  })

  it('the plan says nothing is refused and writes only the rows whose kind changes, an archived one too; saved again, nothing about the rows is written', async () => {
    const store = await fresh()
    const { account, row: first } = await addAccountWithRow(store, { name: 'Visa', type: 'credit-card', currency: 'EUR', openingMonth: '2026-01', openingBalance: 900_00 }, { kind: 'pay-off' })
    const second = await addRowOfKind(store, { section: 'expense', name: 'Visa – Old', categoryId: null, kind: 'pay-off', accountId: account.id })
    await archiveThing(store, { kind: 'row', id: second.id }, '2026-03')
    const plan = planAccountChange(await loadTables(store), account, { type: 'loan' })
    expect(plan.refusal).toBeNull()
    expect(plan.mutations).toHaveLength(2)

    await updateAccount(store, account.id, { type: 'loan' })
    const rows = (await loadTables(store)).rows
    expect([first, second].map((r) => rows.find((x) => x.id === r.id)!.kind)).toEqual(['debt-payment', 'debt-payment'])
    // another device's edit of one of them stays the newer record
    const stamps = [first, second].map((r) => rows.find((x) => x.id === r.id)!.updatedAt)
    await updateAccount(store, account.id, { name: 'Car loan' })
    const again = (await loadTables(store)).rows
    expect([first, second].map((r) => again.find((x) => x.id === r.id)!.updatedAt)).toEqual(stamps)
  })

  it('a payment row can be pointed at a loan or at a card, and takes the kind of what it pays; an expense cannot be put on a card', async () => {
    const store = await fresh()
    const { row } = await addAccountWithRow(store, { name: 'Store card', type: 'credit-card', currency: 'EUR', openingMonth: '2026-01', openingBalance: 300_00 }, { kind: 'pay-off' })
    const loan = await addAccount(store, { name: 'Car loan', type: 'loan', currency: 'EUR', openingMonth: '2026-01', openingBalance: 500_00 })
    const visa = await addAccount(store, { name: 'Visa', type: 'credit-card', currency: 'EUR', openingMonth: '2026-01', openingBalance: 200_00 })
    await setRowAccount(store, row.id, loan.id)
    expect(await rowOf(store, row.id)).toMatchObject({ accountId: loan.id, kind: 'debt-payment', section: 'expense' })
    await setRowAccount(store, row.id, visa.id)
    expect(await rowOf(store, row.id)).toMatchObject({ accountId: visa.id, kind: 'card-payment', section: 'expense' })
    const savings = (await loadTables(store)).accounts.find((a) => a.type === 'savings')!
    await expect(setRowAccount(store, row.id, savings.id)).rejects.toThrow(/needs a loan or a credit card/)

    const groceries = await addRow(store, { name: 'Groceries', section: 'expense' })
    await expect(setRowAccount(store, groceries.id, visa.id)).rejects.toThrow(/an expense names no account/)
    expect((await rowOf(store, groceries.id)).accountId).toBeNull()
  })

  it('a row that pays a loan off and was stored with a card\'s kind counts all the same, and is put right the next time the account is saved', async () => {
    const store = await fresh()
    const { account, row } = await addAccountWithRow(store, { name: 'Card', type: 'credit-card', currency: 'EUR', openingMonth: '2026-01', openingBalance: 600_00 }, { kind: 'pay-off' })
    await setCellValue(store, row.id, '2026-01', 100_00, 'from-now-on')
    // what a merge can leave: the account is a loan on one device, the row still a card's on the other
    const stale = await accountOf(store, account.id)
    await store.commit([{ op: 'put', table: 'accounts', record: { ...stale, type: 'loan', updatedAt: Date.now() } }])
    expect((await rowOf(store, row.id)).kind).toBe('card-payment')
    expect((await engineOf(store)).accounts[account.id].months['2026-02'].balance).toBe(400_00)
    await updateAccount(store, account.id, { name: 'Card, now a loan' })
    expect(await rowOf(store, row.id)).toMatchObject({ kind: 'debt-payment', section: 'expense' })
  })
})

describe('any other change of type is refused while something is tied to the account', () => {
  const add = (store: Store, type: 'savings' | 'investment' | 'loan' | 'joint', name: string) => addAccount(store, { name, type, currency: 'EUR', openingMonth: '2026-01' })

  it('a row made for the old type holds it, and the reason names the row', async () => {
    const store = await fresh()
    const { account, row } = await addAccountWithRow(store, { name: 'Rainy day', type: 'savings', currency: 'EUR', openingMonth: '2026-01' }, { kind: 'from-savings' })
    await expect(updateAccount(store, account.id, { type: 'investment' })).rejects.toThrow(/"Rainy day" cannot become an account of type Investments: "From Rainy day" takes money from it\. Change or remove that first\./)
    expect((await loadTables(store)).accounts.find((a) => a.id === account.id)!.type).toBe('savings')
    // archived, the row still counts in the months before: it holds the account as it did
    await archiveThing(store, { kind: 'row', id: row.id }, '2026-01')
    await expect(updateAccount(store, account.id, { type: 'investment' })).rejects.toThrow(/takes money from it/)
  })

  it('a payment row holds a loan that would become savings; a loan and a card are free to become each other', async () => {
    const store = await fresh()
    const { account } = await addAccountWithRow(store, { name: 'Loan', type: 'loan', currency: 'EUR', openingMonth: '2026-01', openingBalance: 100_00 }, { kind: 'pay-off' })
    await expect(updateAccount(store, account.id, { type: 'savings' })).rejects.toThrow(/"Loan – Payment" pays it off/)
    await expect(updateAccount(store, account.id, { type: 'credit-card' })).resolves.toBeUndefined()
  })

  it('a virtual account holds its savings account', async () => {
    const store = await fresh()
    const savings = await add(store, 'savings', 'Pots')
    await addPool(store, { name: 'Travel', accountId: savings.id })
    await expect(updateAccount(store, savings.id, { type: 'investment' })).rejects.toThrow(/the virtual account "Travel" is held in it/)
  })

  it('between money that is held and money that is owed, anything tied to the account holds it; an account with nothing tied changes freely', async () => {
    const store = await fresh()
    const cash = await add(store, 'joint', 'Second account')
    const row = await addRow(store, { name: 'Side job', section: 'income' })
    await setRowAccount(store, row.id, cash.id)
    await expect(updateAccount(store, cash.id, { type: 'loan', tracked: true, openingBalance: 100_00 })).rejects.toThrow(/"Side job" names it/)
    // within the accounts that hold money a plain row is no obstacle
    await expect(updateAccount(store, cash.id, { type: 'savings', tracked: true })).resolves.toBeUndefined()

    const free = await add(store, 'savings', 'Picked wrongly')
    await expect(updateAccount(store, free.id, { type: 'loan', openingBalance: 100_00 })).resolves.toBeUndefined()
    expect((await loadTables(store)).accounts.find((a) => a.id === free.id)!.type).toBe('loan')
  })
})
