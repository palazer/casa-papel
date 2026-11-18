import { FxRateSchema } from '@/model'
import { addMonths } from '@/model'
import { refreshRates, restoreEcbRate, setManualRate, setPairForecast } from '@/store'
import { step } from '../registry'
import { ScenarioError, type World } from '../world'

// A month's rate as an earlier fetch left it, without the day it was taken on. Written straight into the stored rates.
step('the ECB rate for {pair} in {month} is {rate}', async (world: World, pair: string, month: string, rate: number) => {
  await world.store.commitSystem([{ op: 'put', table: 'fxRates', record: FxRateSchema.parse({ pair, month, rate, source: 'api', updatedAt: Date.now() }) }])
})

// a rate typed on the Currencies screen
step('I set my rate for {pair} in {month} to {rate}', async (world: World, pair: string, month: string, rate: number) => {
  await setManualRate(world.store, pair, month, rate)
})

// The field of a typed rate emptied on the rates card, or "Use the ECB rate again": the official rate of that month is
// fetched in its place. A month to come has none, and is a forecast again.
step('I take my rate for {pair} in {month} back', async (world: World, pair: string, month: string) => {
  await restoreEcbRate(world.store, pair, month, world.rates)
})

// What the ECB published on a day, as the rate service will answer it. Nothing is stored until the app fetches.
step('the official rate for {pair} on {day} is {rate}', async (world: World, pair: string, day: string, rate: number) => {
  const [base, symbol] = pair.split('/')
  const { household } = await world.view()
  if (base !== household.baseCurrency) throw new ScenarioError(`Official rates are fetched against ${household.baseCurrency}: name the pair ${household.baseCurrency}/${symbol}.`)
  ;(world.daily[day] ??= {})[symbol] = rate
})

// what the app does by itself once a day, and "Fetch ECB rates" on the rates card
step('the app brings the rates up to date', async (world: World) => {
  await refreshRates(world.store, world.rates)
})

// "Months to come" on the rates card, per currency: "My own change per month", and "Hold the last rate"
step('my own change for {pair} is {percent} a month', async (world: World, pair: string, change: number) => {
  await setPairForecast(world.store, pair, change)
})

step('I hold the forecast for {pair} at the last known rate', async (world: World, pair: string) => {
  await setPairForecast(world.store, pair, 0)
})

// A year of official rates behind a month: thirteen months, each the given change above the one before. They take
// the place of whatever the scenario held for those months.
step('the {pair} rate has risen by {percent} a month for the last 12 months, to {rate} in {month}', async (world: World, pair: string, change: number, rate: number, month: string) => {
  const records = Array.from({ length: 13 }, (_, back) =>
    FxRateSchema.parse({ pair, month: addMonths(month, -back), rate: rate / Math.pow(1 + change, back), source: 'api', updatedAt: Date.now() }))
  await world.store.commitSystem(records.map((record) => ({ op: 'put' as const, table: 'fxRates' as const, record })))
})
