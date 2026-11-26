import { formatMonth } from '@/app/format'
import { addMonths, compareMonths, type InvestmentSettings, type MonthKey } from '@/model'
import { txt } from '@/i18n'

const T = txt.household.growth

/** "6% a year until May 2026, 12% from June 2026": an investment's growth where it changed from a month on; null without such a change. */
export function growthText(inv: InvestmentSettings, locale: string): string | null {
  const changes = [...(inv.rateChanges ?? [])].sort((a, b) => compareMonths(a.from, b.from))
  if (changes.length === 0) return null
  const pct = (r: number) => `${Math.round(r * 10000) / 100}%`
  const until = (m: MonthKey) => formatMonth(addMonths(m, -1), locale, 'long')
  const parts = [T.aYearUntil(pct(inv.annualRate), until(changes[0].from))]
  changes.forEach((c, i) => {
    const next = changes[i + 1]
    parts.push(T.rateFrom(pct(c.annualRate), formatMonth(c.from, locale, 'long'), next ? until(next.from) : null))
  })
  return parts.join(', ')
}
