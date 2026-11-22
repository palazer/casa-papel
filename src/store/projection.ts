import { compareMonths, monthKey, monthOfDate, monthRange, parseMonth, type Cell, type Household, type MonthKey, type Tables } from '@/model'
import { planEnd } from './months'
import { planRecurringPosts } from './recurring'

/** How far ahead the Trends page looks: as far as the plan, or to the December so many years after the current year. */
export type Horizon = 'plan' | 3 | 5 | 10
export const HORIZONS: Horizon[] = ['plan', 3, 5, 10]

/**
 * The months the Trends page shows: from the household's first month to the plan's end, or further. Looking further
 * never makes the plan longer: these are months to calculate, not months to keep.
 */
export function trendMonths(household: Household, tables: Tables, horizon: Horizon, today: MonthKey = monthOfDate()): MonthKey[] {
  const end = planEnd(household, tables, today)
  if (horizon === 'plan') return monthRange(household.startMonth, end)
  const far = monthKey(parseMonth(today).year + horizon, 12)
  return monthRange(household.startMonth, compareMonths(far, end) > 0 ? far : end)
}

/**
 * The tables as the plan would hold them if it reached as far as `months`: the schedules landed in the months after
 * the plan's end, as "Add <year>" and the app's own pass would land them (rule H5). The calculation carries amounts
 * forward by itself, but a schedule's amount is written into its month by the store, so without this a look ahead
 * would lose the rent with the plan's last December. Nothing is saved. The same tables when no month lies after the plan.
 */
export function projectTables(tables: Tables, months: MonthKey[], today: MonthKey = monthOfDate()): Tables {
  const household = tables.household.find((h) => !h.deletedAt)
  if (!household) return tables
  const end = planEnd(household, tables, today)
  const beyond = months.filter((m) => compareMonths(m, end) > 0)
  if (beyond.length === 0) return tables
  // the schedules write nothing but months of rows; they are put in by their key, in one pass
  const cells = new Map<string, Cell>(tables.cells.map((c) => [`${c.rowId}|${c.month}`, c]))
  for (const m of planRecurringPosts(tables, beyond)) {
    if (m.op === 'put' && m.table === 'cells') cells.set(`${m.record.rowId}|${m.record.month}`, m.record)
  }
  return { ...tables, cells: [...cells.values()] }
}
