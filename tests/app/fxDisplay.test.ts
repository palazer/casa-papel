import { describe, expect, it } from 'vitest'
import { formatRate, rateTag, readableRate, toStored } from '@/features/household/fxDisplay'

describe('readable rates', () => {
  it('puts the side above one first and spells both codes', () => {
    expect(readableRate('EUR', 'USD', 1.0842, 'en-IE')).toMatchObject({ from: 'EUR', to: 'USD', text: '1 EUR = 1.0842 USD' })
    const lira = readableRate('TRY', 'USD', 0.02058, 'en-IE')
    expect(lira.from).toBe('USD')
    expect(lira.to).toBe('TRY')
    expect(lira.rate).toBeCloseTo(48.59, 2)
    expect(lira.text).toMatch(/^1 USD = 48\.59\d* TRY$/)
  })
  it('a typed number goes back to the stored base→foreign rate', () => {
    expect(toStored({ from: 'EUR' }, 'EUR', 1.1)).toBe(1.1)
    expect(toStored({ from: 'USD' }, 'TRY', 48.58)).toBeCloseTo(1 / 48.58, 12)
    const r = readableRate('TRY', 'USD', 0.02058, 'en-IE')
    expect(toStored(r, 'TRY', r.rate)).toBeCloseTo(0.02058, 12)
  })
  it('formats with two to four decimals and no grouping, and names the source', () => {
    expect(formatRate(1.1, 'en-IE')).toBe('1.10')
    expect(formatRate(1234.56789, 'en-IE')).toBe('1234.5679')
    expect(rateTag({ source: 'manual' }, { rate: 1, projected: false })).toBe('manual')
    expect(rateTag({ source: 'api' }, null)).toBe('ECB')
    expect(rateTag(undefined, { rate: 1, projected: true })).toBe('projected')
    expect(rateTag(undefined, { rate: 1, projected: false })).toBe('carried')
    expect(rateTag(undefined, null)).toBe('missing')
  })
})
