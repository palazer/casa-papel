import { addRowOfKind, setCellValue, setMonthlyDefault, setRowAccount, setRule, updateAccount, type RuleChoice, type RuleTarget } from '@/store'
import { step } from '../registry'
import { ScenarioError, type World } from '../world'

// ---------- rules: how much goes to an account, a virtual account or pocket money ----------

/** What a rule is set on, by name: an account, a virtual account, or a row (pocket money). */
async function target(world: World, name: string): Promise<RuleTarget> {
  const { tables } = await world.view()
  const live = <T extends { name: string; deletedAt: number | null }>(list: T[]) => list.filter((x) => !x.deletedAt && x.name === name)
  const [accounts, pools, rows] = [live(tables.accounts), live(tables.pools), live(tables.rows)]
  if (accounts.length + pools.length + rows.length !== 1) throw new ScenarioError(`"${name}" has to be the name of exactly one account, virtual account or row; it is the name of ${accounts.length + pools.length + rows.length}.`)
  return accounts.length ? { accountId: accounts[0].id } : pools.length ? { poolId: pools[0].id } : { rowId: rows[0].id }
}
const rule = (choice: (n: number) => RuleChoice) => async (world: World, name: string, n: number, from: string) => {
  await setRule(world.store, await target(world, name), choice(n), from)
}

step('{string} gets {percent} of the income from {month}', rule((share) => ({ kind: 'share-of-income', share })))
step('{string} gets {percent} of what is left from {month}', rule((share) => ({ kind: 'share-of-rest', share })))
step('{string} gets {percent} of their own income from {month}', rule((share) => ({ kind: 'share-of-own-income', share })))
step('{string} gets {money} a month from {month}', rule((amount) => ({ kind: 'fixed', amount })))
step('{string} takes the rest of the month from {month}', async (world: World, name: string, from: string) => {
  await setRule(world.store, await target(world, name), { kind: 'rest' }, from)
})

// ---------- pocket money ----------

// "Pocket money for an adult", with the amount typed
step('pocket money {string} for {string} of {money} from {month}', async (world: World, name: string, adult: string, amount: number, from: string) => {
  const row = await addRowOfKind(world.store, { section: 'transfer', name, categoryId: null, kind: 'pocket-money', adultId: (await world.entity(adult)).id })
  await setCellValue(world.store, row.id, from, amount, 'from-now-on')
})
step('pocket money {string} for {string}', async (world: World, name: string, adult: string) => {
  await addRowOfKind(world.store, { section: 'transfer', name, categoryId: null, kind: 'pocket-money', adultId: (await world.entity(adult)).id })
})

// "Lands in…" in the row's menu
step('{string} lands in {string}', async (world: World, rowName: string, accountName: string) => {
  await setRowAccount(world.store, (await world.row(rowName)).id, (await world.account(accountName)).id)
})

// ---------- accounts left out of net worth ----------

step('{string} is left out of net worth', async (world: World, name: string) => {
  await updateAccount(world.store, (await world.account(name)).id, { outsideNetWorth: true })
})
step('{string} is counted in net worth again', async (world: World, name: string) => {
  await updateAccount(world.store, (await world.account(name)).id, { outsideNetWorth: false })
})

// ---------- what stays in the current account ----------

step('the household keeps {money} in the current account every month from {month}', async (world: World, amount: number, from: string) => {
  await setMonthlyDefault(world.store, amount, 'from-now-on', from)
})
