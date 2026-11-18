import { formatMonth } from '@/app/format'
import { addMonths, compareMonths, type InvestmentSettings, type MonthKey } from '@/model'

/** "6% a year until May 2026, 12% from June 2026": an investment's growth where it changed from a month on; null without such a change. */
export function growthText(inv: InvestmentSettings, locale: string): string | null {
  const changes = [...(inv.rateChanges ?? [])].sort((a, b) => compareMonths(a.from, b.from))
  if (changes.length === 0) return null
  const pct = (r: number) => `${Math.round(r * 10000) / 100}%`
  const until = (m: MonthKey) => formatMonth(addMonths(m, -1), locale, 'long')
  const parts = [`${pct(inv.annualRate)} a year until ${until(changes[0].from)}`]
  changes.forEach((c, i) => {
    const next = changes[i + 1]
    parts.push(`${pct(c.annualRate)} from ${formatMonth(c.from, locale, 'long')}${next ? ` until ${until(next.from)}` : ''}`)
  })
  return parts.join(', ')
}
