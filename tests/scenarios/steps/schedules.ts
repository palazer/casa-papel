import { cellKey } from '@/engine'
import { newId, type CellItem, type MonthKey, type RepeatChoice } from '@/model'
import { addRecurringItem, endRecurringItem, itemsFromCurrent, loadTables, reactivateRecurringItem, removeRecurringItem, saveRowMonth, setCellDone, updateRecurringItem, type EditScope } from '@/store'
import { monthName, step } from '../registry'
import { ScenarioError, type World } from '../world'

const monthNumber = (m: MonthKey) => Number(m.slice(5))
const every = (interval: 1 | 2 | 3 | 6 | 12, from: MonthKey): RepeatChoice => ({ kind: 'every', interval, anchor: monthNumber(from) })

/** One amount put "On a schedule" in the row's dialog: it becomes the row's schedule, named after the row (`CellEditor.saveValue`). */
async function schedule(world: World, rowName: string, amount: number, month: MonthKey, repeat: RepeatChoice): Promise<void> {
  const row = await world.row(rowName)
  const single: CellItem = { id: newId(), label: '', amount, status: row.defaultStatus, fundedBy: row.defaultFundedBy, date: null, note: null, recurringItemId: null, kind: 'normal', skipped: false }
  await saveRowMonth(world.store, row.id, month, { items: [single], repeats: { [single.id]: repeat }, scope: 'from-now-on' })
}

step('{string} is on a schedule of {money} every month from {month}', (world: World, row: string, amount: number, from: string) => schedule(world, row, amount, from, every(1, from)))
step('{string} is on a schedule of {money} every 3 months from {month}', (world: World, row: string, amount: number, from: string) => schedule(world, row, amount, from, every(3, from)))
step('{string} is on a schedule of {money} every 6 months from {month}', (world: World, row: string, amount: number, from: string) => schedule(world, row, amount, from, every(6, from)))
step('{string} is on a schedule of {money} once a year from {month}', (world: World, row: string, amount: number, from: string) => schedule(world, row, amount, from, every(12, from)))

/** The month's list of items as the row's dialog shows it. */
async function itemsOf(world: World, rowName: string, month: MonthKey) {
  const row = await world.row(rowName)
  const { engine } = await world.view()
  return { row, onSchedule: engine.recurringRowIds.includes(row.id), items: itemsFromCurrent(engine.cells[cellKey(row.id, month)], row.defaultFundedBy, row.defaultStatus) }
}

// a new item in the list, with "Repeats" set on it
const addRepeating = (interval: 1 | 3 | 6 | 12) => async (world: World, label: string, amount: number, rowName: string, month: MonthKey) => {
  const { row, onSchedule, items } = await itemsOf(world, rowName, month)
  const item: CellItem = { id: newId(), label, amount, status: row.defaultStatus, fundedBy: row.defaultFundedBy, date: null, note: null, recurringItemId: null, kind: 'normal', skipped: false }
  await saveRowMonth(world.store, row.id, month, { items: [...items, item], repeats: { [item.id]: every(interval, month) }, applyTo: {}, others: {}, scope: onSchedule ? 'this-month' : 'from-now-on' })
}
step('I add the item {string} of {money} to {string} in {month}, repeating every month', addRepeating(1))
step('I add the item {string} of {money} to {string} in {month}, repeating every 3 months', addRepeating(3))
step('I add the item {string} of {money} to {string} in {month}, repeating once a year', addRepeating(12))

/** A scheduled item's amount typed over in one month: "Only this month", or "This and following months". */
async function changeItem(world: World, label: string, rowName: string, amount: number, month: MonthKey, applyTo: EditScope): Promise<void> {
  const { row, items } = await itemsOf(world, rowName, month)
  const item = items.find((i) => i.label === label && i.recurringItemId)
  if (!item) throw new ScenarioError(`"${rowName}" has no scheduled item called "${label}" in ${monthName(month)}. It has: ${items.map((i) => `"${i.label}"`).join(', ') || 'nothing'}.`)
  await saveRowMonth(world.store, row.id, month, { items: items.map((i) => (i === item ? { ...i, amount } : i)), repeats: {}, applyTo: { [item.id]: applyTo }, others: {}, scope: 'this-month' })
}
step('I change the item {string} of {string} to {money} in {month}, only this month', (world: World, label: string, row: string, amount: number, month: string) => changeItem(world, label, row, amount, month, 'this-month'))
step('I change the item {string} of {string} to {money} in {month}, this and following months', (world: World, label: string, row: string, amount: number, month: string) => changeItem(world, label, row, amount, month, 'from-now-on'))

// "Repeats: Only this month" on a scheduled item: the schedule ends with this month
step('I stop the item {string} of {string} after {month}', async (world: World, label: string, rowName: string, month: string) => {
  const { row, items } = await itemsOf(world, rowName, month)
  const item = items.find((i) => i.label === label && i.recurringItemId)
  if (!item) throw new ScenarioError(`"${rowName}" has no scheduled item called "${label}" in ${monthName(month)}.`)
  await saveRowMonth(world.store, row.id, month, { items, repeats: { [item.id]: { kind: 'none' } }, applyTo: {}, others: {}, scope: 'this-month' })
})

// "Add schedule…" in the list of schedules (people & things): a schedule made outside the row's month
step('I add the schedule {string} of {money} every month to {string} from {month}', async (world: World, name: string, amount: number, rowName: string, from: string) => {
  await addRecurringItem(world.store, { name, rowId: (await world.row(rowName)).id, amount, startMonth: from, cadence: { intervalMonths: 1, anchorMonth: monthNumber(from) } })
})

// the list's "Edit…", "End after <Month>" and "Reactivate": the schedule is found by its name; the newest piece of it
// is the one the list would be edited on
async function listed(world: World, name: string) {
  const found = (await loadTables(world.store)).recurringItems.filter((r) => !r.deletedAt && r.name === name).sort((a, b) => (a.startMonth < b.startMonth ? 1 : -1))
  if (found.length === 0) throw new ScenarioError(`There is no schedule called "${name}".`)
  return found[0]
}
step('I change the schedule {string} in the list to {money}', async (world: World, name: string, amount: number) => {
  const item = await listed(world, name)
  // the form sends every field, as it stands in the dialog
  await updateRecurringItem(world.store, item.id, { ...item, amount })
})
step('I move the start of the schedule {string} in the list to {month}', async (world: World, name: string, month: string) => {
  const item = await listed(world, name)
  await updateRecurringItem(world.store, item.id, { ...item, startMonth: month })
})
step('I end the schedule {string} in the list after {month}', async (world: World, name: string, month: string) => {
  await endRecurringItem(world.store, (await listed(world, name)).id, month)
})
// the list's "Archive or delete…", answered with "Delete": the schedule goes, and what it posted and was not paid
step('I delete the schedule {string} in the list', async (world: World, name: string) => {
  await removeRecurringItem(world.store, (await listed(world, name)).id)
})
step('I reactivate the schedule {string} in the list', async (world: World, name: string) => {
  await reactivateRecurringItem(world.store, (await listed(world, name)).id)
})

// the done dot of a row's month
step('I mark {string} as done in {month}', async (world: World, rowName: string, month: string) => {
  await setCellDone(world.store, (await world.row(rowName)).id, month, true)
})
