import { describe, expect, it } from 'vitest'
import { CURRENCIES, currencyChoices, currencyLabel } from '@/app/currencies'
import { currencyExponent } from '@/model'

describe('the currencies a field offers (rule X13)', () => {
  it('are the fifteen, in their order', () => {
    expect(CURRENCIES).toEqual(['EUR', 'USD', 'GBP', 'TRY', 'CAD', 'AUD', 'CHF', 'SEK', 'NOK', 'DKK', 'PLN', 'CZK', 'HUF', 'RON', 'ISK'])
    expect(new Set(CURRENCIES).size).toBe(15)
  })

  it("puts the household's own first and names each once", () => {
    expect(currencyChoices('EUR')).toEqual(CURRENCIES)
    const tr = currencyChoices('TRY')
    expect(tr[0]).toBe('TRY')
    expect(tr).toHaveLength(15)
    expect([...tr].sort()).toEqual([...CURRENCIES].sort())
  })

  it('keeps a code that is in use and no longer on the list, whatever else is picked', () => {
    expect(currencyChoices('EUR', 'JPY')).toEqual([...CURRENCIES, 'JPY'])
    expect(currencyChoices('EUR', 'USD')).toEqual(CURRENCIES)
    expect(currencyChoices('EUR', null)).toEqual(CURRENCIES)
    // a household whose own currency is off the list
    expect(currencyChoices('JPY')).toEqual(['JPY', ...CURRENCIES])
  })

  it("says which one is the household's", () => {
    expect(currencyLabel('EUR', 'EUR')).toBe('EUR (household currency)')
    expect(currencyLabel('USD', 'EUR')).toBe('USD')
  })

  it('has one currency without cents among them', () => {
    expect(CURRENCIES.filter((c) => currencyExponent(c) !== 2)).toEqual(['ISK'])
  })
})
