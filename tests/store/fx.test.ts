import { describe, expect, it, vi } from 'vitest'
import { newId } from '@/model'
import { CasaDb, Store, addAccount, fetchEcbRates, loadTables, monthRates, neededPairs, quickCreateHousehold, setManualRate } from '@/store'

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
