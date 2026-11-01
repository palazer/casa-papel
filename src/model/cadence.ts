import { compareMonths, parseMonth, type MonthKey } from './month'
import type { RecurringItem } from './schema'

type CadenceLike = Pick<RecurringItem, 'cadence' | 'dueMonths'>
type RangeLike = Pick<RecurringItem, 'startMonth' | 'endMonth'>

/** Calendar months (1..12) in which the item falls due. Monthly when nothing is set. */
export function dueMonthNumbers(item: CadenceLike): number[] {
  if (item.dueMonths && item.dueMonths.length > 0) return [...new Set(item.dueMonths)].sort((a, b) => a - b)
  if (!item.cadence) return [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]
  const { intervalMonths, anchorMonth } = item.cadence
  const out: number[] = []
  for (let m = 1; m <= 12; m++) {
    if ((((m - anchorMonth) % intervalMonths) + intervalMonths) % intervalMonths === 0) out.push(m)
  }
  return out
}

export function isActiveIn(item: RangeLike, month: MonthKey): boolean {
  if (compareMonths(month, item.startMonth) < 0) return false
  if (item.endMonth && compareMonths(month, item.endMonth) > 0) return false
  return true
}

export function isDue(item: CadenceLike & RangeLike, month: MonthKey): boolean {
  if (!isActiveIn(item, month)) return false
  return dueMonthNumbers(item).includes(parseMonth(month).month)
}

export function describeCadence(item: CadenceLike, locale = 'en'): string {
  const fmt = new Intl.DateTimeFormat(locale, { month: 'short' })
  const names = (ms: number[]) => ms.map((m) => fmt.format(new Date(2026, m - 1, 1))).join(', ')
  if (item.dueMonths && item.dueMonths.length > 0) return `Months: ${names(dueMonthNumbers(item))}`
  if (!item.cadence || item.cadence.intervalMonths === 1) return 'Monthly'
  if (item.cadence.intervalMonths === 12) return `Yearly (${names([item.cadence.anchorMonth])})`
  return `Every ${item.cadence.intervalMonths} months (${names(dueMonthNumbers(item))})`
}
