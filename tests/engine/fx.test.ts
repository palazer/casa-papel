import { describe, expect, it } from 'vitest'
import { buildFxIndex, convertMoney, driftFor, rateFor, rateInfo } from '@/engine'
import { FxRateSchema } from '@/model'

const rate = (pair: string, month: string, rate: number, source: 'api' | 'manual' | 'projected' = 'api') => FxRateSchema.parse({ pair, month, rate, source, updatedAt: 0 })

describe('fx index', () => {
  it('uses the nearest earlier known rate inside the known range and the first rate before it', () => {
    const fx = buildFxIndex([rate('EUR/TRY', '2026-03', 50), rate('EUR/TRY', '2026-05', 52)])
    expect(rateFor(fx, 'EUR', 'TRY', '2026-01')).toBe(50)
    expect(rateFor(fx, 'EUR', 'TRY', '2026-04')).toBe(50)
    expect(rateInfo(fx, 'EUR', 'TRY', '2026-05')).toEqual({ rate: 52, projected: false })
  })
  it('projects past the last known month with a fixed drift and flags it', () => {
    const fx = buildFxIndex([rate('USD/TRY', '2026-10', 49.03)], { driftMode: 'fixed', fixedDrift: 0.015 })
    expect(rateInfo(fx, 'USD', 'TRY', '2026-11')).toEqual({ rate: expect.closeTo(49.765, 2), projected: true })
    expect(rateFor(fx, 'USD', 'TRY', '2027-12')!).toBeCloseTo(60.393, 3)
    // the inverse pair is derived and keeps the projected flag
    expect(rateInfo(fx, 'TRY', 'USD', '2027-12')).toEqual({ rate: expect.closeTo(1 / 60.393, 6), projected: true })
  })
  it('averages the month-over-month change of the last known months when asked', () => {
    const fx = buildFxIndex([rate('EUR/USD', '2026-01', 1.0), rate('EUR/USD', '2026-02', 1.1), rate('EUR/USD', '2026-04', 1.331)], { driftMode: 'average' })
    // 1.0 → 1.1 is +10%; 1.1 → 1.331 over two months is +10% a month
    expect(driftFor(fx, 'EUR/USD')).toBeCloseTo(0.1, 9)
    expect(rateFor(fx, 'EUR', 'USD', '2026-05')!).toBeCloseTo(1.4641, 9)
  })
  it('per-pair overrides beat the household default; stored projections are ignored as inputs', () => {
    const fx = buildFxIndex([rate('EUR/TRY', '2026-01', 50), rate('EUR/TRY', '2026-02', 99, 'projected')], { fixedDrift: 0.02, pairDrift: { 'EUR/TRY': 0 } })
    expect(rateFor(fx, 'EUR', 'TRY', '2026-02')).toBe(50)
    expect(rateFor(fx, 'EUR', 'TRY', '2026-06')).toBe(50)
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
    const drifting = buildFxIndex([rate('EUR/USD', '2026-01', 1.25), rate('EUR/TRY', '2026-01', 50), rate('EUR/TRY', '2026-03', 50)], { base: 'EUR', fixedDrift: 0.02 })
    expect(rateInfo(drifting, 'USD', 'TRY', '2026-03')?.projected).toBe(true)
    // without a base currency there is nothing to cross through
    expect(rateInfo(buildFxIndex([rate('EUR/USD', '2026-01', 1.25), rate('EUR/TRY', '2026-01', 50)]), 'USD', 'TRY', '2026-01')).toBeNull()
  })
})
