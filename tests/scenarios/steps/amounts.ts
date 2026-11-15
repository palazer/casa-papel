import { cellKey } from '@/engine'
import { newId, resolveRules, type CellItem, type MonthKey } from '@/model'
import { clearCell, itemsFromCurrent, saveRowMonth, setCellValue, type EditScope } from '@/store'
import { monthName, step } from '../registry'
import { ScenarioError, type World } from '../world'

/**
 * One amount typed into a row's dialog and saved, as `CellEditor.saveValue` does it: a plain amount with the row's
 * own certainty and source. "Repeats" is "Every month" or "Only this month"; a row a rule works out has no such
 * choice and always saves for every month.
 */
async function typeAmount(world: World, amount: number, rowName: string, month: MonthKey, scope: EditScope): Promise<void> {
  const row = await world.row(rowName)
  const { engine, household } = await world.view()
  const cell = engine.cells[cellKey(row.id, month)]
  if (engine.recurringRowIds.includes(row.id) || cell?.source === 'items') {
    throw new ScenarioError(`"${rowName}" shows a list of items in ${monthName(month)}, not one amount: use the steps that add or change an item.`)
  }
  const ruled = resolveRules(engine.rows, household.closingRule).byRow.has(row.id)
  await setCellValue(world.store, row.id, month, amount, ruled ? 'from-now-on' : scope)
}

step('I type {money} for {string} in {month}, only this month', (world: World, amount: number, row: string, month: string) => typeAmount(world, amount, row, month, 'this-month'))
// "Every month" is what the dialog calls it today; "this and following months" is the wording decided for it
step('I type {money} for {string} in {month}, every month', (world: World, amount: number, row: string, month: string) => typeAmount(world, amount, row, month, 'from-now-on'))
step('I type {money} for {string} in {month}, this and following months', (world: World, amount: number, row: string, month: string) => typeAmount(world, amount, row, month, 'from-now-on'))

// "Clear (inherit)" in the row's dialog
step('I clear {string} in {month}', async (world: World, rowName: string, month: string) => {
  await clearCell(world.store, (await world.row(rowName)).id, month)
})

/** One more item in a row's month, saved from the list of items as `CellEditor.saveItems` does it. */
async function addItem(world: World, label: string, amount: number, rowName: string, month: MonthKey, scope: EditScope): Promise<void> {
  const row = await world.row(rowName)
  const { engine } = await world.view()
  const items: CellItem[] = itemsFromCurrent(engine.cells[cellKey(row.id, month)], row.defaultFundedBy, row.defaultStatus)
  items.push({ id: newId(), label, amount, status: row.defaultStatus, fundedBy: row.defaultFundedBy, date: null, note: null, recurringItemId: null, kind: 'normal', skipped: false })
  await saveRowMonth(world.store, row.id, month, { items, repeats: {}, applyTo: {}, others: {}, scope: engine.recurringRowIds.includes(row.id) ? 'this-month' : scope })
}

step('I add the item {string} of {money} to {string} in {month}, only this month', (world: World, label: string, amount: number, row: string, month: string) => addItem(world, label, amount, row, month, 'this-month'))
step('I add the item {string} of {money} to {string} in {month}, every month', (world: World, label: string, amount: number, row: string, month: string) => addItem(world, label, amount, row, month, 'from-now-on'))
