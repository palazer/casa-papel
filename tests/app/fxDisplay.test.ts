import { describe, expect, it } from 'vitest'
import { pairsToAsk } from '@/app/useAutoRates'
import { formatRate, rateSource, rateTag, readableRate, toStored } from '@/features/household/fxDisplay'

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
    expect(rateTag(undefined, { rate: 1, projected: true })).toBe('forecast')
    expect(rateTag(undefined, { rate: 1, projected: false })).toBe('carried')
    expect(rateTag(undefined, null)).toBe('missing')
  })
})

describe('where a month\'s rate came from, in words (rule X11)', () => {
  const at = (day: string) => new Date(`${day}T12:00:00`).getTime()
  const official = (date: string | null, written: string) => ({ source: 'api' as const, date, updatedAt: at(written) })

  it('an official rate names its day: the latest of a running month, the last working day of one that is over', () => {
    expect(rateSource('ECB', official('2026-11-13', '2026-11-13'), '2026-11', 'en-IE', '2026-11'))
      .toBe("The European Central Bank's latest rate, of 13 Nov 2026. It moves until the month is over.")
    expect(rateSource('ECB', official('2026-10-30', '2026-11-02'), '2026-10', 'en-IE', '2026-11'))
      .toBe("The European Central Bank's rate of 30 Oct 2026, the month's last working day.")
  })

  it('does not call a day the last working day while that is not settled, and says less where no day is stored', () => {
    // taken while October was still running, and not fetched again since
    expect(rateSource('ECB', official('2026-10-22', '2026-10-22'), '2026-10', 'en-IE', '2026-11')).toBe("The European Central Bank's rate of 22 Oct 2026.")
    // an earlier version's first working day
    expect(rateSource('ECB', official('2026-10-01', '2026-11-02'), '2026-10', 'en-IE', '2026-11')).toBe("The European Central Bank's rate of 1 Oct 2026.")
    expect(rateSource('ECB', official(null, '2026-11-02'), '2026-10', 'en-IE', '2026-11')).toBe("The European Central Bank's rate.")
  })

  it('says what the other kinds are', () => {
    expect(rateSource('manual', { source: 'manual', date: null, updatedAt: 0 }, '2026-10', 'en-IE', '2026-11')).toBe('Your own rate for this month.')
    expect(rateSource('forecast', undefined, '2027-02', 'en-IE', '2026-11')).toMatch(/^A forecast: /)
    expect(rateSource('carried', undefined, '2026-08', 'en-IE', '2026-11')).toMatch(/^Carried over /)
    expect(rateSource('missing', undefined, '2026-08', 'en-IE', '2026-11')).toMatch(/^No rate yet/)
  })
})

describe('which pairs the app asks the rate service for', () => {
  const none = new Set<string>()

  it('every pair in use, once a day on this device', () => {
    expect(pairsToAsk(['EUR/USD', 'EUR/TRY'], null, '2026-11-15', none)).toEqual(['EUR/USD', 'EUR/TRY'])
    expect(pairsToAsk(['EUR/USD', 'EUR/TRY'], { day: '2026-11-15', pairs: ['EUR/USD', 'EUR/TRY'] }, '2026-11-15', none)).toEqual([])
    // the next day they are asked for again
    expect(pairsToAsk(['EUR/USD', 'EUR/TRY'], { day: '2026-11-15', pairs: ['EUR/USD', 'EUR/TRY'] }, '2026-11-16', none)).toEqual(['EUR/USD', 'EUR/TRY'])
  })

  it('a currency that comes into use later the same day, at once', () => {
    expect(pairsToAsk(['EUR/USD', 'EUR/GBP'], { day: '2026-11-15', pairs: ['EUR/USD'] }, '2026-11-15', none)).toEqual(['EUR/GBP'])
  })

  it('not again what failed since the app was opened, so a device that is offline does not keep asking', () => {
    expect(pairsToAsk(['EUR/USD', 'EUR/TRY'], null, '2026-11-15', new Set(['EUR/USD']))).toEqual(['EUR/TRY'])
    expect(pairsToAsk(['EUR/USD'], null, '2026-11-15', new Set(['EUR/USD']))).toEqual([])
  })

  it('nothing for a household with one currency', () => {
    expect(pairsToAsk([], null, '2026-11-15', none)).toEqual([])
  })
})
