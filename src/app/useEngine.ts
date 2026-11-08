import { useMemo } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { computeEngine, type EngineOutput } from '@/engine'
import type { Household, MonthKey, Tables } from '@/model'
import { loadTables } from '@/store'
import { useStore } from './store'

export { defaultMonths } from '@/store'

export function useTables(): Tables | undefined {
  const store = useStore()
  return useLiveQuery(() => loadTables(store), [store])
}

export function activeHousehold(tables: Tables | undefined): Household | undefined {
  return tables?.household.find((h) => !h.deletedAt)
}

export function useEngine(tables: Tables | undefined, months: MonthKey[]): EngineOutput | null {
  return useMemo(() => (tables && months.length ? computeEngine({ tables, months }) : null), [tables, months])
}
