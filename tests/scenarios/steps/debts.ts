import { expect } from 'vitest'
import { AccountSchema, RowSchema, type MonthKey } from '@/model'
import { PAY_OFF, addAccount, addAccountWithRow, addRowOfKind, loadTables, setCellValue, setRowAccount, updateAccount } from '@/store'
import { find } from '../../engine/sound'
import { moneyText, monthName, step } from '../registry'
import { ScenarioError, type World } from '../world'

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

// "Add a card or loan", type "Credit card": a debt that is carried, with what is owed on it now
step('a credit card {string} owing {money}', async (world: World, name: string, owed: number) => {
  const { household } = await world.view()
  await addAccount(world.store, { name, type: 'credit-card', currency: household.baseCurrency, openingMonth: household.startMonth, openingBalance: owed })
})

// "Track the balance month by month in the grid" unticked
step('a credit card {string} that is not tracked', async (world: World, name: string) => {
  const { household } = await world.view()
  await addAccount(world.store, { name, type: 'credit-card', currency: household.baseCurrency, openingMonth: household.startMonth, tracked: false })
})

// the row that pays a loan or a card off, where the app puts it: under Expenses
step('a payment {string} of {money} to {string} from {month}', async (world: World, name: string, amount: number, accountName: string, from: string) => {
  const account = await world.account(accountName)
  const row = await addRowOfKind(world.store, { ...PAY_OFF, name, categoryId: null, accountId: account.id })
  await setCellValue(world.store, row.id, from, amount, 'from-now-on')
})

// what "Paid by card…" did before schema 23; the store refuses it now
step('{string} is put on {string}', async (world: World, rowName: string, accountName: string) => {
  await setRowAccount(world.store, (await world.row(rowName)).id, (await world.account(accountName)).id)
})

// ---------- cards from before schema 23 ----------
// Written as the older app stored them, as data that is simply there: a card had a mode, the payment of a card whose
// purchases were expense rows stood under Transfers, and an expense row named the card it was bought on. The app puts
// them right when it meets them (`planCards`), which the runner lets it do after every step.

const olderCard = async (world: World, name: string, owed: number, payment: number, from: string, cardMode: 'itemized' | 'lump') => {
  const { household } = await world.view()
  const { account, row } = await addAccountWithRow(world.store, { name, type: 'credit-card', currency: household.baseCurrency, openingMonth: household.startMonth, openingBalance: owed }, { kind: 'pay-off' })
  await setCellValue(world.store, row.id, from, payment, 'from-now-on')
  const tables = await loadTables(world.store)
  const stored = tables.rows.find((r) => r.id === row.id)!
  await world.store.commitSystem([
    { op: 'put', table: 'accounts', record: AccountSchema.parse({ ...tables.accounts.find((a) => a.id === account.id)!, card: { cardMode } }) },
    ...(cardMode === 'itemized' ? [{ op: 'put' as const, table: 'rows' as const, record: RowSchema.parse({ ...stored, section: 'transfer' }) }] : []),
  ])
}

step('an older credit card {string} owing {money}, of which only the payments were recorded, paid with {money} a month from {month}', (world: World, name: string, owed: number, payment: number, from: string) =>
  olderCard(world, name, owed, payment, from, 'lump'))

step('an older credit card {string} owing {money}, whose purchases were expense rows, paid with {money} a month from {month}', (world: World, name: string, owed: number, payment: number, from: string) =>
  olderCard(world, name, owed, payment, from, 'itemized'))

step('{string} was bought on {string}', async (world: World, rowName: string, accountName: string) => {
  const row = await world.row(rowName)
  await world.store.commitSystem([{ op: 'put', table: 'rows', record: RowSchema.parse({ ...row, accountId: (await world.account(accountName)).id }) }])
})

// ---------- an account that becomes something else ----------

// the account's form, "Type": a loan and a card become each other with everything they have
step('{string} becomes a loan', async (world: World, name: string) => {
  await updateAccount(world.store, (await world.account(name)).id, { type: 'loan' })
})

step('{string} becomes a credit card', async (world: World, name: string) => {
  await updateAccount(world.store, (await world.account(name)).id, { type: 'credit-card' })
})

step('{string} becomes a savings account', async (world: World, name: string) => {
  await updateAccount(world.store, (await world.account(name)).id, { type: 'savings' })
})

// ---------- the line of a debt on the Statement ----------

async function debtLine(world: World, name: string, month: MonthKey) {
  const line = find((await world.view()).statement(month), `acc:${(await world.account(name)).id}`)
  if (!line) throw new ScenarioError(`The Statement of ${monthName(month)} has no line for "${name}".`)
  return line
}

// what stands under the line when it is opened: the parts that add up to what is owed
step('under {string} in {month} stands {string} at {money}', async (world: World, name: string, month: string, label: string, amount: number) => {
  const line = await debtLine(world, name, month)
  const part = line.children.find((c) => c.label === label)
  if (!part) throw new ScenarioError(`Under "${name}" in ${monthName(month)} stands no "${label}" (there: ${line.children.map((c) => c.label).join(', ') || 'nothing'}).`)
  expect(moneyText(part.amount), `"${label}" under "${name}" in ${monthName(month)}`).toBe(moneyText(amount))
})

// the grey words after the line's figure
step('{string} says {string} in {month}', async (world: World, name: string, text: string, month: string) => {
  expect((await debtLine(world, name, month)).note, `what "${name}" says in ${monthName(month)}`).toBe(text)
})

step('{string} says nothing in {month}', async (world: World, name: string, month: string) => {
  expect((await debtLine(world, name, month)).note, `what "${name}" says in ${monthName(month)}`).toBeUndefined()
})
