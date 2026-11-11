import { useEffect, useRef } from 'react'
import type { Tables } from '@/model'
import { fetchRatesFor, pairsWithoutRates, type Store } from '@/store'

/**
 * A currency that comes into use (an account, a row or a schedule in it) gets its rates by itself: the ECB's month
 * rates from the household's first month on, the same fetch as "Fetch ECB rates" under Household. Only for a currency
 * that has no rate at all yet, fetched or typed, so nothing that already had a value changes. Each currency is asked
 * for once per session: offline, or for a currency the ECB does not publish, the amounts stay unconverted and the
 * rates card under Household is where a rate is typed or fetched again.
 */
export function useAutoRates(store: Store, tables: Tables | null | undefined): void {
  const asked = useRef(new Set<string>())
  useEffect(() => {
    if (!tables) return
    const missing = pairsWithoutRates(tables).filter((p) => !asked.current.has(p))
    if (missing.length === 0) return
    for (const p of missing) asked.current.add(p)
    void fetchRatesFor(store, missing.map((p) => p.split('/')[1])).catch(() => undefined)
  }, [store, tables])
}
