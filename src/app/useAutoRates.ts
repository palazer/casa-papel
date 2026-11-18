import { useEffect, useRef, useState } from 'react'
import { isoDateOfToday, type Tables } from '@/model'
import { neededPairs, refreshRates, type Store } from '@/store'
import { readPref, writePref } from './prefs'

/** What this device remembers per household: the day it last brought the rates up to date, and for which pairs. */
export interface RatesAsked { day: string; pairs: string[] }

/**
 * The pairs to ask the rate service for now: the ones in use that were not brought up to date today on this device,
 * and were not tried and failed since the app was opened. A currency that comes into use later the same day is
 * asked for at once; a pair that is done for today is not asked for again, however often the data changes.
 */
export function pairsToAsk(needed: string[], asked: RatesAsked | null, today: string, tried: ReadonlySet<string>): string[] {
  const done = asked?.day === today ? asked.pairs : []
  return needed.filter((p) => !done.includes(p) && !tried.has(p))
}

/**
 * The app keeps the official rates up to date by itself (rule X11): once a day, for every currency in use, it
 * fetches what is open (`refreshRates`: the latest rate for the running month, the last working day's for a month
 * that ended, the months of a currency that is new). Only currency codes and dates are sent.
 *
 * It waits until `ready`: until the first exchange with the server is over, so a rate typed on another device is
 * here before this one fetches. A fetch that fails (offline, the service down) is not tried again until the device
 * is back online or the app is opened again; the amounts stay as they are meanwhile, and "Fetch ECB rates" under
 * Household asks at once. What was asked is remembered per household on this device, never in the household's data.
 */
export function useAutoRates(store: Store, tables: Tables | null | undefined, ready: boolean): void {
  const tried = useRef({ day: '', pairs: new Set<string>() })
  /** Counts the moments worth another look: the device is online again, the app is looked at again (a new day). */
  const [again, setAgain] = useState(0)
  useEffect(() => {
    const online = () => {
      tried.current.pairs.clear()
      setAgain((n) => n + 1)
    }
    const visible = () => { if (document.visibilityState === 'visible') setAgain((n) => n + 1) }
    window.addEventListener('online', online)
    document.addEventListener('visibilitychange', visible)
    return () => {
      window.removeEventListener('online', online)
      document.removeEventListener('visibilitychange', visible)
    }
  }, [])
  useEffect(() => {
    const household = tables?.household.find((h) => !h.deletedAt)
    if (!tables || !household || !ready) return
    const today = isoDateOfToday()
    if (tried.current.day !== today) tried.current = { day: today, pairs: new Set() }
    const key = `ratesAsked.${household.id}`
    const needed = neededPairs(tables)
    const todo = pairsToAsk(needed, readPref<RatesAsked | null>(key, null), today, tried.current.pairs)
    if (todo.length === 0) return
    for (const p of todo) tried.current.pairs.add(p)
    void refreshRates(store).then(() => {
      const before = readPref<RatesAsked | null>(key, null)
      writePref<RatesAsked>(key, { day: today, pairs: [...new Set([...(before?.day === today ? before.pairs : []), ...needed])] })
    }).catch(() => undefined)
  }, [store, tables, ready, again])
}
