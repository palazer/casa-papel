import { cellKey } from '@/engine'
import { parseAmount } from '@/app/format'
import { fromMinor, newId, resolveRules, toMinor, type CellItem, type MonthKey } from '@/model'
import { clearCell, itemsFromCurrent, saveRowMonth, setCellItems, setCellValue, updateRow, type EditScope } from '@/store'
import { monthName, step } from '../registry'
import { ScenarioError, type World } from '../world'

/**
 * One amount typed into a row's dialog and saved, as `CellEditor.saveValue` does it: a plain amount with the row's
 * own certainty and source. A month that holds one unnamed item (a single amount with its own certainty or source)
 * shows as a single amount there, and is saved as one item that keeps both. "Repeats" is "This and following months"
 * or "Only this month"; a row a rule works out has no such choice and always saves for every month.
 */
async function typeAmount(world: World, amount: number, rowName: string, month: MonthKey, scope: EditScope): Promise<void> {
  const row = await world.row(rowName)
  const { engine, household } = await world.view()
  const cell = engine.cells[cellKey(row.id, month)]
  const only = cell?.source === 'items' && cell.items.length === 1 ? cell.items[0] : null
  const solo = only && only.kind === 'normal' && !only.label && !only.recurringItemId && !only.skipped ? only : null
  if (engine.recurringRowIds.includes(row.id) || (cell?.source === 'items' && !solo)) {
    throw new ScenarioError(`"${rowName}" shows a list of items in ${monthName(month)}, not one amount: use the steps that add or change an item.`)
  }
  const ruled = resolveRules(engine.rows, household.closingRule).byRow.has(row.id)
  if (solo) {
    // the item as it is stored, with the new amount: what it holds beside the amount stays (a recorded conversion)
    const { effectiveAmount: _worked, ...kept } = solo
    const single: CellItem = { ...kept, amount }
    await setCellItems(world.store, row.id, month, [single], ruled ? 'from-now-on' : scope)
    return
  }
  await setCellValue(world.store, row.id, month, amount, ruled ? 'from-now-on' : scope)
}

step('I type {money} for {string} in {month}, only this month', (world: World, amount: number, row: string, month: string) => typeAmount(world, amount, row, month, 'this-month'))
step('I type {money} for {string} in {month}, this and following months', (world: World, amount: number, row: string, month: string) => typeAmount(world, amount, row, month, 'from-now-on'))

// the amount as it is typed, read in the row's currency as the dialog reads its field: for a currency without cents
step('I type {string} for {string} in {month}, this and following months', async (world: World, typed: string, rowName: string, month: string) => {
  const row = await world.row(rowName)
  const { household } = await world.view()
  const amount = parseAmount(typed, row.currency ?? household.baseCurrency, household.locale)
  if (amount == null) throw new ScenarioError(`"${typed}" is not an amount the dialog can read.`)
  await typeAmount(world, amount, rowName, month, 'from-now-on')
})

// "Currency…" in the row's menu
step('I change the currency of {string} to {ccy}', async (world: World, rowName: string, ccy: string) => {
  const row = await world.row(rowName)
  const { household } = await world.view()
  await updateRow(world.store, row.id, { currency: ccy === household.baseCurrency ? null : ccy })
})

// The currency field beside the amount in the row's dialog, saved with the month as it stands: the digits on screen
// stay and are read in the new currency (`CellEditor.pickCurrency`, then `saveValue`).
step('I change the currency of {string} to {ccy} in its dialog of {month}', async (world: World, rowName: string, ccy: string, month: string) => {
  const row = await world.row(rowName)
  const { engine, household } = await world.view()
  const cell = engine.cells[cellKey(row.id, month)]
  if (cell?.source === 'items') throw new ScenarioError(`"${rowName}" shows a list of items in ${monthName(month)}; this step is for a single amount.`)
  const shown = toMinor(fromMinor(cell?.value ?? 0, cell?.currency ?? row.currency ?? household.baseCurrency), ccy)
  await setCellValue(world.store, row.id, month, shown, 'from-now-on', { currency: ccy === household.baseCurrency ? null : ccy })
})

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
step('I add the item {string} of {money} to {string} in {month}, this and following months', (world: World, label: string, amount: number, row: string, month: string) => addItem(world, label, amount, row, month, 'from-now-on'))
