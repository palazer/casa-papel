import { useMemo } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { computeEngine, type EngineOutput } from '@/engine'
import { addMonths, compareMonths, monthOfDate, monthRange, type Household, type MonthKey, type Tables } from '@/model'
import { loadTables } from '@/store'
import { useStore } from './store'

export function useTables(): Tables | undefined {
  const store = useStore()
  return useLiveQuery(() => loadTables(store), [store])
}

export function activeHousehold(tables: Tables | undefined): Household | undefined {
  return tables?.household.find((h) => !h.deletedAt)
}

/** From the household's start to a year past the latest of today and the last filled month. */
/** Cells made only of recurring postings. They must not stretch the range: the poster fills whatever range
 *  is shown, so counting them would push the range (and the postings) out by a year on every pass. */
function isManagedOnly(c: Tables['cells'][number]): boolean {
  return c.mode === 'items' && c.items.every((i) => i.recurringItemId != null)
}

export function defaultMonths(household: Household, tables: Tables, extra = 0): MonthKey[] {
  let last = monthOfDate()
  for (const c of tables.cells) if (!isManagedOnly(c) && compareMonths(c.month, last) > 0) last = c.month
  for (const s of tables.monthStates) if (s.closed && compareMonths(s.month, last) > 0) last = s.month
  const end = addMonths(last, 12 + extra)
  const start = compareMonths(household.startMonth, end) <= 0 ? household.startMonth : end
  return monthRange(start, end)
}

export function useEngine(tables: Tables | undefined, months: MonthKey[]): EngineOutput | null {
  return useMemo(() => (tables && months.length ? computeEngine({ tables, months }) : null), [tables, months])
}
