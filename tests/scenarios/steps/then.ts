import { expect } from 'vitest'
import { cellKey, computeGoals, householdFx, notSetAside, rateFor } from '@/engine'
import type { MonthKey } from '@/model'
import { monthRange } from '@/model'
import { all } from '../../engine/sound'
import { BRIDGE_TERMS, bridgeOf, type BridgeTerm } from '../checks/bridge'
import { diffFigures } from '../figures'
import { moneyText, monthName, step } from '../registry'
import { ScenarioError, type World } from '../world'
import * as app from '@/store'
import { itemsFromCurrent, planRowMonthSave } from '@/store'
import { monthProgress } from '@/features/statement/progress'
import { CURRENCIES, currencyChoices } from '@/app/currencies'
import { formatAmount } from '@/app/format'

/** Amounts are compared as the scenario writes them, so a failure reads "expected 1,200.00, got 1,250.00". */
const same = (got: number, expected: number, what: string) => expect(moneyText(got), what).toBe(moneyText(expected))

// ---------- rows ----------

async function cellOf(world: World, rowName: string, month: MonthKey) {
  const row = await world.row(rowName)
  const { engine, months } = await world.view()
  const cell = engine.cells[cellKey(row.id, month)]
  if (!cell) throw new ScenarioError(`${monthName(month)} is not in the plan (${monthName(months[0])} to ${monthName(months.at(-1)!)}).`)
  return cell
}

// the amount as typed, in the row's own currency
step('{string} is {money} in {month}', async (world: World, row: string, amount: number, month: string) => {
  same((await cellOf(world, row, month)).value, amount, `"${row}" in ${monthName(month)}`)
})

step('{string} is {money} in every month from {month} to {month}', async (world: World, row: string, amount: number, from: string, to: string) => {
  for (const m of monthRange(from, to)) same((await cellOf(world, row, m)).value, amount, `"${row}" in ${monthName(m)}`)
})

// what the month counts for it, in the household's currency
step('{string} counts as {money} in {month}', async (world: World, row: string, amount: number, month: string) => {
  same((await cellOf(world, row, month)).valueBase, amount, `"${row}" in ${monthName(month)}, in the household's currency`)
})

// ---------- accounts ----------

async function accountMonth(world: World, name: string, month: MonthKey): Promise<{ start: number; end: number; worth: number }> {
  const acc = await world.account(name)
  const { engine } = await world.view()
  const series = engine.accounts[acc.id]
  if (series) {
    const r = series.months[month]
    if (!r) throw new ScenarioError(`"${name}" has no balance in ${monthName(month)}.`)
    return { start: r.start, end: r.balance, worth: r.balanceBase }
  }
  // the plan knows the current accounts only together; one alone is that figure
  if (engine.main?.accountIds.includes(acc.id)) {
    if (engine.main.accountIds.length !== 1) throw new ScenarioError('There are several current accounts, and the plan knows them only together: use "the current accounts end … with …".')
    const r = engine.main.months[month]
    if (!r) throw new ScenarioError(`${monthName(month)} is not in the plan.`)
    return { start: r.start, end: r.balance, worth: r.balance }
  }
  throw new ScenarioError(`"${name}" has no balance of its own.`)
}

// in the account's own currency
step('{string} starts {month} with {money}', async (world: World, name: string, month: string, amount: number) => {
  same((await accountMonth(world, name, month)).start, amount, `"${name}" at the start of ${monthName(month)}`)
})
step('{string} ends {month} with {money}', async (world: World, name: string, month: string, amount: number) => {
  same((await accountMonth(world, name, month)).end, amount, `"${name}" at the end of ${monthName(month)}`)
})
// in the household's currency, as the Statement shows it
step('{string} is worth {money} at the end of {month}', async (world: World, name: string, amount: number, month: string) => {
  same((await accountMonth(world, name, month)).worth, amount, `"${name}" at the end of ${monthName(month)}, in the household's currency`)
})

step('the current accounts start {month} with {money}', async (world: World, month: string, amount: number) => {
  same((await world.view()).engine.main?.months[month]?.start ?? NaN, amount, `the current accounts at the start of ${monthName(month)}`)
})
step('the current accounts end {month} with {money}', async (world: World, month: string, amount: number) => {
  same((await world.view()).engine.main?.months[month]?.balance ?? NaN, amount, `the current accounts at the end of ${monthName(month)}`)
})

// ---------- the Statement and net worth ----------

// any line of the month's Statement, by the name it shows: "Income", "Expenses", "Leftover", "Net worth", an account, a row
step('the Statement of {month} shows {string} at {money}', async (world: World, month: string, label: string, amount: number) => {
  const lines = all((await world.view()).statement(month)).filter((l) => l.label === label)
  if (lines.length === 0) throw new ScenarioError(`The Statement of ${monthName(month)} has no line "${label}".`)
  const amounts = [...new Set(lines.map((l) => l.amount))]
  if (amounts.length > 1) throw new ScenarioError(`The Statement of ${monthName(month)} has ${lines.length} lines called "${label}", with different amounts.`)
  same(amounts[0], amount, `"${label}" on the Statement of ${monthName(month)}`)
})

step('the Statement of {month} has no line {string}', async (world: World, month: string, label: string) => {
  expect(all((await world.view()).statement(month)).filter((l) => l.label === label).length, `lines called "${label}" in ${monthName(month)}`).toBe(0)
})

step('net worth is {money} at the end of {month}', async (world: World, amount: number, month: string) => {
  same((await world.view()).engine.netWorth[month] ?? NaN, amount, `net worth at the end of ${monthName(month)}`)
})

// the change, and then its parts: "of that, -100.00 is "moved elsewhere""
step('net worth changes by {money} in {month}', async (world: World, amount: number, month: string) => {
  world.bridgeMonth = month
  same(bridgeOf(await world.view(), month).change, amount, `the change in net worth in ${monthName(month)}`)
})

step('of that, {money} is {string}', async (world: World, amount: number, term: string) => {
  if (!world.bridgeMonth) throw new ScenarioError('Say which month first: "Then net worth changes by … in …".')
  if (!(BRIDGE_TERMS as readonly string[]).includes(term)) throw new ScenarioError(`"${term}" is not one of the parts of a change in net worth: ${BRIDGE_TERMS.join(', ')}.`)
  same(bridgeOf(await world.view(), world.bridgeMonth).terms[term as BridgeTerm], amount, `"${term}" in ${monthName(world.bridgeMonth)}`)
})

// ---------- the plan and the past ----------

step('the plan runs from {month} to {month}', async (world: World, from: string, to: string) => {
  const { months } = await world.view()
  expect(`${monthName(months[0])} to ${monthName(months.at(-1)!)}`, 'the months of the plan').toBe(`${monthName(from)} to ${monthName(to)}`)
})

/** Fails with what changed since the last "When", a few lines of it: a row's amount, an account's balance, a month's sum. */
async function unchanged(world: World, before?: MonthKey): Promise<void> {
  if (!world.mark) throw new ScenarioError('There is no "When" before this step to measure a change against.')
  const changed = diffFigures(world.mark, (await world.view()).figures, { before })
  if (changed.length) throw new Error(`${changed.length} figure${changed.length === 1 ? '' : 's'} changed${before ? ` before ${monthName(before)}` : ''}: ${changed.slice(0, 4).join('; ')}${changed.length > 4 ? '; …' : ''}`)
}

// measured against the figures before the last "When"
step('nothing has changed before {month}', (world: World, month: string) => unchanged(world, month))
step('nothing has changed', (world: World) => unchanged(world))

// ---------- done, and still open to change ----------

step('every amount of {month} is done', async (world: World, month: string) => {
  const { engine } = await world.view()
  const p = monthProgress(engine.rows, engine.cells, month)
  if (p.total === 0) throw new ScenarioError(`${monthName(month)} has no amounts, so there is nothing that could be done.`)
  expect(`${p.done} of ${p.total} done`, `what is ticked in ${monthName(month)}`).toBe(`${p.total} of ${p.total} done`)
})

// asked of the app without saving anything: what the row's dialog would write for another amount in that month
step('{string} can still be changed in {month}', async (world: World, rowName: string, month: string) => {
  const row = await world.row(rowName)
  const { tables, engine } = await world.view()
  const now = itemsFromCurrent(engine.cells[cellKey(row.id, month)], row.defaultFundedBy, row.defaultStatus)
  const items = now.length ? now.map((i, n) => (n === 0 ? { ...i, kind: 'normal' as const, amount: (engine.cells[cellKey(row.id, month)]?.value ?? 0) + 100 } : i)) : []
  const written = planRowMonthSave(tables, engine, row.id, month, { items, scope: 'this-month' }, 1)
  expect(written.length, `what a new amount for "${rowName}" in ${monthName(month)} would write`).toBeGreaterThan(0)
})

// nothing in the data says "closed", and the app has nothing left that would say it
step('no month can be closed or reopened', async (world: World) => {
  const { tables } = await world.view()
  expect(tables.monthStates.filter((s) => s.closed).map((s) => monthName(s.month)), 'the months that are closed').toEqual([])
  expect(Object.keys(app).filter((name) => /^(close|reopen)Month/.test(name)), 'what the app has to close or reopen a month').toEqual([])
})

// the amount as the app writes it, in the currency the month is in: for a currency without cents, where "1,000.00" says nothing
step('{string} reads {string} in {month}', async (world: World, rowName: string, text: string, month: string) => {
  const row = await world.row(rowName)
  const { engine, household } = await world.view()
  const c = engine.cells[cellKey(row.id, month)]
  if (!c) throw new ScenarioError(`"${rowName}" has no month ${monthName(month)}.`)
  // the app puts a space that does not break between a code and its number; a scenario writes a plain one
  expect(formatAmount(c.value, c.currency, household.locale).replace(/[\u00a0\u202f]/g, ' '), `"${rowName}" in ${monthName(month)}`).toBe(text)
})

// ---------- what the app said ----------

step('it is refused with {string}', (world: World, text: string) => {
  const refusal = world.refusal
  world.refusal = null
  expect(refusal ?? 'not refused: it was saved', 'what the app answered').toContain(text)
})

// ---------- rates ----------

// how many of the second currency one of the first buys in the month, to four decimals
step('the rate for {pair} in {month} is {rate}', async (world: World, pair: string, month: string, rate: number) => {
  const { tables, household } = await world.view()
  const fx = householdFx(tables.fxRates, household)
  const [from, to] = pair.split('/')
  const got = rateFor(fx, from, to, month)
  expect(got == null ? 'no rate' : got.toFixed(4), `${pair} in ${monthName(month)}`).toBe(rate.toFixed(4))
})

// the list every currency field offers, in its order; for a household in another currency its own comes first
step('the currencies offered are {ccys}', async (world: World, codes: string[]) => {
  const { household } = await world.view()
  expect(CURRENCIES, 'the currencies offered').toEqual(codes)
  expect(currencyChoices(household.baseCurrency), 'what a currency field of this household offers').toEqual([household.baseCurrency, ...codes.filter((c) => c !== household.baseCurrency)])
})

// ---------- virtual accounts, per person, warnings, goals ----------

step('the virtual account {string} holds {money} at the end of {month}', async (world: World, name: string, amount: number, month: string) => {
  const pool = await world.pool(name)
  const r = (await world.view()).engine.pools[pool.id]?.months[month]
  if (!r) throw new ScenarioError(`"${name}" has no balance in ${monthName(month)}.`)
  same(r.balance, amount, `the virtual account "${name}" at the end of ${monthName(month)}`)
})

// rule X14, decided and not built: a virtual account is kept in its savings account's currency. Today its balance is
// always in the household's currency, which is what this step says until the currency model is built.
step('the virtual account {string} holds {money} {ccy} at the end of {month}', async (world: World, name: string, amount: number, ccy: string, month: string) => {
  const pool = await world.pool(name)
  const view = await world.view()
  const series = view.engine.pools[pool.id] as { currency?: string; months: Record<string, { balance: number }> } | undefined
  const r = series?.months[month]
  if (!series || !r) throw new ScenarioError(`"${name}" has no balance in ${monthName(month)}.`)
  const kept = series.currency ?? view.household.baseCurrency
  if (kept !== ccy) throw new Error(`the virtual account "${name}" is kept in ${kept}, not in ${ccy}`)
  same(r.balance, amount, `the virtual account "${name}" at the end of ${monthName(month)}`)
})

step('the virtual account {string} is short by {money} in {month}', async (world: World, name: string, amount: number, month: string) => {
  const pool = await world.pool(name)
  same((await world.view()).engine.pools[pool.id]?.months[month]?.short ?? NaN, amount, `what "${name}" was short of in ${monthName(month)}`)
})

// what the account holds that no virtual account has set aside ("Not set aside")
step('{string} has {money} not set aside at the end of {month}', async (world: World, name: string, amount: number, month: string) => {
  const acc = await world.account(name)
  const { tables, engine } = await world.view()
  same(notSetAside(tables, engine, acc.id, month) ?? NaN, amount, `what is not set aside in "${name}" at the end of ${monthName(month)}`)
})

// take-home income of one person: income that belongs to them, less what is deducted from it
step('{string} brings home {money} in {month}', async (world: World, name: string, amount: number, month: string) => {
  const entity = await world.entity(name)
  same((await world.view()).engine.totals[month]?.takeHomeBy[entity.id] ?? 0, amount, `what ${name} brings home in ${monthName(month)}`)
})

// the message after an action that says what it did: "Restored "Rent": its schedule "Rent" runs again."
step('the app says {string}', (world: World, text: string) => {
  if (world.said == null) throw new ScenarioError('Nothing was said: this step follows a restore.')
  expect(world.said, 'what the app said').toContain(text)
})

step('the app warns {string}', async (world: World, text: string) => {
  expect((await world.view()).engine.warnings.join(' | '), 'the warnings').toContain(text)
})

step('the app warns about nothing', async (world: World) => {
  expect((await world.view()).engine.warnings, 'the warnings').toEqual([])
})

step('the goal {string} is reached in {month}', async (world: World, name: string, month: string) => {
  const { tables, engine } = await world.view()
  const goal = computeGoals(tables, engine, world.thisMonth).find((g) => g.goal.name === name)
  if (!goal) throw new ScenarioError(`There is no goal called "${name}".`)
  expect(goal.reachedMonth ? monthName(goal.reachedMonth) : `not reached (${goal.status})`, `when "${name}" is reached`).toBe(monthName(month))
})

step('the goal {string} is not reached in the plan', async (world: World, name: string) => {
  const { tables, engine } = await world.view()
  const goal = computeGoals(tables, engine, world.thisMonth).find((g) => g.goal.name === name)
  if (!goal) throw new ScenarioError(`There is no goal called "${name}".`)
  expect(goal.reachedMonth ? monthName(goal.reachedMonth) : 'not reached', `when "${name}" is reached`).toBe('not reached')
})
