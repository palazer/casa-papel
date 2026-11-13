import { addMonths, compareMonths, parseMonth, type MonthKey } from './month'
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

/** The first month from `from` on in which the item falls due; null once it has ended. */
export function nextDue(item: CadenceLike & RangeLike, from: MonthKey): MonthKey | null {
  let m = compareMonths(from, item.startMonth) < 0 ? item.startMonth : from
  // the due months come round every year, so twelve steps see them all
  for (let i = 0; i < 12; i++, m = addMonths(m, 1)) {
    if (item.endMonth && compareMonths(m, item.endMonth) > 0) return null
    if (isDue(item, m)) return m
  }
  return null
}

/** A row's schedules that still run in `month` or after it: neither removed nor ended before it. */
export function runningSchedules(items: RecurringItem[], rowId: string, month: MonthKey): RecurringItem[] {
  return items.filter((r) => !r.deletedAt && r.rowId === rowId && !(r.endMonth && compareMonths(r.endMonth, month) < 0))
}

/** How a row repeats, in a few words: its one schedule's rhythm, or how many of its items repeat. */
export function repeatsText(items: CadenceLike[], locale = 'en'): string {
  return items.length === 1 ? describeCadence(items[0], locale) : `${items.length} items repeat`
}

/** How a schedule repeats, in the words the app uses for it everywhere: "Every month", "Every year (Jan)", "In Mar, Sep". */
export function describeCadence(item: CadenceLike, locale = 'en'): string {
  const fmt = new Intl.DateTimeFormat(locale, { month: 'short' })
  const names = (ms: number[]) => ms.map((m) => fmt.format(new Date(2026, m - 1, 1))).join(', ')
  if (item.dueMonths && item.dueMonths.length > 0) return `In ${names(dueMonthNumbers(item))}`
  if (!item.cadence || item.cadence.intervalMonths === 1) return 'Every month'
  if (item.cadence.intervalMonths === 12) return `Every year (${names([item.cadence.anchorMonth])})`
  return `Every ${item.cadence.intervalMonths} months (${names(dueMonthNumbers(item))})`
}

/**
 * How an amount repeats, the way a row's dialog asks it: not at all, every so many months (landing in `anchor` and
 * every `interval` months from there), or in chosen months of the year. A schedule stores the last two as `cadence`
 * and `dueMonths`.
 */
export type RepeatChoice =
  | { kind: 'none' }
  | { kind: 'every'; interval: 1 | 2 | 3 | 6 | 12; anchor: number }
  | { kind: 'months'; months: number[] }
export type Repeating = Exclude<RepeatChoice, { kind: 'none' }>

/** A schedule's rhythm as a choice. */
export function repeatOf(item: CadenceLike): Repeating {
  if (item.dueMonths && item.dueMonths.length > 0) return { kind: 'months', months: dueMonthNumbers(item) }
  return { kind: 'every', interval: item.cadence?.intervalMonths ?? 1, anchor: item.cadence?.anchorMonth ?? 1 }
}

/** A choice as a schedule stores it. Every month has no month of its own, so its anchor is always January. */
export function cadenceOf(choice: Repeating): CadenceLike {
  if (choice.kind === 'months') return { cadence: null, dueMonths: [...new Set(choice.months)].sort((a, b) => a - b) }
  return { cadence: { intervalMonths: choice.interval, anchorMonth: choice.interval === 1 ? 1 : choice.anchor }, dueMonths: null }
}

/** Two choices that land in the same months are the same choice, however they were picked. */
export function sameRepeat(a: RepeatChoice, b: RepeatChoice): boolean {
  if (a.kind === 'none' || b.kind === 'none') return a.kind === b.kind
  return dueMonthNumbers(cadenceOf(a)).join() === dueMonthNumbers(cadenceOf(b)).join()
}
