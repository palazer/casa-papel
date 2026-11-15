import { addAccount, setMonthBalances, updateAccount } from '@/store'
import type { Account, MonthKey } from '@/model'
import { step } from '../registry'
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
step('I change the yearly growth of {string} to {percent}', async (world: World, name: string, rate: number) => {
  const acc = await world.account(name)
  if (acc.type !== 'investment') throw new ScenarioError(`"${name}" is not an investment account.`)
  await updateAccount(world.store, acc.id, { investment: { ...grows(rate).investment!, ...acc.investment, annualRate: rate } })
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
