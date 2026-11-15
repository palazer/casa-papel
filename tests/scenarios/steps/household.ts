import { toSetupInput } from '@/features/setup/start'
import { addPlanYear, createHouseholdFromSetup, exportSnapshot, importReplace, parseExportFile } from '@/store'
import { step } from '../registry'
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
