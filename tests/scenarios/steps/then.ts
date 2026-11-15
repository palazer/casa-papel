import { expect } from 'vitest'
import { buildFxIndex, cellKey, rateFor } from '@/engine'
import type { MonthKey } from '@/model'
import { monthRange } from '@/model'
import { all } from '../../engine/sound'
import { BRIDGE_TERMS, bridgeOf, type BridgeTerm } from '../checks/bridge'
import { diffFigures } from '../figures'
import { moneyText, monthName, step } from '../registry'
import { ScenarioError, type World } from '../world'

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
  const fx = buildFxIndex(tables.fxRates, { driftMode: household.fxDriftMode ?? 'fixed', fixedDrift: household.fxDriftDefault ?? 0, pairDrift: household.fxPairDrift ?? {}, base: household.baseCurrency })
  const [from, to] = pair.split('/')
  const got = rateFor(fx, from, to, month)
  expect(got == null ? 'no rate' : got.toFixed(4), `${pair} in ${monthName(month)}`).toBe(rate.toFixed(4))
})
