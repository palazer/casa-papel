import { describe, expect, it, vi } from 'vitest'
import { newId } from '@/model'
import { CasaDb, Store, addAccount, fetchEcbRates, loadTables, monthRates, monthRatesWithDates, neededPairs, quickCreateHousehold, restoreEcbRate, setManualRate } from '@/store'

async function fresh() {
  const store = new Store(new CasaDb(`test-${newId()}`))
  await quickCreateHousehold(store, { name: 'T', baseCurrency: 'EUR', locale: 'en-IE', startMonth: '2026-01' })
  return store
}

describe('currency rates', () => {
  it('turns daily rates into month rates by policy', () => {
    const daily = { '2026-01-02': { USD: 1.0, TRY: 50 }, '2026-01-30': { USD: 1.2, TRY: 52 }, '2026-02-03': { USD: 1.3 } }
    expect(monthRates(daily, 'last')).toEqual({ '2026-01': { USD: 1.2, TRY: 52 }, '2026-02': { USD: 1.3 } })
    expect(monthRates(daily, 'first')['2026-01']).toEqual({ USD: 1.0, TRY: 50 })
    expect(monthRates(daily, 'average')['2026-01']).toEqual({ USD: 1.1, TRY: 51 })
  })
  it('knows which pairs the household needs', async () => {
    const store = await fresh()
    expect(neededPairs(await loadTables(store))).toEqual([])
    await addAccount(store, { name: 'Broker', type: 'investment', currency: 'USD', openingMonth: '2026-01' })
    expect(neededPairs(await loadTables(store))).toEqual(['EUR/USD'])
  })
  it('fetches, stores api rates, keeps manual ones, and reports unsupported symbols', async () => {
    const store = await fresh()
    await setManualRate(store, 'EUR/USD', '2026-01', 1.5)
    const calls: string[] = []
    const fetchFn = vi.fn(async (url: string) => {
      calls.push(url)
      if (url.includes('symbols=USD%2CXXX')) return new Response('not found', { status: 404 })
      if (url.includes('symbols=XXX')) return new Response('not found', { status: 404 })
      return new Response(JSON.stringify({ rates: { '2026-01-05': { USD: 1.1 }, '2026-01-28': { USD: 1.2 }, '2026-02-10': { USD: 1.3 } } }), { status: 200 })
    }) as unknown as typeof fetch
    const res = await fetchEcbRates(store, { base: 'EUR', symbols: ['USD', 'XXX'], from: '2026-01', to: '2026-02', policy: 'last' }, fetchFn)
    expect(res.unsupported).toEqual(['XXX'])
    expect(res.written).toBe(1) // January is manual and stays
    const t = await loadTables(store)
    expect(t.fxRates.find((r) => r.month === '2026-01')).toMatchObject({ rate: 1.5, source: 'manual' })
    expect(t.fxRates.find((r) => r.month === '2026-02')).toMatchObject({ rate: 1.3, source: 'api' })
    expect(calls[0]).toContain('https://api.frankfurter.dev/v1/2026-01-01..2026-02-28?base=EUR')
    await setManualRate(store, 'EUR/USD', '2026-02', null)
    expect((await loadTables(store)).fxRates.some((r) => r.month === '2026-02')).toBe(false)
  })
})

describe('currency rates: the day of the rate and the ECB again', () => {
  it('keeps the day a month rate was taken on, except for an average', () => {
    const daily = { '2026-01-02': { USD: 1.0 }, '2026-01-30': { USD: 1.2 } }
    expect(monthRatesWithDates(daily, 'first')['2026-01'].USD).toEqual({ rate: 1.0, date: '2026-01-02' })
    expect(monthRatesWithDates(daily, 'last')['2026-01'].USD).toEqual({ rate: 1.2, date: '2026-01-30' })
    expect(monthRatesWithDates(daily, 'average')['2026-01'].USD).toEqual({ rate: 1.1, date: null })
  })
  it('a new household takes the first business day of the month', async () => {
    const store = await fresh()
    expect((await loadTables(store)).household[0].fxMonthRate).toBe('first')
  })
  it('clearing a month removes a fetched rate too; the ECB again drops the manual rate and fetches that month alone', async () => {
    const store = await fresh()
    const urls: string[] = []
    const fetchFn = (async (url: string) => {
      urls.push(url)
      return new Response(JSON.stringify({ rates: { '2026-01-02': { USD: 1.1 }, '2026-01-15': { USD: 1.3 } } }), { status: 200 })
    }) as unknown as typeof fetch
    await fetchEcbRates(store, { base: 'EUR', symbols: ['USD'], from: '2026-01', to: '2026-01', policy: 'first' }, fetchFn)
    let t = await loadTables(store)
    expect(t.fxRates.find((r) => r.month === '2026-01')).toMatchObject({ rate: 1.1, source: 'api', date: '2026-01-02' })
    await setManualRate(store, 'EUR/USD', '2026-01', null)
    expect((await loadTables(store)).fxRates).toHaveLength(0)

    await setManualRate(store, 'EUR/USD', '2026-01', 1.5)
    const res = await restoreEcbRate(store, 'EUR/USD', '2026-01', fetchFn)
    expect(res.written).toBe(1)
    t = await loadTables(store)
    expect(t.fxRates).toHaveLength(1)
    expect(t.fxRates[0]).toMatchObject({ month: '2026-01', rate: 1.1, source: 'api' })
    expect(urls[urls.length - 1]).toContain('2026-01-01..2026-01-31')
    await expect(restoreEcbRate(store, 'USD/TRY', '2026-01', fetchFn)).rejects.toThrow(/fetched against EUR/)
  })
  it('a future month has nothing to fetch and stays projected', async () => {
    const store = await fresh()
    const fetchFn = vi.fn() as unknown as typeof fetch
    expect((await restoreEcbRate(store, 'EUR/USD', '2099-01', fetchFn)).written).toBe(0)
    expect(fetchFn).not.toHaveBeenCalled()
  })
})

describe('currency rates: the ECB again when the service fails', () => {
  it('keeps the manual rate when the fetch fails, and drops it for a month the ECB has nothing for', async () => {
    const store = await fresh()
    await setManualRate(store, 'EUR/USD', '2026-01', 1.5)
    const failing = (async () => new Response('down', { status: 500 })) as unknown as typeof fetch
    await expect(restoreEcbRate(store, 'EUR/USD', '2026-01', failing)).rejects.toThrow(/answered 500/)
    expect((await loadTables(store)).fxRates.find((r) => r.month === '2026-01')).toMatchObject({ rate: 1.5, source: 'manual' })

    await setManualRate(store, 'EUR/USD', '2099-01', 2)
    expect((await restoreEcbRate(store, 'EUR/USD', '2099-01', vi.fn() as unknown as typeof fetch)).written).toBe(0)
    expect((await loadTables(store)).fxRates.some((r) => r.month === '2099-01')).toBe(false)
  })
})
