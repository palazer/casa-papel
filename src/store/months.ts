import { compareMonths, decemberOf, monthKey, monthOfDate, monthRange, parseMonth, type Household, type MonthKey, type Tables } from '@/model'

/** Cells made only of recurring postings. They must not stretch the range: the poster fills whatever range
 *  is shown, so counting them would push the range (and the postings) out by a year on every pass. */
function isManagedOnly(c: Tables['cells'][number]): boolean {
  return c.mode === 'items' && c.items.every((i) => i.recurringItemId != null)
}

/**
 * The last month the plan reaches, always a December: this year's, or next year's from October on (under three months
 * left, applied every day so the current month is never outside the range after New Year). Raised to the December of
 * `planUntil` ("Add <year>"), of the latest month the user filled in a live row, and of the latest closed month; never
 * before the household's first month (a start after the end makes the end that year's December). Cells of removed rows
 * do not count; a stale device may still hold some.
 */
export function planEnd(household: Household, tables: Tables, today: MonthKey = monthOfDate()): MonthKey {
  const { year, month } = parseMonth(today)
  let end = monthKey(month >= 10 ? year + 1 : year, 12)
  const raise = (m: MonthKey | null) => {
    if (m && compareMonths(decemberOf(m), end) > 0) end = decemberOf(m)
  }
  raise(household.planUntil)
  const live = new Set(tables.rows.filter((r) => !r.deletedAt).map((r) => r.id))
  for (const c of tables.cells) if (live.has(c.rowId) && !isManagedOnly(c)) raise(c.month)
  for (const s of tables.monthStates) if (s.closed) raise(s.month)
  raise(household.startMonth)
  return end
}

/** The months the app plans: from the household's start to `planEnd`. Every screen and the recurring poster use this. */
export function defaultMonths(household: Household, tables: Tables, today: MonthKey = monthOfDate()): MonthKey[] {
  return monthRange(household.startMonth, planEnd(household, tables, today))
}
