import { fromMinor, toMinor, type Money } from './money'
import { ConversionSchema, type CellItem, type Conversion } from './schema'

/**
 * The arithmetic of a recorded conversion (rule X10 of docs/calculations.md). A conversion has three figures: an
 * amount in another currency, the amount in the household's, and the rate, written as a month's rate is: how many of
 * the other currency one unit of the household's buys. Any two give the third.
 *
 * The two directions multiply the way the month's rate does (`convertMoney` in `src/engine/fx.ts`), so a conversion
 * recorded at the month's own rate gives the very cent the month's rate gives.
 */

/** What an amount in the other currency comes to in the household's, at a rate. */
export function homeAmountAt(foreignAmount: Money, foreign: string, home: string, rate: number): Money {
  return toMinor(fromMinor(foreignAmount, foreign) * (1 / rate), home)
}

/** What an amount in the household's currency comes to in the other one, at a rate. */
export function foreignAmountAt(homeAmount: Money, home: string, foreign: string, rate: number): Money {
  return toMinor(fromMinor(homeAmount, home) * rate, foreign)
}

/** The rate two amounts say; null where one of them is nothing or they point in different directions. */
export function rateBetween(foreignAmount: Money, foreign: string, homeAmount: Money, home: string): number | null {
  const rate = fromMinor(foreignAmount, foreign) / fromMinor(homeAmount, home)
  return Number.isFinite(rate) && rate > 0 ? rate : null
}

export interface ConversionFigures {
  /** The other currency, and the household's. */
  foreign: string
  home: string
  foreignAmount?: Money | null
  homeAmount?: Money | null
  rate?: number | null
  /** The day whose official rate `rate` is, where it is one. */
  date?: string | null
}

/**
 * A conversion from any two of its three figures; given all three, they are kept as they are (the amounts are what
 * happened, and a rate with four decimals seldom gives both back to the cent). Null with fewer than two, with a rate
 * that is not above nothing, or between a currency and itself.
 */
export function conversionFrom(given: ConversionFigures): Conversion | null {
  const { foreign, home } = given
  if (foreign === home) return null
  const has = (n: number | null | undefined): n is number => n != null && Number.isFinite(n)
  const rateGiven = has(given.rate) && given.rate > 0 ? given.rate : null
  let { foreignAmount, homeAmount } = given
  let rate = rateGiven
  if (has(foreignAmount) && has(homeAmount)) rate ??= rateBetween(foreignAmount, foreign, homeAmount, home)
  else if (has(foreignAmount) && rate != null) homeAmount = homeAmountAt(foreignAmount, foreign, home, rate)
  else if (has(homeAmount) && rate != null) foreignAmount = foreignAmountAt(homeAmount, home, foreign, rate)
  if (!has(foreignAmount) || !has(homeAmount) || rate == null) return null
  // a day belongs to the rate it is the official rate of: a rate that follows from two amounts has none
  return ConversionSchema.parse({ foreign, foreignAmount, homeAmount, rate, date: rateGiven != null ? given.date ?? null : null })
}

/**
 * A conversion as it holds for an amount of `amount` typed in `currency`. While the amount is the one that was
 * recorded, the recorded figures hold exactly. Where the amount was corrected since, by whatever wrote the month, the
 * rate stays and the other amount follows (rule X10). Null when the conversion does not fit the amount any more: it
 * is typed in neither of the conversion's two currencies (the row was moved to a third).
 */
export function conversionFor(conversion: Conversion, amount: Money, currency: string, home: string): Conversion | null {
  if (conversion.foreign === home) return null
  if (currency === conversion.foreign) {
    return amount === conversion.foreignAmount ? conversion : { ...conversion, foreignAmount: amount, homeAmount: homeAmountAt(amount, conversion.foreign, home, conversion.rate) }
  }
  if (currency === home) {
    return amount === conversion.homeAmount ? conversion : { ...conversion, homeAmount: amount, foreignAmount: foreignAmountAt(amount, home, conversion.foreign, conversion.rate) }
  }
  return null
}

/**
 * The conversion in force on an item of a month in `currency`: the one recorded for it, as it holds for the item's
 * amount (`conversionFor`), while the item is done. A conversion says what happened, so an item that is not done has
 * none in force; what was recorded stays on it and counts again once the item is done again. A carried item and one
 * that is left out have none either.
 */
export function conversionOf(item: Pick<CellItem, 'amount' | 'status' | 'kind' | 'skipped' | 'conversion'>, currency: string, home: string): Conversion | null {
  const recorded = item.conversion ?? null
  if (!recorded || item.status !== 'done' || item.kind !== 'normal' || item.skipped) return null
  return conversionFor(recorded, item.amount, currency, home)
}
