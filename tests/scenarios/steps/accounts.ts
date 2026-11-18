import { addAccount, setMonthBalances, updateAccount } from '@/store'
import type { Account, MonthKey } from '@/model'
import { monthAtEnd, step } from '../registry'
import { ScenarioError, type World } from '../world'

/** A new account from the account form: in the household's currency and open from its first month unless said. */
async function account(world: World, type: Account['type'], name: string, holding: number, over: Partial<Account> = {}): Promise<void> {
  const { household } = await world.view()
  await addAccount(world.store, { name, type, currency: household.baseCurrency, openingMonth: household.startMonth, openingBalance: holding, ...over })
}

step('a current account {string} holding {money}', (world: World, name: string, holding: number) => account(world, 'checking', name, holding))
step('a current account {string} holding {money}, opened in {month}', (world: World, name: string, holding: number, month: string) => account(world, 'checking', name, holding, { openingMonth: month }))
step('a current account {string} in {ccy} holding {money}', (world: World, name: string, currency: string, holding: number) => account(world, 'checking', name, holding, { currency }))

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
