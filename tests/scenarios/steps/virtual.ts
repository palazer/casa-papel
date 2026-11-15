import { accountRef, poolRef, type FundedBy } from '@/model'
import { addPool, setRowFundedBy, topUpPool } from '@/store'
import { step } from '../registry'
import { ScenarioError, type World } from '../world'

// ---------- virtual accounts ----------

step('a virtual account {string} in {string} holding {money}', async (world: World, name: string, accountName: string, holding: number) => {
  await addPool(world.store, { name, accountId: (await world.account(accountName)).id, openingBalance: holding })
})

// with "Set aside every month": its row "To <name>" gets the amount from that month on
step('a virtual account {string} in {string} holding {money}, with {money} set aside every month from {month}', async (world: World, name: string, accountName: string, holding: number, monthly: number, from: string) => {
  await addPool(world.store, { name, accountId: (await world.account(accountName)).id, openingBalance: holding, monthlyAllocation: monthly, fromMonth: from })
})

// "Top up…": from an account, or from the month's income
step('I top up {string} with {money} from {string} in {month}', async (world: World, poolName: string, amount: number, accountName: string, month: string) => {
  await topUpPool(world.store, (await world.pool(poolName)).id, month, { kind: 'account', accountId: (await world.account(accountName)).id }, amount)
})
step('I top up {string} with {money} from the income of {month}', async (world: World, poolName: string, amount: number, month: string) => {
  await topUpPool(world.store, (await world.pool(poolName)).id, month, { kind: 'income' }, amount)
})

// ---------- "Comes out of" ----------

/** A virtual account or an account by its name, as the source of an expense. */
async function source(world: World, name: string): Promise<FundedBy> {
  const { tables } = await world.view()
  const pool = tables.pools.filter((p) => !p.deletedAt && p.name === name)
  const account = tables.accounts.filter((a) => !a.deletedAt && a.name === name)
  if (pool.length + account.length !== 1) throw new ScenarioError(pool.length + account.length === 0 ? `There is no account or virtual account called "${name}".` : `"${name}" is the name of more than one account or virtual account.`)
  return pool.length ? poolRef(pool[0].id) : accountRef(account[0].id)
}

step('{string} comes out of {string} from {month}', async (world: World, rowName: string, sourceName: string, from: string) => {
  await setRowFundedBy(world.store, (await world.row(rowName)).id, await source(world, sourceName), { from })
})
step('{string} comes out of {string} in every month', async (world: World, rowName: string, sourceName: string) => {
  await setRowFundedBy(world.store, (await world.row(rowName)).id, await source(world, sourceName), 'all-months')
})
step('{string} comes out of the month\'s income again from {month}', async (world: World, rowName: string, from: string) => {
  await setRowFundedBy(world.store, (await world.row(rowName)).id, 'cash', { from })
})
