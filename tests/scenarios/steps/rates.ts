import { FxRateSchema } from '@/model'
import { setFxSettings, setManualRate } from '@/store'
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

// "Rates after the last known month": a fixed change per month, or the average change of the last year
step('rates after the last known month change by {percent} a month', async (world: World, drift: number) => {
  await setFxSettings(world.store, { fxDriftMode: 'fixed', fxDriftDefault: drift })
})

step('rates after the last known month follow the average change of the last year', async (world: World) => {
  await setFxSettings(world.store, { fxDriftMode: 'average' })
})
