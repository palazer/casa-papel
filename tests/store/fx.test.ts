import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FxRateSchema, newId, type FxRate } from '@/model'
import { monthEnds, rateService } from '../rateService'
import { restoreToday, setToday } from '../today'
import {
  CasaDb, Store, addAccount, fetchEcbRates, loadTables, monthRatesWithDates, neededPairs, quickCreateHousehold, rateSettled, ratesToFetch, refreshRates, restoreEcbRate,
  setManualRate,
} from '@/store'

async function fresh() {
  const store = new Store(new CasaDb(`test-${newId()}`))
  await quickCreateHousehold(store, { name: 'T', baseCurrency: 'EUR', locale: 'en-IE', startMonth: '2026-01' })
  return store
}
/** A household with a dollar account, so dollars are a currency in use. */
async function withDollars() {
  const store = await fresh()
  await addAccount(store, { name: 'Broker', type: 'investment', currency: 'USD', openingMonth: '2026-01' })
  return store
}
const ratesOf = async (store: Store, pair = 'EUR/USD'): Promise<FxRate[]> =>
  (await loadTables(store)).fxRates.filter((r) => r.pair === pair).sort((a, b) => (a.month < b.month ? -1 : 1))
const rateIn = async (store: Store, month: string, pair = 'EUR/USD') => (await ratesOf(store, pair)).find((r) => r.month === month)
const at = (day: string) => new Date(`${day}T12:00:00`).getTime()

// What is fetched depends on today (nothing after today, a year back at least), so every test here has its day.
beforeEach(() => setToday('2026-11-15'))
afterEach(restoreToday)

describe('the official rate of a month (rule X11)', () => {
  it('is the rate of the last day the month has: its last working day, or the latest while it runs', () => {
    const daily = { '2026-01-02': { USD: 1.0, TRY: 50 }, '2026-01-30': { USD: 1.2, TRY: 52 }, '2026-02-03': { USD: 1.3 } }
    expect(monthRatesWithDates(daily)).toEqual({
      '2026-01': { USD: { rate: 1.2, date: '2026-01-30' }, TRY: { rate: 52, date: '2026-01-30' } },
      '2026-02': { USD: { rate: 1.3, date: '2026-02-03' } },
    })
  })

  it('knows which pairs the household needs', async () => {
    const store = await fresh()
    expect(neededPairs(await loadTables(store))).toEqual([])
    await addAccount(store, { name: 'Broker', type: 'investment', currency: 'USD', openingMonth: '2026-01' })
    expect(neededPairs(await loadTables(store))).toEqual(['EUR/USD'])
  })

  it('is settled once you typed it, or once the month is over and its last working day was fetched after it ended', () => {
    const rec = (over: Partial<FxRate>) => FxRateSchema.parse({ pair: 'EUR/USD', month: '2026-09', rate: 1.1, source: 'api', date: '2026-09-30', updatedAt: at('2026-10-03'), ...over })
    expect(rateSettled(rec({}), '2026-09', '2026-11')).toBe(true)
    expect(rateSettled(rec({ source: 'manual', date: null, updatedAt: at('2026-09-04') }), '2026-09', '2026-11')).toBe(true)
    // nothing stored
    expect(rateSettled(undefined, '2026-09', '2026-11')).toBe(false)
    // the running month: its rate moves until it is over, whatever is stored
    expect(rateSettled(rec({ month: '2026-11', date: '2026-11-13', updatedAt: at('2026-11-13') }), '2026-11', '2026-11')).toBe(false)
    // taken while the month was still running, also on its last day
    expect(rateSettled(rec({ date: '2026-09-22', updatedAt: at('2026-09-22') }), '2026-09', '2026-11')).toBe(false)
    expect(rateSettled(rec({ updatedAt: at('2026-09-30') }), '2026-09', '2026-11')).toBe(false)
    // what earlier versions stored: the first working day, or an average without a day
    expect(rateSettled(rec({ date: '2026-09-01', updatedAt: at('2026-10-03') }), '2026-09', '2026-11')).toBe(false)
    expect(rateSettled(rec({ date: null, updatedAt: at('2026-10-03') }), '2026-09', '2026-11')).toBe(false)
    // the month before's last day, which a month borrowed in its first days
    expect(rateSettled(rec({ date: '2026-08-31', updatedAt: at('2026-10-03') }), '2026-09', '2026-11')).toBe(false)
  })
})

describe('what there is to fetch', () => {
  it('a currency that is new: from the household\'s first month, and a year back at least', async () => {
    const store = await withDollars()
    // the household starts in January 2026; in November 2026 thirteen months before today reach further back
    expect(ratesToFetch(await loadTables(store))).toEqual({ base: 'EUR', symbols: ['USD'], from: '2025-10', to: '2026-11' })
    // once the household is older than that, its own first month is where it starts
    setToday('2027-03-15')
    expect(ratesToFetch(await loadTables(store))).toEqual({ base: 'EUR', symbols: ['USD'], from: '2026-01', to: '2027-03' })
  })

  it('nothing for a household with one currency', async () => {
    expect(ratesToFetch(await loadTables(await fresh()))).toBeNull()
  })

  it('afterwards only the running month, until a month ends; then that month once more', async () => {
    const store = await withDollars()
    const daily: Record<string, Record<string, number>> = {}
    for (let m = 10; m <= 12; m++) Object.assign(daily, monthEnds(`2025-${m}`, 1.0, 1.01))
    for (let m = 1; m <= 10; m++) Object.assign(daily, monthEnds(`2026-${String(m).padStart(2, '0')}`, 1.0, 1.01))
    daily['2026-11-02'] = { USD: 1.2 }
    daily['2026-11-13'] = { USD: 1.25 }
    const calls: string[] = []
    const service = rateService(daily, calls)

    expect((await refreshRates(store, service)).written).toBe(14)
    expect(calls[0]).toMatch(/\/v1\/2025-10-01\.\.2026-11-15\?base=EUR&symbols=USD$/)
    expect(await rateIn(store, '2026-10')).toMatchObject({ rate: 1.01, date: '2026-10-30', source: 'api' })
    expect(await rateIn(store, '2026-11')).toMatchObject({ rate: 1.25, date: '2026-11-13' })
    expect(ratesToFetch(await loadTables(store))).toMatchObject({ from: '2026-11', to: '2026-11' })

    // the same day again: asked for the running month, and nothing is written
    const revision = (await store.meta()).localRevision
    expect((await refreshRates(store, service)).written).toBe(0)
    expect((await store.meta()).localRevision).toBe(revision)
    expect(calls[1]).toMatch(/\/v1\/2026-11-01\.\.2026-11-15\?/)

    // a later day of the month: the latest rate takes the place of the one before
    setToday('2026-11-27')
    daily['2026-11-27'] = { USD: 1.3 }
    expect((await refreshRates(store, service)).months).toEqual(['2026-11'])
    expect(await rateIn(store, '2026-11')).toMatchObject({ rate: 1.3, date: '2026-11-27' })

    // December: November is over. It holds the rate of the 27th, taken while it ran, and is settled with its last working day.
    setToday('2026-12-03')
    daily['2026-11-30'] = { USD: 1.31 }
    daily['2026-12-02'] = { USD: 1.32 }
    expect(ratesToFetch(await loadTables(store))).toMatchObject({ from: '2026-11', to: '2026-12' })
    expect((await refreshRates(store, service)).months).toEqual(['2026-11', '2026-12'])
    expect(await rateIn(store, '2026-11')).toMatchObject({ rate: 1.31, date: '2026-11-30' })
    expect(rateSettled(await rateIn(store, '2026-11'), '2026-11', '2026-12')).toBe(true)
    expect(ratesToFetch(await loadTables(store))).toMatchObject({ from: '2026-12', to: '2026-12' })
  })

  it('a month that ended with the right rate already stored is written once more, and that settles it', async () => {
    const store = await withDollars()
    const daily = { ...monthEnds('2026-10', 1.0, 1.1), '2026-11-13': { USD: 1.2 } }
    // fetched on the evening of October's last working day
    setToday('2026-10-30')
    await fetchEcbRates(store, { base: 'EUR', symbols: ['USD'], from: '2026-10', to: '2026-10' }, rateService(daily))
    expect(await rateIn(store, '2026-10')).toMatchObject({ rate: 1.1, date: '2026-10-30' })
    setToday('2026-11-15')
    expect(rateSettled(await rateIn(store, '2026-10'), '2026-10')).toBe(false)
    await fetchEcbRates(store, { base: 'EUR', symbols: ['USD'], from: '2026-10', to: '2026-11' }, rateService(daily))
    expect(await rateIn(store, '2026-10')).toMatchObject({ rate: 1.1, date: '2026-10-30' })
    expect(rateSettled(await rateIn(store, '2026-10'), '2026-10')).toBe(true)
  })

  it('the months an earlier version stored with their first working day are fetched again, once; a typed rate stays', async () => {
    const store = await withDollars()
    await setManualRate(store, 'EUR/USD', '2026-08', 1.5)
    // as versions up to schema 16 stored them: the rate of the month's first working day, fetched some time later
    await store.commitSystem(['2026-07', '2026-09', '2026-10'].map((month) => ({
      op: 'put' as const, table: 'fxRates' as const,
      record: FxRateSchema.parse({ pair: 'EUR/USD', month, rate: 1.0, source: 'api', date: `${month}-01`, updatedAt: at('2026-11-10') }),
    })))
    const daily: Record<string, Record<string, number>> = { '2026-11-13': { USD: 1.25 } }
    for (const m of ['2026-07', '2026-08', '2026-09', '2026-10']) Object.assign(daily, monthEnds(m, 1.0, 1.1))
    const res = await fetchEcbRates(store, { base: 'EUR', symbols: ['USD'], from: '2026-07', to: '2026-11' }, rateService(daily))
    expect(res.months).toEqual(['2026-07', '2026-09', '2026-10', '2026-11'])
    expect((await ratesOf(store)).map((r) => [r.month, r.rate, r.source])).toEqual([
      ['2026-07', 1.1, 'api'], ['2026-08', 1.5, 'manual'], ['2026-09', 1.1, 'api'], ['2026-10', 1.1, 'api'], ['2026-11', 1.25, 'api'],
    ])
    // and not again: every month that is over is settled now
    expect((await fetchEcbRates(store, { base: 'EUR', symbols: ['USD'], from: '2026-07', to: '2026-11' }, rateService(daily))).written).toBe(0)
  })

  it('a month whose typed rate was removed is open again, and the fetch starts there', async () => {
    const store = await withDollars()
    const daily: Record<string, Record<string, number>> = { '2026-11-13': { USD: 1.25 } }
    for (let m = 10; m <= 12; m++) Object.assign(daily, monthEnds(`2025-${m}`, 1.0, 1.01))
    for (let m = 1; m <= 10; m++) Object.assign(daily, monthEnds(`2026-${String(m).padStart(2, '0')}`, 1.0, 1.01))
    await setManualRate(store, 'EUR/USD', '2026-06', 1.5)
    await refreshRates(store, rateService(daily))
    await setManualRate(store, 'EUR/USD', '2026-06', null)
    expect(ratesToFetch(await loadTables(store))).toMatchObject({ from: '2026-06', to: '2026-11' })
    expect((await refreshRates(store, rateService(daily))).months).toEqual(['2026-06'])
    expect(await rateIn(store, '2026-06')).toMatchObject({ rate: 1.01, source: 'api' })
  })

  it('a currency that is being chosen is fetched with the ones in use', async () => {
    const store = await fresh()
    const calls: string[] = []
    await refreshRates(store, rateService({ '2026-11-13': { GBP: 0.85 } }, calls), ['GBP', 'EUR'])
    expect(calls[0]).toMatch(/symbols=GBP$/)
    expect(await rateIn(store, '2026-11', 'EUR/GBP')).toMatchObject({ rate: 0.85 })
    expect((await refreshRates(store, rateService({}, calls))).written).toBe(0)
    expect(calls).toHaveLength(1)
  })
})

describe('what a fetch writes', () => {
  it('the running month takes the latest rate there is before its first one is published', async () => {
    const store = await withDollars()
    // 1 November 2026 is a Sunday: the service answers with Friday 30 October
    setToday('2026-11-01')
    const daily: Record<string, Record<string, number>> = { ...monthEnds('2026-10', 1.0, 1.1) }
    const res = await fetchEcbRates(store, { base: 'EUR', symbols: ['USD'], from: '2026-11', to: '2026-11' }, rateService(daily))
    expect(res.months).toEqual(['2026-11'])
    expect(await rateIn(store, '2026-11')).toMatchObject({ rate: 1.1, date: '2026-10-30', source: 'api' })
    // October itself was not asked for and is not written
    expect(await rateIn(store, '2026-10')).toBeUndefined()
    // the next working day November has a rate of its own
    setToday('2026-11-02')
    daily['2026-11-02'] = { USD: 1.2 }
    await fetchEcbRates(store, { base: 'EUR', symbols: ['USD'], from: '2026-11', to: '2026-11' }, rateService(daily))
    expect(await rateIn(store, '2026-11')).toMatchObject({ rate: 1.2, date: '2026-11-02' })
  })

  it('never the month before the one asked for, though the service begins its answer there', async () => {
    const store = await withDollars()
    await setManualRate(store, 'EUR/USD', '2026-10', 1.5)
    const daily = { ...monthEnds('2026-10', 1.0, 1.1), '2026-11-13': { USD: 1.2 } }
    await fetchEcbRates(store, { base: 'EUR', symbols: ['USD'], from: '2026-11', to: '2026-11', replaceSettled: true }, rateService(daily))
    expect(await rateIn(store, '2026-10')).toMatchObject({ rate: 1.5, source: 'manual' })
    expect(await rateIn(store, '2026-11')).toMatchObject({ rate: 1.2, source: 'api' })
  })

  it('reports a currency the ECB does not publish, beside others and alone', async () => {
    const store = await fresh()
    const daily = { '2026-01-28': { USD: 1.2 }, '2026-02-10': { USD: 1.3 } }
    const mixed = await fetchEcbRates(store, { base: 'EUR', symbols: ['USD', 'XXX'], from: '2026-01', to: '2026-02' }, rateService(daily))
    expect(mixed.unsupported).toEqual(['XXX'])
    expect(mixed.written).toBe(2)
    const alone = await fetchEcbRates(store, { base: 'EUR', symbols: ['XXX'], from: '2026-01', to: '2026-02' }, rateService(daily))
    expect(alone).toEqual({ written: 0, months: [], unsupported: ['XXX'] })
    // a service that refuses the whole request for one unknown symbol is asked symbol by symbol
    const strict = (async (url: string) => (url.includes('XXX') ? new Response('not found', { status: 404 }) : rateService(daily)(url))) as unknown as typeof fetch
    await setManualRate(store, 'EUR/USD', '2026-02', null)
    const res = await fetchEcbRates(store, { base: 'EUR', symbols: ['USD', 'XXX'], from: '2026-01', to: '2026-02' }, strict)
    expect(res.unsupported).toEqual(['XXX'])
    expect(res.months).toEqual(['2026-02'])
  })

  it('gives up on a rate service that never answers, and writes nothing', async () => {
    const store = await fresh()
    const silent = (() => new Promise<Response>(() => {})) as unknown as typeof fetch
    await expect(fetchEcbRates(store, { base: 'EUR', symbols: ['USD'], from: '2026-01', to: '2026-01' }, silent, 20)).rejects.toThrow('The rate service did not answer. Try again.')
    expect((await loadTables(store)).fxRates).toEqual([])
  })
})

describe('"Use the ECB rate again"', () => {
  const daily = { ...monthEnds('2025-12', 0.9, 0.95), ...monthEnds('2026-01', 1.0, 1.1), '2026-11-13': { USD: 1.25 } }

  it('drops the typed rate and fetches that month alone: the month before keeps what it has', async () => {
    const store = await fresh()
    const calls: string[] = []
    await setManualRate(store, 'EUR/USD', '2025-12', 1.7)
    await setManualRate(store, 'EUR/USD', '2026-01', 1.5)
    const res = await restoreEcbRate(store, 'EUR/USD', '2026-01', rateService(daily, calls))
    expect(res.written).toBe(1)
    expect(calls.at(-1)).toContain('2026-01-01..2026-01-31')
    expect(await rateIn(store, '2026-01')).toMatchObject({ rate: 1.1, source: 'api', date: '2026-01-30' })
    // 1 January has no rate, so the service begins with 30 December: that is December's, and December was typed
    expect(await rateIn(store, '2025-12')).toMatchObject({ rate: 1.7, source: 'manual' })
    await expect(restoreEcbRate(store, 'USD/TRY', '2026-01', rateService(daily))).rejects.toThrow(/fetched against EUR/)
  })

  it('the running month goes back to the latest rate; asked again, there is nothing to do and nothing to complain about', async () => {
    const store = await fresh()
    await setManualRate(store, 'EUR/USD', '2026-11', 1.5)
    expect((await restoreEcbRate(store, 'EUR/USD', '2026-11', rateService(daily))).written).toBe(1)
    expect(await rateIn(store, '2026-11')).toMatchObject({ rate: 1.25, source: 'api', date: '2026-11-13' })
    expect((await restoreEcbRate(store, 'EUR/USD', '2026-11', rateService(daily))).written).toBe(0)
  })

  it('a month to come has nothing to fetch: what was typed goes and the month is a forecast again', async () => {
    const store = await fresh()
    const service = vi.fn() as unknown as typeof fetch
    expect((await restoreEcbRate(store, 'EUR/USD', '2099-01', service)).written).toBe(0)
    await setManualRate(store, 'EUR/USD', '2099-01', 2)
    expect((await restoreEcbRate(store, 'EUR/USD', '2099-01', service)).written).toBe(0)
    expect(service).not.toHaveBeenCalled()
    expect((await loadTables(store)).fxRates.some((r) => r.month === '2099-01')).toBe(false)
    // next month is a month to come too, also on the last evening of this one
    setToday('2026-11-30')
    await setManualRate(store, 'EUR/USD', '2026-12', 2)
    await restoreEcbRate(store, 'EUR/USD', '2026-12', service)
    expect(await rateIn(store, '2026-12')).toBeUndefined()
    await setManualRate(store, 'EUR/USD', '2026-11', 2)
    await restoreEcbRate(store, 'EUR/USD', '2026-11', rateService(daily))
    expect(await rateIn(store, '2026-11')).toMatchObject({ rate: 1.25, source: 'api' })
  })

  it('keeps the typed rate when the service fails, does not publish the currency, or has no rate for the month', async () => {
    const store = await fresh()
    await setManualRate(store, 'EUR/USD', '2026-01', 1.5)
    const failing = (async () => new Response('down', { status: 500 })) as unknown as typeof fetch
    await expect(restoreEcbRate(store, 'EUR/USD', '2026-01', failing)).rejects.toThrow(/answered 500/)
    expect(await rateIn(store, '2026-01')).toMatchObject({ rate: 1.5, source: 'manual' })

    await setManualRate(store, 'EUR/XXX', '2026-01', 3)
    await expect(restoreEcbRate(store, 'EUR/XXX', '2026-01', rateService(daily))).rejects.toThrow(/does not publish XXX/)
    expect(await rateIn(store, '2026-01', 'EUR/XXX')).toMatchObject({ rate: 3, source: 'manual' })

    const empty = (async () => new Response(JSON.stringify({ rates: {} }), { status: 200 })) as unknown as typeof fetch
    await expect(restoreEcbRate(store, 'EUR/USD', '2026-01', empty)).rejects.toThrow(/no USD rate for that month/)
    expect(await rateIn(store, '2026-01')).toMatchObject({ rate: 1.5, source: 'manual' })
  })
})
