import { addAccount, addAccountWithRow, addRowOfKind, payOffKind, setCellValue, setRowAccount } from '@/store'
import { step } from '../registry'
import type { World } from '../world'

// ---------- loans ----------

// "Add a card or loan" with "Add the row that pays it off": the account and its payment row in one step
step('a loan {string} of {money}, paid off with {money} a month from {month}', async (world: World, name: string, owed: number, payment: number, from: string) => {
  const { household } = await world.view()
  const { row } = await addAccountWithRow(world.store, { name, type: 'loan', currency: household.baseCurrency, openingMonth: household.startMonth, openingBalance: owed }, { kind: 'pay-off' })
  await setCellValue(world.store, row.id, from, payment, 'from-now-on')
})

// the same loan kept in another currency; its payment row is typed in the household's currency
step('a loan {string} in {ccy} of {money}, paid off with {money} a month from {month}', async (world: World, name: string, currency: string, owed: number, payment: number, from: string) => {
  const { household } = await world.view()
  const { row } = await addAccountWithRow(world.store, { name, type: 'loan', currency, openingMonth: household.startMonth, openingBalance: owed }, { kind: 'pay-off' })
  await setCellValue(world.store, row.id, from, payment, 'from-now-on')
})

// ---------- credit cards ----------

// "What do you record for this card?": "Everything I buy with it"
step('a credit card {string} owing {money}, whose purchases are expense rows', async (world: World, name: string, owed: number) => {
  const { household } = await world.view()
  await addAccount(world.store, { name, type: 'credit-card', currency: household.baseCurrency, openingMonth: household.startMonth, openingBalance: owed, card: { cardMode: 'itemized' } })
})

// "Only what I pay to it"
step('a credit card {string} owing {money}, of which only the payments are recorded', async (world: World, name: string, owed: number) => {
  const { household } = await world.view()
  await addAccount(world.store, { name, type: 'credit-card', currency: household.baseCurrency, openingMonth: household.startMonth, openingBalance: owed, card: { cardMode: 'lump' } })
})

// the row that pays a loan or a card off, where the app puts it: under Expenses, or under Transfers for a card whose purchases are expense rows
step('a payment {string} of {money} to {string} from {month}', async (world: World, name: string, amount: number, accountName: string, from: string) => {
  const account = await world.account(accountName)
  const row = await addRowOfKind(world.store, { ...payOffKind(account), name, categoryId: null, accountId: account.id })
  await setCellValue(world.store, row.id, from, amount, 'from-now-on')
})

// "Paid with": an expense bought on a card
step('{string} is paid with {string}', async (world: World, rowName: string, accountName: string) => {
  await setRowAccount(world.store, (await world.row(rowName)).id, (await world.account(accountName)).id)
})
