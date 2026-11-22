import { describe, expect, it } from 'vitest'
import { ONLY_PLUS_MINUS, ordinalDay, parseAmount, sumResult, unreadableAmount, weekdayOf } from '@/app/format'

const eur = (text: string, locale = 'en-IE') => parseAmount(text, 'EUR', locale)

describe('parseAmount: one number, read as it always was', () => {
  it.each([
    ['1935', 1935_00], ['1935.5', 1935_50], ['1,935.50', 1935_50], ['1.935,50', 1935_50], ['1,935', 1935_00], ['19,35', 19_35],
    ['1.5', 1_50], ['0,5', 50], ['.5', 50], ['-20', -20_00], ['+20', 20_00], ['€ 1,200', 1200_00], ['1200 EUR', 1200_00], [' 42 ', 42_00],
  ])('%s in an English format', (text, minor) => {
    expect(eur(text)).toBe(minor)
  })
  it.each([['1.935,50', 1935_50], ['1935,5', 1935_50], ['1.935', 1935_00], ['19.35', 19_35], ['1,935.50', 1935_50]])('%s in a German format', (text, minor) => {
    expect(eur(text, 'de-DE')).toBe(minor)
  })
  it('what is no number at all cannot be read', () => {
    for (const text of ['', ' ', '-', '+', 'abc', '.', ',', '€']) expect(eur(text), JSON.stringify(text)).toBeNull()
  })
  it('counts in the currency\'s own smallest unit', () => {
    expect(parseAmount('1500', 'JPY', 'en-IE')).toBe(1500)
    expect(parseAmount('12.345', 'EUR', 'en-IE')).toBe(12_35)
  })
})

describe('parseAmount: a sum', () => {
  it.each([
    ['7352.21+7.96', 7360_17], ['1200-150+30', 1080_00], ['-20+5', -15_00], [' 5 + 3 ', 8_00], ['=5+3', 8_00], ['100-250', -150_00],
    ['€1,200 + €300', 1500_00], ['0.1+0.2', 30], ['19,35+0,65', 20_00], ['1,935.50-935.50', 1000_00],
  ])('%s', (text, minor) => {
    expect(eur(text)).toBe(minor)
  })
  it('reads every number of it in the household\'s own format', () => {
    expect(eur('1.935,50+0,50', 'de-DE')).toBe(1936_00)
    expect(eur('1.935+65', 'de-DE')).toBe(2000_00)
  })
  it('adds whole units of a currency without cents', () => {
    expect(parseAmount('1000+500-1', 'JPY', 'en-IE')).toBe(1499)
  })
  it('takes a typographic minus for a minus, also in front of a single number', () => {
    expect(eur('100−20')).toBe(80_00)
    expect(eur('−20')).toBe(-20_00)
  })
  it('a sum still being typed counts as what is there so far', () => {
    expect(eur('500+')).toBe(500_00)
    expect(eur('500 - ')).toBe(500_00)
    expect(eur('500+20-')).toBe(520_00)
  })
  it('two signs in a row are no sum', () => {
    for (const text of ['5+-3', '5--3', '+-5', '++5', '5++3', '-+']) expect(eur(text), text).toBeNull()
  })
})

describe('parseAmount: signs that are not worked out', () => {
  it('are refused, never dropped: 1200/12 is not 120012', () => {
    for (const text of ['1200/12', '3*45', '3×45', '10÷2', '3x45', '3 X 45', '100+200/2', '2*-3']) expect(eur(text), text).toBeNull()
  })
  it('get their own message where the field says that it cannot read the number', () => {
    expect(ONLY_PLUS_MINUS).toBe('Only + and - can be used in an amount.')
    for (const text of ['1200/12', '3*45', '3×45', '10÷2', '3x45']) expect(unreadableAmount(text, 'That is not a number I can read.'), text).toBe(ONLY_PLUS_MINUS)
    for (const text of ['abc', '5+-3', '', 'Netflix']) expect(unreadableAmount(text, 'That is not a number I can read.'), text).toBe('That is not a number I can read.')
    expect(unreadableAmount('abc')).toBe('That is not a number I can read.')
  })
})

describe('sumResult: what the line under a field says', () => {
  it('is the result of two or more numbers', () => {
    expect(sumResult('7352.21+7.96', 'EUR', 'en-IE')).toBe(7360_17)
    expect(sumResult('5-5', 'EUR', 'en-IE')).toBe(0)
    expect(sumResult('-20+5', 'EUR', 'en-IE')).toBe(-15_00)
  })
  it('is nothing for a single number, a sum not begun, and what cannot be read', () => {
    for (const text of ['7352.21', '-20', '+5', '500+', '', 'abc', '1200/12', '5+-3']) expect(sumResult(text, 'EUR', 'en-IE'), text).toBeNull()
  })
})

describe('ordinalDay: a day of the month as it is said', () => {
  it('1st, 2nd, 3rd, 4th; the teens are all "th"', () => {
    expect([1, 2, 3, 4, 10, 11, 12, 13, 14, 20, 21, 22, 23, 24, 30, 31].map(ordinalDay)).toEqual(['1st', '2nd', '3rd', '4th', '10th', '11th', '12th', '13th', '14th', '20th', '21st', '22nd', '23rd', '24th', '30th', '31st'])
  })
})

describe('weekdayOf: the weekday a day of a month falls on', () => {
  it('is the calendar\'s, whatever the time zone of the device', () => {
    expect(weekdayOf('2026-11', 22, 'en-GB')).toBe('Sun')
    expect(weekdayOf('2026-11', 1, 'en-GB')).toBe('Sun')
    expect(weekdayOf('2027-02', 28, 'en-GB')).toBe('Sun')
    expect(weekdayOf('2026-12', 31, 'en-GB')).toBe('Thu')
    expect(weekdayOf('2026-11', 23, 'de-DE')).toBe('Mo')
  })
})
