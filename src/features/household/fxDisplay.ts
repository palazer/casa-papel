import type { ChipTone } from '@/components/ui/chip'
import type { RateInfo } from '@/engine'
import { compareMonths, monthOfDate, type FxRate, type MonthKey } from '@/model'
import { rateSettled } from '@/store'

/** Where a month's rate came from, as a chip: yours is sky, the ECB's a fact in zinc, a forecast amber, a gap rose. */
export const TAG_TONE: Record<string, ChipTone> = { manual: 'sky', ECB: 'zinc', forecast: 'amber', carried: 'zinc', missing: 'rose' }

export function rateTag(rec: Pick<FxRate, 'source'> | undefined, info: RateInfo | null): string {
  return rec?.source === 'manual' ? 'manual' : rec?.source === 'api' ? 'ECB' : info ? (info.projected ? 'forecast' : 'carried') : 'missing'
}

const SOURCE: Record<string, string> = {
  manual: 'Your own rate for this month.',
  ECB: 'The European Central Bank\'s rate.',
  forecast: 'A forecast: worked out from the last official rate, the way "Months to come" under Household says.',
  carried: 'Carried over from the nearest month with a rate.',
  missing: 'No rate yet: amounts in this currency cannot be counted until there is one.',
}

/**
 * Where a month's rate came from, in words (rule X11): an official rate names its day, and says whether it is the
 * latest of a month that is still running or the last working day of one that is over.
 */
export function rateSource(tag: string, rec: Pick<FxRate, 'source' | 'date' | 'updatedAt'> | undefined, month: MonthKey, locale: string, today: MonthKey = monthOfDate()): string {
  if (tag !== 'ECB' || !rec?.date) return SOURCE[tag] ?? ''
  const day = formatDay(rec.date, locale)
  if (compareMonths(month, today) >= 0) return `The European Central Bank's latest rate, of ${day}. It moves until the month is over.`
  return rateSettled(rec, month, today) ? `The European Central Bank's rate of ${day}, the month's last working day.` : `The European Central Bank's rate of ${day}.`
}

/** Two to four decimals, no grouping, so the text can go straight back into an input. */
export function formatRate(n: number, locale: string): string {
  return new Intl.NumberFormat(locale, { minimumFractionDigits: 2, maximumFractionDigits: 4, useGrouping: false }).format(n)
}

export interface ReadableRate { from: string; to: string; rate: number; text: string }

/**
 * A rate the way people say it: the side whose number is at least 1 comes first ("1 USD = 48.58 TRY" in a TRY household,
 * "1 EUR = 1.08 USD" in a EUR one). The stored pair stays base/foreign; `toStored` turns a typed number back.
 */
export function readableRate(base: string, foreign: string, baseToForeign: number, locale: string): ReadableRate {
  const flip = baseToForeign > 0 && baseToForeign < 1
  const from = flip ? foreign : base
  const to = flip ? base : foreign
  const rate = flip ? 1 / baseToForeign : baseToForeign
  return { from, to, rate, text: `1 ${from} = ${formatRate(rate, locale)} ${to}` }
}

/** A number typed in the readable orientation, as the stored base→foreign rate. */
export function toStored(readable: Pick<ReadableRate, 'from'>, base: string, typed: number): number {
  return readable.from === base ? typed : 1 / typed
}

/** The day a fetched rate was taken on, in the household's locale ("2 Nov 2026"). */
export function formatDay(iso: string, locale: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' })
}
