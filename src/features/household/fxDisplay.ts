import type { ChipTone } from '@/components/ui/chip'
import type { RateInfo } from '@/engine'
import type { FxRate } from '@/model'

/** Where a month's rate came from, as a chip: yours is sky, the ECB's a fact in zinc, a projection amber, a gap rose. */
export const TAG_TONE: Record<string, ChipTone> = { manual: 'sky', ECB: 'zinc', projected: 'amber', carried: 'zinc', missing: 'rose' }

export function rateTag(rec: Pick<FxRate, 'source'> | undefined, info: RateInfo | null): string {
  return rec?.source === 'manual' ? 'manual' : rec?.source === 'api' ? 'ECB' : info ? (info.projected ? 'projected' : 'carried') : 'missing'
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
