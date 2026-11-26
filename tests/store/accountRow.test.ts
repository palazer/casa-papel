import { describe, expect, it } from 'vitest'
import { computeEngine } from '@/engine'
import { monthRange, newId } from '@/model'
import { CasaDb, Store, addAccount, addAccountWithRow, addCategory, addPayOffRow, addPool, addRow, addRowOfKind, archiveThing, loadTables, payOffRowsOf, planAccountChange, quickCreateHousehold, setCellValue, setRowAccount, setRowCategory, setRowDeductedFrom, updateAccount } from '@/store'

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

describe('a loan or a card that changes: the row that pays it off follows', () => {
  const rowOf = async (store: Store, id: string) => (await loadTables(store)).rows.find((r) => r.id === id)!
  const accountOf = async (store: Store, id: string) => (await loadTables(store)).accounts.find((a) => a.id === id)!
  const engineOf = async (store: Store) => computeEngine({ tables: await loadTables(store), months })

  it('a card that becomes a loan is brought down by its payment as before, and the payment stays an expense', async () => {
    const store = await fresh()
    const { account, row } = await addAccountWithRow(store, { name: 'Card', type: 'credit-card', currency: 'EUR', openingMonth: '2026-01', openingBalance: 94000_00, card: { cardMode: 'lump' } }, { kind: 'pay-off' })
    await setCellValue(store, row.id, '2026-01', 5000_00, 'from-now-on')
    // a card that records only its payments comes down with them, as a loan does
    expect((await engineOf(store)).accounts[account.id].months['2026-02'].balance).toBe(84000_00)
    const expenses = (await engineOf(store)).totals['2026-01'].expensesTotal

    await updateAccount(store, account.id, { type: 'loan', card: undefined })
    expect(await rowOf(store, row.id)).toMatchObject({ kind: 'debt-payment', section: 'expense', accountId: account.id })
    expect((await accountOf(store, account.id)).card).toBeUndefined()
    const out = await engineOf(store)
    expect(out.accounts[account.id].months['2026-01'].balance).toBe(89000_00)
    expect(out.accounts[account.id].months['2026-02'].balance).toBe(84000_00)
    expect(out.totals['2026-01'].expensesTotal).toBe(expenses)

    // one step back: the card and its row are as they were
    await store.undo()
    expect(await accountOf(store, account.id)).toMatchObject({ type: 'credit-card', card: { cardMode: 'lump' } })
    expect(await rowOf(store, row.id)).toMatchObject({ kind: 'card-payment', section: 'expense' })
  })

  it('a card whose purchases are expense rows becomes a loan: its payment moves under Expenses, and nothing is "Paid by card" on a loan', async () => {
    const store = await fresh()
    const { account, row } = await addAccountWithRow(store, { name: 'Visa', type: 'credit-card', currency: 'EUR', openingMonth: '2026-01', openingBalance: 1000_00, card: { cardMode: 'itemized' } }, { kind: 'pay-off' })
    const bought = await addRow(store, { name: 'Groceries', section: 'expense' })
    await setRowAccount(store, bought.id, account.id)
    expect(row.section).toBe('transfer')

    const plan = planAccountChange(await loadTables(store), account, { type: 'loan' })
    expect(plan.refusal).toBeNull()
    expect(plan.follows.map((r) => r.id)).toEqual([row.id])
    expect(plan.place).toEqual({ section: 'expense', kind: 'debt-payment' })
    expect(plan.unlinked.map((r) => r.id)).toEqual([bought.id])

    await updateAccount(store, account.id, { type: 'loan', card: undefined })
    expect(await rowOf(store, row.id)).toMatchObject({ kind: 'debt-payment', section: 'expense', categoryId: null })
    expect((await rowOf(store, bought.id)).accountId).toBeNull()
    // under Expenses it can be given a category of that section
    const cat = await addCategory(store, { name: 'Debts', section: 'expense' })
    await setRowCategory(store, row.id, cat.id)
    expect((await rowOf(store, row.id)).categoryId).toBe(cat.id)
  })

  it('a loan that becomes a card: the payment is a card payment, under Transfers where everything bought is recorded', async () => {
    const store = await fresh()
    const cat = await addCategory(store, { name: 'Debts', section: 'expense' })
    const { account, row } = await addAccountWithRow(store, { name: 'Loan', type: 'loan', currency: 'EUR', openingMonth: '2026-01', openingBalance: 5000_00 }, { kind: 'pay-off', categoryId: cat.id })
    const salary = (await loadTables(store)).rows.find((r) => r.section === 'income' && !r.deletedAt)!
    await setRowDeductedFrom(store, row.id, salary.id)
    await setCellValue(store, row.id, '2026-01', 250_00, 'from-now-on')

    await updateAccount(store, account.id, { type: 'credit-card', card: { cardMode: 'itemized' } })
    expect(await rowOf(store, row.id)).toMatchObject({ kind: 'card-payment', section: 'transfer', categoryId: null, deductedFromRowId: null })
    const out = await engineOf(store)
    // the payment brings the card down and is no purchase on it
    expect(out.accounts[account.id].months['2026-01'].balance).toBe(4750_00)

    // "Only what I pay to it": back under Expenses, where the payment is the spending and still brings the card down
    await updateAccount(store, account.id, { card: { cardMode: 'lump' } })
    expect(await rowOf(store, row.id)).toMatchObject({ kind: 'card-payment', section: 'expense', categoryId: null })
    expect((await engineOf(store)).accounts[account.id].months['2026-02'].balance).toBe(4500_00)
  })

  it('several rows move together in the order they had, an archived one too, and a row that fits is not written', async () => {
    const store = await fresh()
    const { account, row: first } = await addAccountWithRow(store, { name: 'Visa', type: 'credit-card', currency: 'EUR', openingMonth: '2026-01', card: { cardMode: 'itemized' } }, { kind: 'pay-off' })
    const second = await addRowOfKind(store, { section: 'transfer', name: 'Visa – Extra', categoryId: null, kind: 'card-payment', accountId: account.id })
    const third = await addRowOfKind(store, { section: 'transfer', name: 'Visa – Old', categoryId: null, kind: 'card-payment', accountId: account.id })
    await archiveThing(store, { kind: 'row', id: third.id }, '2026-03')

    await updateAccount(store, account.id, { type: 'loan', card: undefined, openingBalance: 900_00 })
    const rows = (await loadTables(store)).rows
    const moved = [first, second, third].map((r) => rows.find((x) => x.id === r.id)!)
    expect(moved.map((r) => [r.kind, r.section])).toEqual([['debt-payment', 'expense'], ['debt-payment', 'expense'], ['debt-payment', 'expense']])
    expect(moved.map((r) => r.order)).toEqual([...moved.map((r) => r.order)].sort())
    expect(new Set(moved.map((r) => r.order)).size).toBe(3)
    // they stand after the expense rows that were there
    const before = rows.filter((r) => !r.deletedAt && r.section === 'expense' && !moved.some((m) => m.id === r.id)).map((r) => r.order).sort().at(-1)
    if (before) expect(moved[0].order > before).toBe(true)

    // saved again, nothing about the rows is written: another device's edit of one of them stays the newer record
    const stamps = moved.map((r) => r.updatedAt)
    await updateAccount(store, account.id, { name: 'Car loan' })
    const again = (await loadTables(store)).rows
    expect([first, second, third].map((r) => again.find((x) => x.id === r.id)!.updatedAt)).toEqual(stamps)
  })

  it('a row left behind by an earlier save is put right the next time the account is saved', async () => {
    const store = await fresh()
    const { account, row } = await addAccountWithRow(store, { name: 'Card', type: 'credit-card', currency: 'EUR', openingMonth: '2026-01', openingBalance: 600_00, card: { cardMode: 'lump' } }, { kind: 'pay-off' })
    // what a save wrote before the rows followed: the account alone
    const stale = await accountOf(store, account.id)
    await store.commit([{ op: 'put', table: 'accounts', record: { ...stale, type: 'loan', card: undefined, updatedAt: Date.now() } }])
    expect((await rowOf(store, row.id)).kind).toBe('card-payment')
    await updateAccount(store, account.id, { name: 'Card, now a loan' })
    expect(await rowOf(store, row.id)).toMatchObject({ kind: 'debt-payment', section: 'expense' })
  })

  it('a payment row pointed at a card that records something else moves to where that card puts it', async () => {
    const store = await fresh()
    const { row } = await addAccountWithRow(store, { name: 'Store card', type: 'credit-card', currency: 'EUR', openingMonth: '2026-01', card: { cardMode: 'lump' } }, { kind: 'pay-off' })
    const visa = await addAccount(store, { name: 'Visa', type: 'credit-card', currency: 'EUR', openingMonth: '2026-01', card: { cardMode: 'itemized' } })
    await setRowAccount(store, row.id, visa.id)
    expect(await rowOf(store, row.id)).toMatchObject({ accountId: visa.id, kind: 'card-payment', section: 'transfer', categoryId: null })
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
    await expect(updateAccount(store, account.id, { type: 'credit-card', card: { cardMode: 'lump' } })).resolves.toBeUndefined()
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
