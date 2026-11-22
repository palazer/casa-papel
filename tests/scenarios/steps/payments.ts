import { cellKey } from '@/engine'
import { newId, type CellItem, type MonthKey } from '@/model'
import { addPaymentMethod, addRecurringItem, itemsFromCurrent, loadTables, saveRowMonth, setUsualPayment } from '@/store'
import { step } from '../registry'
import { ScenarioError, type World } from '../world'

async function methodNamed(world: World, name: string) {
  const method = (await loadTables(world.store)).paymentMethods.find((m) => m.name === name && !m.deletedAt)
  if (!method) throw new ScenarioError(`There is no payment method called "${name}".`)
  return method
}

// Household → Payment methods → "Add method": a label, tied to no account
step('a payment method {string}', async (world: World, name: string) => {
  await addPaymentMethod(world.store, { name, kind: 'other' })
})
// the same, with the note that names an account: a note is words, and nothing reads it
step('a payment method {string} with the note {string}', async (world: World, name: string, note: string) => {
  await addPaymentMethod(world.store, { name, kind: 'other', note })
})

// row menu → "Usually paid…": the method alone, and the day with it
step('{string} is usually paid with the method {string}', async (world: World, rowName: string, methodName: string) => {
  const row = await world.row(rowName)
  await setUsualPayment(world.store, row.id, { payDay: row.payDay ?? null, payMethodId: (await methodNamed(world, methodName)).id })
})
step('{string} is usually paid on day {int} with the method {string}', async (world: World, rowName: string, day: number, methodName: string) => {
  await setUsualPayment(world.store, (await world.row(rowName)).id, { payDay: day, payMethodId: (await methodNamed(world, methodName)).id })
})
step('{string} is usually paid on day {int}', async (world: World, rowName: string, day: number) => {
  const row = await world.row(rowName)
  await setUsualPayment(world.store, row.id, { payDay: day, payMethodId: row.payMethodId ?? null })
})

// one more item in a row's month with "Paid with" set on it, saved from the list of items for that month alone
step('I add the item {string} of {money} to {string} in {month}, paid with {string}', async (world: World, label: string, amount: number, rowName: string, month: MonthKey, methodName: string) => {
  const row = await world.row(rowName)
  const method = await methodNamed(world, methodName)
  const { engine } = await world.view()
  const items: CellItem[] = itemsFromCurrent(engine.cells[cellKey(row.id, month)], row.defaultFundedBy, row.defaultStatus)
  items.push({ id: newId(), label, amount, status: row.defaultStatus, fundedBy: row.defaultFundedBy, date: null, methodId: method.id, note: null, recurringItemId: null, kind: 'normal', skipped: false })
  await saveRowMonth(world.store, row.id, month, { items, repeats: {}, applyTo: {}, others: {}, scope: 'this-month' })
})

// an item that repeats every month, with "Paid with" on its "Repeats" line: its schedule carries the method
step('{string} gets the item {string} of {money} every month from {month}, paid with {string}', async (world: World, rowName: string, label: string, amount: number, from: MonthKey, methodName: string) => {
  const row = await world.row(rowName)
  await addRecurringItem(world.store, { name: label, rowId: row.id, amount, startMonth: from, methodId: (await methodNamed(world, methodName)).id })
})
