import { describe, expect, it } from 'vitest'
import { buildFxIndex, convertMoney, fxOptionsOf, historyMonths, householdFx, ownChangeFor, rateFor, rateInfo, trendFor } from '@/engine'
import { FxRateSchema, addMonths, type MonthKey } from '@/model'

const rate = (pair: string, month: string, rate: number, source: 'api' | 'manual' | 'projected' = 'api') => FxRateSchema.parse({ pair, month, rate, source, updatedAt: 0 })
/** A year of official rates up to `last`: thirteen months, each `change` above the one before, ending at `end`. */
const year = (pair: string, last: MonthKey, end: number, change: number) =>
  Array.from({ length: 13 }, (_, back) => rate(pair, addMonths(last, -back), end / Math.pow(1 + change, back)))

describe('fx index', () => {
  it('uses the nearest earlier known rate inside the known range and the first rate before it', () => {
    const fx = buildFxIndex([rate('EUR/TRY', '2026-03', 50), rate('EUR/TRY', '2026-05', 52)])
    expect(rateFor(fx, 'EUR', 'TRY', '2026-01')).toBe(50)
    expect(rateFor(fx, 'EUR', 'TRY', '2026-04')).toBe(50)
    expect(rateInfo(fx, 'EUR', 'TRY', '2026-05')).toEqual({ rate: 52, projected: false })
  })
  it('stored projections of an older version are ignored as inputs', () => {
    const fx = buildFxIndex([rate('EUR/TRY', '2026-01', 50), rate('EUR/TRY', '2026-02', 99, 'projected')])
    expect(rateFor(fx, 'EUR', 'TRY', '2026-02')).toBe(50)
    expect(historyMonths(fx, 'EUR/TRY')).toBe(1)
  })
  it('converts minor units and reports a missing rate', () => {
    const fx = buildFxIndex([rate('EUR/USD', '2026-01', 1.1)])
    expect(convertMoney(fx, 10000, 'EUR', 'USD', '2026-01')).toEqual({ value: 11000, missingRate: false, projected: false })
    expect(convertMoney(fx, 10000, 'EUR', 'GBP', '2026-01')).toEqual({ value: 10000, missingRate: true, projected: false })
  })
})

describe('fx cross rates', () => {
  it('crosses through the base currency when a pair is only known against it', () => {
    const fx = buildFxIndex([rate('EUR/USD', '2026-01', 1.25), rate('EUR/TRY', '2026-01', 50)], { base: 'EUR' })
    expect(rateInfo(fx, 'USD', 'TRY', '2026-01')).toEqual({ rate: expect.closeTo(40, 9), projected: false })
    expect(rateFor(fx, 'TRY', 'USD', '2026-01')!).toBeCloseTo(0.025, 12)
    expect(convertMoney(fx, 10000, 'USD', 'TRY', '2026-01').value).toBe(400000)
    // one drifted leg makes the cross a projection
    const drifting = buildFxIndex([rate('EUR/USD', '2026-01', 1.25), rate('EUR/TRY', '2026-01', 50), rate('EUR/TRY', '2026-03', 50)], { base: 'EUR', pairDrift: { 'EUR/USD': 0.02 } })
    expect(rateInfo(drifting, 'USD', 'TRY', '2026-03')?.projected).toBe(true)
    // without a base currency there is nothing to cross through
    expect(rateInfo(buildFxIndex([rate('EUR/USD', '2026-01', 1.25), rate('EUR/TRY', '2026-01', 50)]), 'USD', 'TRY', '2026-01')).toBeNull()
  })
})

describe('the forecast for the months to come (rule X12)', () => {
  it('follows the trend, and the trend fades out: each step is 80 % of the one before', () => {
    const fx = buildFxIndex(year('EUR/USD', '2026-03', 1, 0.01))
    expect(trendFor(fx, 'EUR/USD')).toBeCloseTo(0.01, 12)
    expect(rateInfo(fx, 'EUR', 'USD', '2026-03')).toEqual({ rate: 1, projected: false })
    expect(rateInfo(fx, 'EUR', 'USD', '2026-04')).toEqual({ rate: expect.closeTo(1.01, 9), projected: true })
    expect(rateFor(fx, 'EUR', 'USD', '2026-05')!).toBeCloseTo(1.01 * 1.008, 12)
    expect(rateFor(fx, 'EUR', 'USD', '2026-06')!).toBeCloseTo(1.01 * 1.008 * 1.0064, 12)
    // the steps add up to five times the first one at most: the course flattens out
    const far = rateFor(fx, 'EUR', 'USD', '2036-03')!
    expect(far).toBeGreaterThan(1.05)
    expect(far).toBeLessThan(1.0513)
    expect(rateFor(fx, 'EUR', 'USD', '2046-03')!).toBeCloseTo(far, 9)
  })

  it('gives the same rate whatever month is asked for first', () => {
    const rates = year('EUR/USD', '2026-03', 1, 0.01)
    const late = buildFxIndex(rates)
    const june = rateFor(late, 'EUR', 'USD', '2026-06')
    const early = buildFxIndex(rates)
    rateFor(early, 'EUR', 'USD', '2026-04')
    rateFor(early, 'EUR', 'USD', '2026-12')
    expect(rateFor(early, 'EUR', 'USD', '2026-06')).toBe(june)
    expect(rateFor(late, 'EUR', 'USD', '2026-04')).toBe(rateFor(early, 'EUR', 'USD', '2026-04'))
  })

  it('holds the last rate with less than a year of rates: two rates are not drawn out into a course', () => {
    const twelve = year('EUR/USD', '2026-03', 1, 0.01).slice(0, 12)
    const fx = buildFxIndex(twelve)
    expect(historyMonths(fx, 'EUR/USD')).toBe(12)
    expect(trendFor(fx, 'EUR/USD')).toBe(0)
    expect(rateInfo(fx, 'EUR', 'USD', '2027-03')).toEqual({ rate: 1, projected: true })
    const two = buildFxIndex([rate('EUR/USD', '2026-10', 1.1), rate('EUR/USD', '2026-11', 1.25)])
    expect(rateFor(two, 'EUR', 'USD', '2027-06')).toBe(1.25)
  })

  it('spreads a change over the months it took where a month has no rate of its own', () => {
    // thirteen stored months with one gap: 1.0 → 1.21 over two months is +10 % a month
    const rates = [rate('EUR/USD', '2025-01', 1), rate('EUR/USD', '2025-03', 1.21), ...Array.from({ length: 11 }, (_, i) => rate('EUR/USD', addMonths('2025-04', i), 1.21))]
    const fx = buildFxIndex(rates)
    expect(historyMonths(fx, 'EUR/USD')).toBe(13)
    expect(trendFor(fx, 'EUR/USD')).toBeCloseTo(0.1 / 12, 9)
  })

  it('a change of the household\'s own moves every month by that, without fading; nothing a month holds the rate', () => {
    const rates = year('USD/TRY', '2026-10', 49.03, 0.03)
    const own = buildFxIndex(rates, { pairDrift: { 'USD/TRY': 0.015 } })
    expect(ownChangeFor(own, 'USD/TRY')).toBe(0.015)
    expect(rateInfo(own, 'USD', 'TRY', '2026-11')).toEqual({ rate: expect.closeTo(49.765, 2), projected: true })
    expect(rateFor(own, 'USD', 'TRY', '2027-12')!).toBeCloseTo(49.03 * Math.pow(1.015, 14), 9)
    // the inverse pair is derived and is a forecast too
    expect(rateInfo(own, 'TRY', 'USD', '2027-12')).toEqual({ rate: expect.closeTo(1 / (49.03 * Math.pow(1.015, 14)), 9), projected: true })
    const held = buildFxIndex(rates, { pairDrift: { 'USD/TRY': 0 } })
    expect(rateInfo(held, 'USD', 'TRY', '2030-01')).toEqual({ rate: 49.03, projected: true })
    expect(ownChangeFor(buildFxIndex(rates), 'USD/TRY')).toBeNull()
  })

  it('uses a rate typed for a month to come as it is, and goes on from it', () => {
    const fx = buildFxIndex([...year('EUR/USD', '2026-03', 1, 0.01), rate('EUR/USD', '2026-05', 1.1, 'manual')])
    expect(rateInfo(fx, 'EUR', 'USD', '2026-04')).toEqual({ rate: expect.closeTo(1.01, 9), projected: true })
    expect(rateInfo(fx, 'EUR', 'USD', '2026-05')).toEqual({ rate: 1.1, projected: false })
    // June is three months after the last official rate: its step is the trend times 0.8 twice
    expect(rateInfo(fx, 'EUR', 'USD', '2026-06')).toEqual({ rate: expect.closeTo(1.1 * 1.0064, 9), projected: true })
  })

  it('reads the trend from what was: a rate typed for a month to come is not history', () => {
    const fx = buildFxIndex([...year('EUR/USD', '2026-03', 1, 0.01), rate('EUR/USD', '2026-12', 2, 'manual')])
    expect(historyMonths(fx, 'EUR/USD')).toBe(13)
    expect(trendFor(fx, 'EUR/USD')).toBeCloseTo(0.01, 12)
    expect(rateFor(fx, 'EUR', 'USD', '2026-04')!).toBeCloseTo(1.01, 9)
    // a rate typed inside the history is part of it
    const inside = buildFxIndex([...year('EUR/USD', '2026-03', 1, 0.01).filter((r) => r.month !== '2026-01'), rate('EUR/USD', '2026-01', 0.9, 'manual')])
    expect(historyMonths(inside, 'EUR/USD')).toBe(13)
    expect(trendFor(inside, 'EUR/USD')).not.toBeCloseTo(0.01, 6)
  })

  it('a pair with typed rates only ends its history at its last stored month', () => {
    const fx = buildFxIndex([rate('EUR/TRY', '2026-01', 50, 'manual'), rate('EUR/TRY', '2026-04', 52, 'manual')])
    expect(rateInfo(fx, 'EUR', 'TRY', '2026-02')).toEqual({ rate: 50, projected: false })
    expect(rateInfo(fx, 'EUR', 'TRY', '2026-04')).toEqual({ rate: 52, projected: false })
    expect(rateInfo(fx, 'EUR', 'TRY', '2026-09')).toEqual({ rate: 52, projected: true })
  })
})

describe("a household's rate options", () => {
  it('are read in one place, with the household\'s own currency to cross through', () => {
    expect(fxOptionsOf({ baseCurrency: 'EUR', fxPairDrift: { 'EUR/TRY': 0.02 } })).toEqual({ pairDrift: { 'EUR/TRY': 0.02 }, base: 'EUR' })
  })

  it('have their defaults where an older record lacks a field', () => {
    const old = { baseCurrency: 'TRY' } as Parameters<typeof fxOptionsOf>[0]
    expect(fxOptionsOf(old)).toEqual({ pairDrift: {}, base: 'TRY' })
  })

  it('give the index the calculation converts with', () => {
    const rates = [rate('EUR/USD', '2026-01', 1.25), rate('EUR/TRY', '2026-01', 50)]
    const fx = householdFx(rates, { baseCurrency: 'EUR', fxPairDrift: { 'EUR/USD': 0.02 } })
    expect(rateFor(fx, 'USD', 'TRY', '2026-01')!).toBeCloseTo(40, 9)
    expect(rateFor(fx, 'EUR', 'USD', '2026-02')!).toBeCloseTo(1.275, 9)
  })
})
