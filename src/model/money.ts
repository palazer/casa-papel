/**
 * Money is stored as an integer in the currency's minor unit (cents, kuruş).
 * Signs are never stored for direction: the row's section decides. Negative
 * values are allowed for corrections and adjustments.
 */
export type Money = number

const ZERO_DECIMAL = new Set(['JPY', 'KRW', 'VND', 'CLP', 'ISK', 'UGX', 'XAF', 'XOF', 'XPF'])
const THREE_DECIMAL = new Set(['BHD', 'IQD', 'JOD', 'KWD', 'LYD', 'OMR', 'TND'])

export function currencyExponent(code: string): number {
  if (ZERO_DECIMAL.has(code)) return 0
  if (THREE_DECIMAL.has(code)) return 3
  return 2
}

/** Convert a major-unit amount (e.g. 12.34) to minor units (1234). */
export function toMinor(major: number | string, code: string): Money {
  const n = typeof major === 'string' ? Number(major.replace(',', '.').trim()) : major
  if (!Number.isFinite(n)) throw new Error(`Invalid amount: ${major}`)
  return Math.round(n * 10 ** currencyExponent(code))
}

export function fromMinor(minor: Money, code: string): number {
  return minor / 10 ** currencyExponent(code)
}

export function formatMoney(minor: Money, code: string, locale: string, opts: { signDisplay?: 'auto' | 'always' | 'never' | 'exceptZero' } = {}): string {
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: code,
    signDisplay: opts.signDisplay ?? 'auto',
  }).format(fromMinor(minor, code))
}

/** Multiply minor units by a rate/share and round half away from zero. */
export function scaleMoney(minor: Money, factor: number): Money {
  const v = minor * factor
  return v < 0 ? -Math.round(-v) : Math.round(v)
}
