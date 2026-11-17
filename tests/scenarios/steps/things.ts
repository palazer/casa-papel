import { addCategory, addGoal, mergeTables, archiveAccount, archivePool, archiveRow, followRow, importMerge, exportSnapshot, parseExportFile, removeAccount, removeRow, restoreAccount, restorePool, restoreRow, setCategoryEstimate, setRowCategory, setRowDeductedFrom, setRowScope } from '@/store'
import type { ExportFile } from '@/model'
import { resolve, step } from '../registry'
import { ScenarioError, type World } from '../world'

// ---------- archive, restore, delete ----------

step('I archive the row {string} from {month}', async (world: World, name: string, month: string) => archiveRow(world.store, (await world.row(name)).id, month))
step('I restore the row {string}', async (world: World, name: string) => restoreRow(world.store, (await world.row(name)).id))
step('I delete the row {string}', async (world: World, name: string) => removeRow(world.store, (await world.row(name)).id))
step('I archive the account {string} from {month}', async (world: World, name: string, month: string) => archiveAccount(world.store, (await world.account(name)).id, month))
step('I restore the account {string}', async (world: World, name: string) => restoreAccount(world.store, (await world.account(name)).id))
step('I delete the account {string}', async (world: World, name: string) => removeAccount(world.store, (await world.account(name)).id))
step('I archive the virtual account {string} from {month}', async (world: World, name: string, month: string) => archivePool(world.store, (await world.pool(name)).id, month))
step('I restore the virtual account {string}', async (world: World, name: string) => restorePool(world.store, (await world.pool(name)).id))

// ---------- rows that depend on other rows ----------

// "Deducted from…": a tax or a contribution taken out of an income
step('{string} is deducted from {string}', async (world: World, rowName: string, incomeName: string) => {
  await setRowDeductedFrom(world.store, (await world.row(rowName)).id, (await world.row(incomeName)).id)
})

// "Follows…": a share of another row's amount, every month
step('{string} follows {string} at {percent}', async (world: World, rowName: string, targetName: string, share: number) => {
  await followRow(world.store, (await world.row(rowName)).id, (await world.row(targetName)).id, share)
})

// "Belongs to…"
step('{string} belongs to {string}', async (world: World, rowName: string, entityName: string) => {
  await setRowScope(world.store, (await world.row(rowName)).id, (await world.entity(entityName)).id)
})

// ---------- categories ----------

step('{string} is in the category {string}', async (world: World, rowName: string, categoryName: string) => {
  await setRowCategory(world.store, (await world.row(rowName)).id, (await world.category(categoryName)).id)
})
step('an expense category {string}', async (world: World, name: string) => {
  await addCategory(world.store, { name, section: 'expense' })
})
// "Set estimate" in the category's menu
step('the category {string} is estimated at {money} from {month}', async (world: World, categoryName: string, amount: number, from: string) => {
  await setCategoryEstimate(world.store, (await world.category(categoryName)).id, from, amount, 'from-now-on')
})

// ---------- goals ----------

step('a goal {string} to have {money} in {string}', async (world: World, name: string, target: number, holder: string) => {
  const { tables } = await world.view()
  const pool = tables.pools.find((p) => !p.deletedAt && p.name === holder)
  const account = tables.accounts.find((a) => !a.deletedAt && a.name === holder)
  if (!pool && !account) throw new ScenarioError(`There is no account or virtual account called "${holder}".`)
  await addGoal(world.store, pool ? { name, kind: 'pool-balance', poolId: pool.id, target, startMonth: world.thisMonth } : { name, kind: account!.type === 'loan' || account!.type === 'credit-card' ? 'pay-off' : 'account-balance', accountId: account!.id, target, startMonth: world.thisMonth })
})
step('a goal {string} to reach a net worth of {money}', async (world: World, name: string, target: number) => {
  await addGoal(world.store, { name, kind: 'net-worth', target, startMonth: world.thisMonth })
})

// ---------- a second device: the same file merged in ----------

const kept = new WeakMap<World, ExportFile>()
step('I export the data to a file', async (world: World) => {
  kept.set(world, parseExportFile(JSON.parse(JSON.stringify(await exportSnapshot(world.store)))))
})
step('I merge that file into the app', async (world: World) => {
  const file = kept.get(world)
  if (!file) throw new ScenarioError('No file was exported in this scenario: "I export the data to a file" comes first.')
  await importMerge(world.store, file)
  world.touch()
})

// ---------- a second device of the same household ----------
// Sync is modelled by what it does to the data: a device takes in the other one's copy, tables and history, through
// the same merge the sync engine calls. Versions, encryption and the network are not part of it.

const copyOf = async (store: World['store']): Promise<ExportFile> => parseExportFile(JSON.parse(JSON.stringify(await exportSnapshot(store))))

step('a second device that has synced', async (world: World) => {
  const file = await copyOf(world.store)
  world.second = world.open()
  await mergeTables(world.second, file.tables, file.events, { synced: true })
})

const second = (world: World) => {
  if (!world.second) throw new ScenarioError('There is no second device yet: "Given a second device that has synced" comes first.')
  return world.second
}

// any other step, carried out on the second device
step('on the second device, {}', async (world: World, text: string) => {
  const first = world.store
  world.use(second(world))
  try {
    await resolve(text).run(world)
  } finally {
    world.use(first)
  }
})

step('the second device takes in what this one has', async (world: World) => {
  const file = await copyOf(world.store)
  await mergeTables(second(world), file.tables, file.events, { synced: true })
})

step('this device takes in what the second one has', async (world: World) => {
  const file = await copyOf(second(world))
  await mergeTables(world.store, file.tables, file.events, { synced: true })
  world.touch()
})
