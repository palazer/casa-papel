import { FxRateSchema } from '@/model'
import { addMonths } from '@/model'
import { setManualRate, setPairForecast } from '@/store'
import { step } from '../registry'
import type { World } from '../world'

// A rate as "Fetch ECB rates" stores it. Written straight into the stored rates: a scenario never uses the network.
step('the ECB rate for {pair} in {month} is {rate}', async (world: World, pair: string, month: string, rate: number) => {
  await world.store.commitSystem([{ op: 'put', table: 'fxRates', record: FxRateSchema.parse({ pair, month, rate, source: 'api', updatedAt: Date.now() }) }])
})

// a rate typed on the Currencies screen
step('I set my rate for {pair} in {month} to {rate}', async (world: World, pair: string, month: string, rate: number) => {
  await setManualRate(world.store, pair, month, rate)
})

step('I remove my rate for {pair} in {month}', async (world: World, pair: string, month: string) => {
  await setManualRate(world.store, pair, month, null)
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
