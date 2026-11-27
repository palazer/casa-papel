import { formatMonth } from '@/app/format'
import { cadenceOf, dueMonthNumbers, nextDue, parseMonth, type MonthKey, type RepeatChoice } from '@/model'
import { formatDate, txt } from '@/i18n'

const T = txt.recurring.text

/** A month of the year by name, in the household's language. */
export function monthName(m: number, locale: string, style: 'long' | 'short' = 'long'): string {
  return formatDate(new Date(2026, m - 1, 1), locale, { month: style })
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
  if (due.length === 0) return txt.common.pickAMonth
  const list = due.length === 1 ? monthName(due[0], locale) : T.listAnd(due.slice(0, -1).map((m) => monthName(m, locale, 'short')).join(', '), monthName(due[due.length - 1], locale, 'short'))
  const lands = due.length === 12 ? T.landsInEveryMonth : due.length === 1 ? T.landsInEachYear(list) : T.landsIn(list)
  if (due.includes(parseMonth(month).month)) return lands
  const next = nextDue({ ...cadence, startMonth: month, endMonth: null }, month)
  return T.notInThisMonth(lands, formatMonth(month, locale, 'long'), next ? formatMonth(next, locale, 'long') : null)
}
