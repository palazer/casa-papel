import { formatMonth } from '@/app/format'
import { cadenceOf, dueMonthNumbers, nextDue, parseMonth, type MonthKey, type RepeatChoice } from '@/model'

/** A month of the year by name, in the household's language. */
export function monthName(m: number, locale: string, style: 'long' | 'short' = 'long'): string {
  return new Intl.DateTimeFormat(locale, { month: style }).format(new Date(2026, m - 1, 1))
}

/**
 * Where a rhythm lands, in one sentence, so nobody has to work out what "every 3 months from February" means; and,
 * when that is not the month on screen, when it lands next: "Lands in January each year. Not in November 2026; next:
 * January 2027."
 */
export function landsText(choice: RepeatChoice, month: MonthKey, locale: string): string {
  if (choice.kind === 'none') return ''
  const cadence = cadenceOf(choice)
  const due = dueMonthNumbers(cadence)
  if (due.length === 0) return 'Pick at least one month.'
  const list = due.length === 1 ? monthName(due[0], locale) : `${due.slice(0, -1).map((m) => monthName(m, locale, 'short')).join(', ')} and ${monthName(due[due.length - 1], locale, 'short')}`
  const lands = due.length === 12 ? 'Lands in every month.' : due.length === 1 ? `Lands in ${list} each year.` : `Lands in ${list}.`
  if (due.includes(parseMonth(month).month)) return lands
  const next = nextDue({ ...cadence, startMonth: month, endMonth: null }, month)
  return `${lands} Not in ${formatMonth(month, locale, 'long')}${next ? `; next: ${formatMonth(next, locale, 'long')}` : ''}.`
}
