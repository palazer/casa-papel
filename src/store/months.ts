import { addMonths, compareMonths, monthOfDate, monthRange, type Household, type MonthKey, type Tables } from '@/model'

/** Cells made only of recurring postings. They must not stretch the range: the poster fills whatever range
 *  is shown, so counting them would push the range (and the postings) out by a year on every pass. */
function isManagedOnly(c: Tables['cells'][number]): boolean {
  return c.mode === 'items' && c.items.every((i) => i.recurringItemId != null)
}

/**
 * The months the app plans: from the household's start to a year past the latest of today, the last filled month
 * and the last closed month (`extra` months more). Cells of removed rows do not count; a stale device may still
 * hold some.
 */
export function defaultMonths(household: Household, tables: Tables, extra = 0, today: MonthKey = monthOfDate()): MonthKey[] {
  const live = new Set(tables.rows.filter((r) => !r.deletedAt).map((r) => r.id))
  let last = today
  for (const c of tables.cells) if (live.has(c.rowId) && !isManagedOnly(c) && compareMonths(c.month, last) > 0) last = c.month
  for (const s of tables.monthStates) if (s.closed && compareMonths(s.month, last) > 0) last = s.month
  const end = addMonths(last, 12 + extra)
  const start = compareMonths(household.startMonth, end) <= 0 ? household.startMonth : end
  return monthRange(start, end)
}
