import { describe, expect, it } from 'vitest'
import { buildFxIndex, convertMoney } from '@/engine'
import { FxRateSchema, conversionFor, conversionFrom, conversionOf, foreignAmountAt, homeAmountAt, newId, rateBetween, type CellItem, type Conversion } from '@/model'

/**
 * The arithmetic of a recorded conversion (rule X10): an amount in another currency, the amount in the household's,
 * and the rate between them, written as a month's rate is (how many dollars one euro buys). Any two give the third.
 */
const salary: Conversion = { foreign: 'USD', foreignAmount: 3300_00, homeAmount: 3000_00, rate: 1.1, date: '2026-01-30' }
const item = (over: Partial<CellItem> = {}): CellItem =>
  ({ id: newId(), label: '', amount: 3300_00, status: 'done', fundedBy: 'cash', date: null, note: null, recurringItemId: null, kind: 'normal', skipped: false, conversion: salary, ...over })

describe('one figure from two', () => {
  it('an amount in dollars at a rate, and back', () => {
    expect(homeAmountAt(3300_00, 'USD', 'EUR', 1.1)).toBe(3000_00)
    expect(foreignAmountAt(3000_00, 'EUR', 'USD', 1.1)).toBe(3300_00)
  })

  it('the rate two amounts say', () => {
    expect(rateBetween(3300_00, 'USD', 3000_00, 'EUR')).toBeCloseTo(1.1, 12)
    expect(rateBetween(3300_00, 'USD', 0, 'EUR')).toBeNull()
    expect(rateBetween(-3300_00, 'USD', 3000_00, 'EUR')).toBeNull()
  })

  it('krónur have no cents: 150,000 kr at 150 kr to the euro are 1,000.00 euros', () => {
    expect(homeAmountAt(150000, 'ISK', 'EUR', 150)).toBe(1000_00)
    expect(foreignAmountAt(1000_00, 'EUR', 'ISK', 150)).toBe(150000)
    expect(rateBetween(150000, 'ISK', 1000_00, 'EUR')).toBe(150)
  })

  it('at the month\'s own rate, it comes to the very cent the month\'s rate gives', () => {
    const fx = buildFxIndex([FxRateSchema.parse({ pair: 'EUR/USD', month: '2026-01', rate: 1.0873, source: 'api', updatedAt: 1 })], { base: 'EUR' })
    for (const dollars of [1_00, 33_33, 3300_00, 1234_567_89, 99]) {
      expect(homeAmountAt(dollars, 'USD', 'EUR', 1.0873)).toBe(convertMoney(fx, dollars, 'USD', 'EUR', '2026-01').value)
      expect(foreignAmountAt(dollars, 'EUR', 'USD', 1.0873)).toBe(convertMoney(fx, dollars, 'EUR', 'USD', '2026-01').value)
    }
  })
})

describe('a conversion from what was typed', () => {
  it('any two figures give the third', () => {
    expect(conversionFrom({ foreign: 'USD', home: 'EUR', foreignAmount: 3300_00, rate: 1.1 })).toEqual({ foreign: 'USD', foreignAmount: 3300_00, homeAmount: 3000_00, rate: 1.1, date: null })
    expect(conversionFrom({ foreign: 'USD', home: 'EUR', homeAmount: 3000_00, rate: 1.1 })).toEqual({ foreign: 'USD', foreignAmount: 3300_00, homeAmount: 3000_00, rate: 1.1, date: null })
    const both = conversionFrom({ foreign: 'USD', home: 'EUR', foreignAmount: 3300_00, homeAmount: 3000_00 })
    expect(both?.rate).toBeCloseTo(1.1, 12)
    expect(both).toMatchObject({ foreignAmount: 3300_00, homeAmount: 3000_00 })
  })

  it('all three are kept as they are: the amounts are what happened', () => {
    // 3,300.00 dollars at 1.0873 would be 3,035.04 euros; the bank paid 3,035.10
    expect(conversionFrom({ foreign: 'USD', home: 'EUR', foreignAmount: 3300_00, homeAmount: 3035_10, rate: 1.0873 })).toMatchObject({ foreignAmount: 3300_00, homeAmount: 3035_10, rate: 1.0873 })
  })

  it('the day belongs to an official rate; a rate that follows from two amounts has none', () => {
    expect(conversionFrom({ foreign: 'USD', home: 'EUR', foreignAmount: 3300_00, rate: 1.1, date: '2026-01-30' })?.date).toBe('2026-01-30')
    expect(conversionFrom({ foreign: 'USD', home: 'EUR', foreignAmount: 3300_00, homeAmount: 3000_00, date: '2026-01-30' })?.date).toBeNull()
  })

  it('none with fewer than two figures, a rate that is not above nothing, or one currency on both sides', () => {
    expect(conversionFrom({ foreign: 'USD', home: 'EUR', foreignAmount: 3300_00 })).toBeNull()
    expect(conversionFrom({ foreign: 'USD', home: 'EUR', rate: 1.1 })).toBeNull()
    expect(conversionFrom({ foreign: 'USD', home: 'EUR', foreignAmount: 3300_00, rate: 0 })).toBeNull()
    expect(conversionFrom({ foreign: 'USD', home: 'EUR', foreignAmount: 3300_00, rate: Number.NaN })).toBeNull()
    expect(conversionFrom({ foreign: 'USD', home: 'EUR', foreignAmount: 3300_00, homeAmount: 0 })).toBeNull()
    expect(conversionFrom({ foreign: 'EUR', home: 'EUR', foreignAmount: 3300_00, rate: 1 })).toBeNull()
  })
})

describe('a conversion as it holds for the amount', () => {
  it('the amount that was recorded: the figures hold exactly', () => {
    expect(conversionFor(salary, 3300_00, 'USD', 'EUR')).toBe(salary)
  })

  it('a corrected amount: the rate stays and the other amount follows', () => {
    expect(conversionFor(salary, 3520_00, 'USD', 'EUR')).toEqual({ ...salary, foreignAmount: 3520_00, homeAmount: 3200_00 })
  })

  it('an amount typed in the household\'s currency, into a dollar account: the dollars follow', () => {
    const deposit: Conversion = { foreign: 'USD', foreignAmount: 1100_00, homeAmount: 1000_00, rate: 1.1, date: null }
    expect(conversionFor(deposit, 1000_00, 'EUR', 'EUR')).toBe(deposit)
    expect(conversionFor(deposit, 2000_00, 'EUR', 'EUR')).toEqual({ ...deposit, foreignAmount: 2200_00, homeAmount: 2000_00 })
  })

  it('none for an amount in a third currency, or for one that names the household\'s own', () => {
    expect(conversionFor(salary, 3300_00, 'GBP', 'EUR')).toBeNull()
    expect(conversionFor({ ...salary, foreign: 'EUR' }, 3300_00, 'EUR', 'EUR')).toBeNull()
  })
})

describe('the conversion in force on an item', () => {
  it('while the item is done', () => {
    expect(conversionOf(item(), 'USD', 'EUR')).toBe(salary)
    expect(conversionOf(item({ amount: 3520_00 }), 'USD', 'EUR')?.homeAmount).toBe(3200_00)
  })

  it('none while it is not: what was recorded stays on it and counts again once it is done', () => {
    expect(conversionOf(item({ status: 'committed' }), 'USD', 'EUR')).toBeNull()
    expect(conversionOf(item({ status: 'projected' }), 'USD', 'EUR')).toBeNull()
  })

  it('none on an item that is left out, a carried one, or one without a conversion', () => {
    expect(conversionOf(item({ skipped: true }), 'USD', 'EUR')).toBeNull()
    expect(conversionOf(item({ kind: 'carry' }), 'USD', 'EUR')).toBeNull()
    expect(conversionOf(item({ conversion: undefined }), 'USD', 'EUR')).toBeNull()
    // an item stored before schema 18 has no such field at all
    const { conversion: _none, ...old } = item()
    expect(conversionOf(old, 'USD', 'EUR')).toBeNull()
  })
})
