import { fromMinor, parseMonth, toMinor, type Money, type MonthKey } from '@/model'

export function formatAmount(minor: Money, currency: string, locale: string, opts: { compact?: boolean; sign?: 'auto' | 'always' | 'never' | 'exceptZero' } = {}): string {
  const digits = opts.compact ? 0 : undefined
  return new Intl.NumberFormat(locale, {
    style: 'currency', currency, signDisplay: opts.sign ?? 'auto',
    minimumFractionDigits: digits, maximumFractionDigits: digits,
  }).format(fromMinor(minor, currency))
}

/** A whole amount without its currency ("7,405"), for a place too small for both: the page it stands on says the currency. */
export function formatWhole(minor: Money, currency: string, locale: string): string {
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(fromMinor(minor, currency))
}

/** An amount for a chart's axis, short: "€20K", "€1.5M", "€750". The axis says the size, the pointer the exact amount. */
export function formatAxis(minor: Money, currency: string, locale: string): string {
  return new Intl.NumberFormat(locale, { style: 'currency', currency, notation: 'compact', maximumFractionDigits: 1 }).format(fromMinor(minor, currency))
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

/** What a field says when someone tried to multiply or divide in it. */
export const ONLY_PLUS_MINUS = 'Only + and - can be used in an amount.'
/**
 * Signs of a calculation the app does not do: `*`, `/`, their printed forms, and an `x` between two numbers. They
 * are refused, never dropped: `1200/12` must not be read as 120012.
 */
const REFUSED_SIGN = /[*/\u00d7\u00f7]|\d\s*x\s*\d/i

/** One number without its sign, as people type it: "1.935,50", "1,935.50", "1935". */
function parseNumber(body: string, locale: string): number | null {
  if (!/\d/.test(body)) return null
  let s = body
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
  return Number.isFinite(n) ? n : null
}

/**
 * The signed numbers a typed amount is made of, each in the currency's smallest unit, or null when it cannot be
 * read. One number is one term; `1200-150+30` is three. A sign at the very end is a sum still being typed and counts
 * for nothing yet; two signs in a row are no sum.
 */
function termsOf(input: string, currency: string, locale: string): Money[] | null {
  // a typographic minus (or a dash pasted for one) is a minus
  const text = input.replace(/[\u2212\u2013]/g, '-')
  if (REFUSED_SIGN.test(text)) return null
  // everything else that is not part of a number is ignored: spaces, a currency sign, a leading "="
  const parts = text.replace(/[^\d.,\-+]/g, '').match(/[+-]?[^+-]*/g)?.filter((p) => p !== '') ?? []
  const terms: Money[] = []
  for (const [i, part] of parts.entries()) {
    const signed = part[0] === '+' || part[0] === '-'
    const body = signed ? part.slice(1) : part
    if (body === '') {
      if (i === parts.length - 1) continue
      return null
    }
    const n = parseNumber(body, locale)
    if (n == null) return null
    terms.push(toMinor(part[0] === '-' ? -n : n, currency))
  }
  return terms.length ? terms : null
}

/**
 * Lenient parser for a typed amount: accepts "1.935,50", "1,935.50", "1935", "-20", ignores currency symbols, and
 * adds up a sum ("7352.21+7.96", "1200-150+30"). Every number is turned into whole cents first, so the result is exact.
 */
export function parseAmount(input: string, currency: string, locale: string): Money | null {
  const terms = termsOf(input, currency, locale)
  return terms ? terms.reduce((a, b) => a + b, 0) : null
}

/** What a typed sum comes to, for the line under its field: null unless the text is two or more numbers. */
export function sumResult(input: string, currency: string, locale: string): Money | null {
  const terms = termsOf(input, currency, locale)
  return terms && terms.length > 1 ? terms.reduce((a, b) => a + b, 0) : null
}

/** What to say about a typed amount that cannot be read: that only + and - work when another sign was tried, else the field's own words. */
export function unreadableAmount(input: string, fallback = 'That is not a number I can read.'): string {
  return REFUSED_SIGN.test(input) ? ONLY_PLUS_MINUS : fallback
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

/** A day of the month as it is said: 1st, 2nd, 3rd, 4th, 11th, 21st, 22nd, 23rd, 31st. */
export function ordinalDay(day: number): string {
  const teen = day % 100 >= 11 && day % 100 <= 13
  const suffix = teen ? 'th' : day % 10 === 1 ? 'st' : day % 10 === 2 ? 'nd' : day % 10 === 3 ? 'rd' : 'th'
  return `${day}${suffix}`
}

