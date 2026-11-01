import { describe, expect, it } from 'vitest'
import { currencyExponent, formatMoney, fromMinor, scaleMoney, toMinor } from '@/model'

describe('money', () => {
  it('converts to and from minor units', () => {
    expect(toMinor(19.35, 'EUR')).toBe(1935)
    expect(toMinor('1.935,00'.replace('.', ''), 'EUR')).toBe(193500)
    expect(toMinor(1000, 'JPY')).toBe(1000)
    expect(currencyExponent('KWD')).toBe(3)
    expect(fromMinor(1935, 'EUR')).toBe(19.35)
    expect(toMinor(0.1 + 0.2, 'EUR')).toBe(30)
  })
  it('scales with half-away-from-zero rounding', () => {
    expect(scaleMoney(1000, 0.6575)).toBe(658)
    expect(scaleMoney(-1000, 0.6575)).toBe(-658)
    expect(scaleMoney(5, 0.5)).toBe(3)
    expect(scaleMoney(-5, 0.5)).toBe(-3)
  })
  it('formats by locale', () => {
    expect(formatMoney(193500, 'EUR', 'de-DE')).toMatch(/1\.935,00\s?€/)
    expect(formatMoney(-193500, 'TRY', 'tr-TR')).toMatch(/1\.935,00/)
  })
})
