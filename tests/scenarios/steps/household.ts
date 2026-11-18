import { toSetupInput } from '@/features/setup/start'
import { cellKey } from '@/engine'
import { CellSchema } from '@/model'
import { addPlanYear, createHouseholdFromSetup, exportSnapshot, importReplace, parseExportFile } from '@/store'
import { legacyClose } from '../../legacyClose'
import { monthName, step } from '../registry'
import { ScenarioError, type World } from '../world'

// ---------- the date ----------

step('today is {day}', (world: World, day: string) => {
  world.setToday(day)
})

step('today is in {month}', (world: World, month: string) => {
  world.setToday(`${month}-15`)
})

// the same thing, said as something that happens: the app is opened again in a later month
step('the calendar moves on to {month}', (world: World, month: string) => {
  if (world.day && month < world.thisMonth) throw new ScenarioError('The calendar only moves forward.')
  world.setToday(`${month}-15`)
})

// ---------- the household ----------

// What the app's first screen makes: Sam and Alex, no accounts, no rows, and what is left stays in the account
// (`toSetupInput`). Made in its own first month unless the scenario gave a date before.
step('a household in {ccy} that starts in {month}', async (world: World, currency: string, month: string) => {
  if (!world.day) world.setToday(`${month}-15`)
  await createHouseholdFromSetup(world.store, toSetupInput({ name: 'Sam and Alex', currency, locale: 'en-IE', startMonth: month, adults: ['Sam', 'Alex'], things: [] }))
})

// ---------- data from an older version of the app ----------

// The month is closed the way the app before November 2026 closed it, and is simply there when the app opens the
// data: from an old file, or from a device that was not updated. The app's own pass (the runner's `settle`) meets it.
step('the app opens data in which an older version had closed {month}', async (world: World, month: string) => {
  await legacyClose(world.store, month)
})

// A month that is over and holds no item of the row's schedule and no note that it was left out: what data from an
// older version, or half a sync, can look like. Nothing in the app writes this.
step('a month of {string} that is over has lost its amount without a note: {month}', async (world: World, rowName: string, month: string) => {
  if (month >= world.thisMonth) throw new ScenarioError(`${monthName(month)} is not over yet.`)
  const row = await world.row(rowName)
  const cell = (await world.view()).engine.cells[cellKey(row.id, month)]?.cell
  if (!cell?.items.some((i) => i.recurringItemId)) throw new ScenarioError(`"${rowName}" holds nothing of a schedule in ${monthName(month)}.`)
  await world.store.commitSystem([{ op: 'put', table: 'cells', record: CellSchema.parse({ ...cell, items: cell.items.filter((i) => !i.recurringItemId), updatedAt: Date.now() }) }])
})

// ---------- the plan ----------

step('I add a year to the plan', async (world: World) => {
  await addPlanYear(world.store)
})

// ---------- undo, export and import ----------

step('I undo', async (world: World) => {
  if (!(await world.store.undo())) throw new ScenarioError('There is nothing to undo.')
})

step('I redo', async (world: World) => {
  if (!(await world.store.redo())) throw new ScenarioError('There is nothing to redo.')
})

// the file as it would be written to disk and read back, into an app that has never seen the household
step('I export the data and import it into an empty app', async (world: World) => {
  const file = parseExportFile(JSON.parse(JSON.stringify(await exportSnapshot(world.store))))
  const fresh = world.open()
  await importReplace(fresh, file)
  world.use(fresh)
})
