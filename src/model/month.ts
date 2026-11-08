/** Month key in `YYYY-MM` form. The app's time axis is monthly. */
export type MonthKey = string

export const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/

export function isMonthKey(s: string): s is MonthKey {
  return MONTH_PATTERN.test(s)
}

export function monthKey(year: number, month1to12: number): MonthKey {
  return `${String(year).padStart(4, '0')}-${String(month1to12).padStart(2, '0')}`
}

export function parseMonth(m: MonthKey): { year: number; month: number } {
  if (!isMonthKey(m)) throw new Error(`Invalid month key: ${m}`)
  return { year: Number(m.slice(0, 4)), month: Number(m.slice(5, 7)) }
}

export function addMonths(m: MonthKey, n: number): MonthKey {
  const { year, month } = parseMonth(m)
  const idx = year * 12 + (month - 1) + n
  return monthKey(Math.floor(idx / 12), (idx % 12) + 1)
}

export function compareMonths(a: MonthKey, b: MonthKey): number {
  return a < b ? -1 : a > b ? 1 : 0
}

/** Inclusive range from `a` to `b`. Empty if `b` is before `a`. */
export function monthRange(a: MonthKey, b: MonthKey): MonthKey[] {
  const out: MonthKey[] = []
  for (let m = a; compareMonths(m, b) <= 0; m = addMonths(m, 1)) out.push(m)
  return out
}

/** Number of months from `a` to `b` (b − a). Negative if b is earlier. */
export function monthDiff(a: MonthKey, b: MonthKey): number {
  const pa = parseMonth(a)
  const pb = parseMonth(b)
  return (pb.year - pa.year) * 12 + (pb.month - pa.month)
}

export function monthOfDate(d: Date = new Date()): MonthKey {
  return monthKey(d.getFullYear(), d.getMonth() + 1)
}

/** Today as an ISO date (YYYY-MM-DD) from the local calendar, the way the Paid sheet prefills its date. */
export function isoDateOfToday(d: Date = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** Last calendar day of the month as an ISO date (YYYY-MM-DD). */
export function lastDayOfMonth(m: MonthKey): string {
  const { year, month } = parseMonth(m)
  const d = new Date(Date.UTC(year, month, 0))
  return d.toISOString().slice(0, 10)
}
