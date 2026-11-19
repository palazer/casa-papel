import { generateKeyBetween } from 'fractional-indexing'
import { addAccount, setMainAccount, setMonthBalances, updateAccount } from '@/store'
import { AccountSchema, HouseholdSchema, newId, type Account, type MonthKey } from '@/model'
import { monthAtEnd, step } from '../registry'
import { ScenarioError, type World } from '../world'

/** A new account from the account form: in the household's currency and open from its first month unless said. */
async function account(world: World, type: Account['type'], name: string, holding: number, over: Partial<Account> = {}): Promise<void> {
  const { household } = await world.view()
  await addAccount(world.store, { name, type, currency: household.baseCurrency, openingMonth: household.startMonth, openingBalance: holding, ...over })
}

// "a current account" is the main account (rule B9): the month's money runs through it
step('a current account {string} holding {money}', (world: World, name: string, holding: number) => account(world, 'checking', name, holding))
step('a current account {string} holding {money}, opened in {month}', (world: World, name: string, holding: number, month: string) => account(world, 'checking', name, holding, { openingMonth: month }))
step('a current account {string} in {ccy} holding {money}', (world: World, name: string, currency: string, holding: number) => account(world, 'checking', name, holding, { currency }))
// "Other current account" in the form: a joint account, a partner's own, one in another currency, with a balance of its own
step('another current account {string} holding {money}', (world: World, name: string, holding: number) => account(world, 'joint', name, holding))
step('another current account {string} in {ccy} holding {money}', (world: World, name: string, currency: string, holding: number) => account(world, 'joint', name, holding, { currency }))

// ---------- data from before rule B9 ----------

// A current account the way the app before rule B9 kept it, simply there when the app opens the data: from an old
// file, or from a device that was not updated. Every current account was counted together then, in any currency, and
// the household had not been looked at yet. The app's own pass (the runner's `settle`) meets it.
async function older(world: World, name: string, holding: number, currency?: string): Promise<void> {
  const { household, tables } = await world.view()
  const ts = Date.now()
  const last = tables.accounts.filter((a) => !a.deletedAt).map((a) => a.order).sort().at(-1) ?? null
  const acc = AccountSchema.parse({
    id: newId(), createdAt: ts, updatedAt: ts, name, type: 'checking', currency: currency ?? household.baseCurrency, openingMonth: household.startMonth,
    openingBalance: holding, tracked: false, order: generateKeyBetween(last, null),
  })
  await world.store.commitSystem([
    { op: 'put', table: 'accounts', record: acc },
    { op: 'put', table: 'household', record: HouseholdSchema.parse({ ...household, askMainAccount: undefined, updatedAt: ts }) },
  ])
}
step('the app opens data from before rule B9 with a current account {string} holding {money}', (world: World, name: string, holding: number) => older(world, name, holding))
step('the app opens data from before rule B9 with a current account {string} in {ccy} holding {money}', (world: World, name: string, currency: string, holding: number) => older(world, name, holding, currency))

step('{string} is the main account', async (world: World, name: string) => {
  const acc = await world.account(name)
  if (acc.type !== 'checking' || acc.archivedMonth) throw new ScenarioError(`"${name}" is not the main account: it is ${acc.type === 'joint' ? 'an other current account' : `of type ${acc.type}`}${acc.archivedMonth ? ', archived' : ''}.`)
})
step('{string} is an other current account', async (world: World, name: string) => {
  const acc = await world.account(name)
  if (acc.type !== 'joint') throw new ScenarioError(`"${name}" is ${acc.type === 'checking' ? 'a main account' : `of type ${acc.type}`}, not an other current account.`)
})
// "Which is your main account?", once, after the upgrade of a household with several current accounts
step('I am asked which is the main account', async (world: World) => {
  if ((await world.view()).household.askMainAccount !== true) throw new ScenarioError('The app does not ask which is the main account.')
})
step('I am not asked which is the main account', async (world: World) => {
  if ((await world.view()).household.askMainAccount === true) throw new ScenarioError('The app asks which is the main account.')
})
step('I choose {string} as the main account', async (world: World, name: string) => {
  await setMainAccount(world.store, (await world.account(name)).id)
})

step('a savings account {string} holding {money}', (world: World, name: string, holding: number) => account(world, 'savings', name, holding))
step('a savings account {string} holding {money}, opened in {month}', (world: World, name: string, holding: number, month: string) => account(world, 'savings', name, holding, { openingMonth: month }))
step('a savings account {string} in {ccy} holding {money}', (world: World, name: string, currency: string, holding: number) => account(world, 'savings', name, holding, { currency }))

// An investment account grows only when the scenario says by how much. (The account form starts a new one at 5 % a
// year; a scenario that wants what the form gives says "that grows 5% a year".)
const grows = (annualRate: number): Pick<Account, 'investment'> => ({ investment: { projectionMode: 'fixed-rate', annualRate, depositTiming: 'start', depositFxMode: 'monthly-rate', fixedRate: null } })
step('a cash account {string} holding {money}', (world: World, name: string, holding: number) => account(world, 'cash', name, holding))
step('an other asset {string} worth {money}', (world: World, name: string, holding: number) => account(world, 'other-asset', name, holding))
// "Only name it": the account has no balance in the plan
step('a savings account {string} that is only named', (world: World, name: string) => account(world, 'savings', name, 0, { tracked: false }))

step('an investment account {string} holding {money}', (world: World, name: string, holding: number) => account(world, 'investment', name, holding))
step('an investment account {string} holding {money} that grows {percent} a year', (world: World, name: string, holding: number, rate: number) => account(world, 'investment', name, holding, grows(rate)))
step('an investment account {string} in {ccy} holding {money}', (world: World, name: string, currency: string, holding: number) => account(world, 'investment', name, holding, { currency }))
step('an investment account {string} in {ccy} holding {money} that grows {percent} a year', (world: World, name: string, currency: string, holding: number, rate: number) => account(world, 'investment', name, holding, { currency, ...grows(rate) }))

// "Growth per year" in the account's form
async function changeGrowth(world: World, name: string, rate: number) {
  const acc = await world.account(name)
  if (acc.type !== 'investment') throw new ScenarioError(`"${name}" is not an investment account.`)
  await updateAccount(world.store, acc.id, { investment: { ...grows(rate).investment!, ...acc.investment, annualRate: rate } })
}
step('I change the yearly growth of {string} to {percent}', changeGrowth)
// … and answer the question about the past with "Only from <the current month> on" (rule T4)
step('I change the yearly growth of {string} to {percent}, only from the current month on', async (world: World, name: string, rate: number) => {
  world.autoAnswer = 'from-now'
  await changeGrowth(world, name, rate)
})

// ---------- real balances: "Balances for <Month>…" ----------

const real = (when: 'starts' | 'ends') => async (world: World, name: string, amount: number, month: MonthKey) => {
  await setMonthBalances(world.store, month, { [when]: { [(await world.account(name)).id]: amount } })
}
step('{string} really held {money} at the start of {month}', real('starts'))
step('{string} really held {money} at the end of {month}', real('ends'))

step('I clear the real balance of {string} at the end of {month}', async (world: World, name: string, month: string) => {
  await setMonthBalances(world.store, month, { ends: { [(await world.account(name)).id]: null } })
})

// the dialog as it is opened, by its title: "Balances for May 2026" lists every account of the month
step('I open {string} and type {money} for {string}', async (world: World, title: string, amount: number, name: string) => {
  const month = title.startsWith('Balances for ') ? monthAtEnd(title) : null
  if (!month) throw new ScenarioError(`"${title}" is not the title of a month's balances: it reads "Balances for May 2026".`)
  await setMonthBalances(world.store, month, { ends: { [(await world.account(name)).id]: amount } })
})

// the tick under the month's balances: "Count everything in <Month> as done"
step('I count everything in {month} as done', async (world: World, month: string) => {
  await setMonthBalances(world.store, month, {}, { done: true })
})
