import { fromMinor, parseMonth, toMinor, type Money, type MonthKey } from '@/model'

export function formatAmount(minor: Money, currency: string, locale: string, opts: { compact?: boolean; sign?: 'auto' | 'always' | 'never' | 'exceptZero' } = {}): string {
  const digits = opts.compact ? 0 : undefined
  return new Intl.NumberFormat(locale, {
    style: 'currency', currency, signDisplay: opts.sign ?? 'auto',
    minimumFractionDigits: digits, maximumFractionDigits: digits,
  }).format(fromMinor(minor, currency))
}

export function formatPercent(fraction: number, locale: string): string {
  return new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 0 }).format(fraction)
}

/** A share to a tenth of a percent, for a rule: 0.1 → "10%", 0.125 → "12.5%". */
export function formatShare(fraction: number, locale: string): string {
  return new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 1 }).format(fraction)
}

export function formatMonth(m: MonthKey, locale: string, style: 'short' | 'long' = 'short'): string {
  const { year, month } = parseMonth(m)
  return new Intl.DateTimeFormat(locale, { month: style, year: 'numeric' }).format(new Date(year, month - 1, 1))
}

export function decimalSeparator(locale: string): string {
  return new Intl.NumberFormat(locale).formatToParts(1.1).find((p) => p.type === 'decimal')?.value ?? '.'
}

/** Plain editable text for an amount, using the locale's decimal separator and no grouping. */
export function amountToInput(minor: Money, currency: string, locale: string): string {
  if (minor === 0) return ''
  return fromMinor(minor, currency).toLocaleString(locale, { useGrouping: false, maximumFractionDigits: 3 })
}

/** Lenient parser: accepts "1.935,50", "1,935.50", "1935", "-20", ignores currency symbols. */
export function parseAmount(input: string, currency: string, locale: string): Money | null {
  let s = input.replace(/[^\d.,\-+]/g, '')
  if (!s || s === '-' || s === '+') return null
  const dec = decimalSeparator(locale)
  const group = dec === ',' ? '.' : ','
  if (s.includes('.') && s.includes(',')) {
    const last = Math.max(s.lastIndexOf('.'), s.lastIndexOf(','))
    const decChar = s[last]
    s = s.split(decChar === '.' ? ',' : '.').join('').replace(decChar, '.')
  } else if (s.includes(dec)) {
    s = s.replace(dec, '.')
  } else if (s.includes(group)) {
    const idx = s.lastIndexOf(group)
    const after = s.length - idx - 1
    s = after === 3 && s.indexOf(group) === idx ? s.replace(group, '') : s.replace(group, '.')
  }
  const n = Number(s)
  if (!Number.isFinite(n)) return null
  return toMinor(n, currency)
}

/** "English (Ireland)" for en-IE; falls back to the code. */
export function localeLabel(locale: string): string {
  try {
    return new Intl.DisplayNames(['en'], { type: 'language', languageDisplay: 'standard' }).of(locale) ?? locale
  } catch {
    return locale
  }
}

/** How a number and a date look in this locale, e.g. "1,234,567.89 · 1 Nov 2026". */
export function localeExample(locale: string): string {
  const n = new Intl.NumberFormat(locale).format(1234567.89)
  const d = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(2026, 10, 1))
  return `${n} · ${d}`
}
