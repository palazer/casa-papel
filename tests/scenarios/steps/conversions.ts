import { cellKey } from '@/engine'
import { conversionFrom, newId, type CellItem, type ConversionFigures, type MonthKey } from '@/model'
import { addAccount, addRow, setCellDone, setCellItems } from '@/store'
import { monthName, step } from '../registry'
import { ScenarioError, type World } from '../world'

/**
 * "Record the conversion…" in the row's dialog, saved (rule X10): the month's amount becomes one item that is done
 * and carries the conversion. The amount is the one in the row's currency; the other currency is the row's own where
 * it is kept in another one, else the one `foreign` names (the account the amount moves). Saved for this and the
 * following months, as the dialog saves a single amount; the later months carry the amount, not the conversion.
 */
async function record(world: World, rowName: string, month: MonthKey, given: Omit<ConversionFigures, 'foreign' | 'home'>, foreign?: string): Promise<void> {
  const row = await world.row(rowName)
  const { household } = await world.view()
  const home = household.baseCurrency
  const own = row.currency ?? home
  const other = own !== home ? own : foreign
  if (!other) throw new ScenarioError(`"${rowName}" is in ${home}: say which currency the money was converted to.`)
  const conversion = conversionFrom({ ...given, foreign: other, home })
  if (!conversion) throw new ScenarioError(`Two of the three figures are needed to record a conversion for "${rowName}".`)
  const amount = own === home ? conversion.homeAmount : conversion.foreignAmount
  const item: CellItem = { id: newId(), label: '', amount, status: 'done', fundedBy: row.defaultFundedBy, date: null, note: null, recurringItemId: null, kind: 'normal', skipped: false, conversion }
  await setCellItems(world.store, row.id, month, [item], 'from-now-on')
}

/** What was typed into the panel: "3,300.00 USD at 1.1000" or "3,300.00 USD for 3,000.00 EUR". */
function figures(text: string, home: string): Omit<ConversionFigures, 'foreign' | 'home'> {
  const amount = (s: string) => Math.round(Number(s.replace(/,/g, '')) * 100)
  const at = /^([\d,]+\.\d\d) ([A-Z]{3}) at (\d+(?:\.\d+)?)$/.exec(text)
  if (at) return at[2] === home ? { homeAmount: amount(at[1]), rate: Number(at[3]) } : { foreignAmount: amount(at[1]), rate: Number(at[3]) }
  const both = /^([\d,]+\.\d\d) ([A-Z]{3}) for ([\d,]+\.\d\d) ([A-Z]{3})$/.exec(text)
  if (both) {
    const [, a, ca, b] = both
    return ca === home ? { homeAmount: amount(a), foreignAmount: amount(b) } : { foreignAmount: amount(a), homeAmount: amount(b) }
  }
  throw new ScenarioError(`"${text}" says neither "<amount> <code> at <rate>" nor "<amount> <code> for <amount> <code>".`)
}

step('an income {string} in {ccy} with no amount yet', async (world: World, name: string, currency: string) => {
  await addRow(world.store, { name, section: 'income', categoryId: null, currency })
})

step('I record {money} {ccy} for {string} in {month}, converted at {rate}', async (world: World, amount: number, ccy: string, rowName: string, month: string, rate: number) => {
  const { household } = await world.view()
  await record(world, rowName, month, ccy === household.baseCurrency ? { homeAmount: amount, rate } : { foreignAmount: amount, rate }, ccy === household.baseCurrency ? undefined : ccy)
})

// both amounts, as the bank statement shows them: the rate follows from them
step('I record {money} {ccy} for {string} in {month} as {money} {ccy}', async (world: World, a: number, ca: string, rowName: string, month: string, b: number, cb: string) => {
  const { household } = await world.view()
  const home = household.baseCurrency
  if (ca !== home && cb !== home) throw new ScenarioError(`One of the two amounts is in ${home}, the household's currency.`)
  await record(world, rowName, month, ca === home ? { homeAmount: a, foreignAmount: b } : { foreignAmount: a, homeAmount: b }, ca === home ? cb : ca)
})

step('I record for {string} in {month}: {}', async (world: World, rowName: string, month: string, typed: string) => {
  const { household } = await world.view()
  await record(world, rowName, month, figures(typed, household.baseCurrency))
})

// the amount field of the row's dialog, typed over and saved: the conversion stays with its rate (`CellEditor.saveValue`)
step('I correct the amount of {string} in {month} to {money}', async (world: World, rowName: string, month: string, amount: number) => {
  const row = await world.row(rowName)
  const { engine } = await world.view()
  const cell = engine.cells[cellKey(row.id, month)]
  const solo = cell?.source === 'items' && cell.items.length === 1 ? cell.items[0] : null
  if (!solo?.conversion) throw new ScenarioError(`"${rowName}" has no recorded conversion in ${monthName(month)}.`)
  const { effectiveAmount: _worked, ...kept } = solo
  await setCellItems(world.store, row.id, month, [{ ...kept, amount }], 'from-now-on')
})

step('I take the tick off {string} in {month}', async (world: World, rowName: string, month: string) => {
  await setCellDone(world.store, (await world.row(rowName)).id, month, false)
})

// the conversion in force, as the month counts it: the other currency's amount first, then the household's
step('the conversion of {string} in {month} is {money} {ccy} = {money} {ccy} at {rate}', async (world: World, rowName: string, month: string, foreignAmount: number, foreign: string, homeAmount: number, home: string, rate: number) => {
  const row = await world.row(rowName)
  const { engine, household } = await world.view()
  if (home !== household.baseCurrency) throw new ScenarioError(`The second amount is the one in ${household.baseCurrency}, the household's currency.`)
  const parts = engine.cells[cellKey(row.id, month)]?.recorded ?? []
  if (parts.length !== 1) throw new Error(`"${rowName}" in ${monthName(month)} has ${parts.length} recorded conversions, not one`)
  const c = parts[0].conversion
  const said = `${c.foreignAmount / 100} ${c.foreign} = ${c.homeAmount / 100} ${home} at ${c.rate.toFixed(4)}`
  const expected = `${foreignAmount / 100} ${foreign} = ${homeAmount / 100} ${home} at ${rate.toFixed(4)}`
  if (said !== expected) throw new Error(`the conversion of "${rowName}" in ${monthName(month)}: expected ${expected}, it is ${said}`)
})

// "What do you record for this card?": "Everything I buy with it", for a card kept in another currency
step('a credit card {string} in {ccy} owing {money}, whose purchases are expense rows', async (world: World, name: string, currency: string, owed: number) => {
  const { household } = await world.view()
  await addAccount(world.store, { name, type: 'credit-card', currency, openingMonth: household.startMonth, openingBalance: owed, card: { cardMode: 'itemized' } })
})
