import { txt } from '@/i18n'

/**
 * The fifteen currencies offered wherever one is chosen (a household's own, a row's, an account's), rule X13 of
 * docs/calculations.md. The ECB publishes a rate for each against the euro, so the app can fetch it. A code outside
 * the list that is already in use keeps working (`currencyChoices`).
 */
export const CURRENCIES: string[] = [
  'EUR', 'USD', 'GBP', 'TRY', 'CAD', 'AUD', 'CHF', 'SEK', 'NOK', 'DKK', 'PLN', 'CZK', 'HUF', 'RON', 'ISK',
]

/**
 * The choices of a currency field: the household's own first, then the list, and the code in use when it is not on
 * the list (typed in an earlier version, or imported), so opening the dialog never changes it.
 */
export function currencyChoices(base: string, current?: string | null): string[] {
  const codes = [base, ...CURRENCIES.filter((c) => c !== base)]
  return current && !codes.includes(current) ? [...codes, current] : codes
}

/** How a currency reads in a choice: the household's own says so. */
export const currencyLabel = (code: string, base: string): string => (code === base ? txt.app.householdCurrency(code) : code)
