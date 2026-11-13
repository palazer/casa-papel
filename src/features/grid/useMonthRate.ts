import { useMemo, useState } from 'react'
import { useStore } from '@/app/store'
import { buildFxIndex, rateInfo } from '@/engine'
import type { Household, MonthKey, Tables } from '@/model'
import { restoreEcbRate, setManualRate } from '@/store'
import { rateTag, readableRate, toStored } from '@/features/household/fxDisplay'

/**
 * One currency's rate in one month, and the two things that can be done to it: type your own, and go back to the
 * ECB's. Shared by the rate line under an amount (the cell editor) and the rate chip in the Statement's toolbar, so
 * both read and write a rate the same way.
 */
export function useMonthRate(tables: Tables, household: Household, month: MonthKey, currency: string) {
  const store = useStore()
  const base = household.baseCurrency
  const { locale } = household
  const pair = `${base}/${currency}`
  const fx = useMemo(
    () => buildFxIndex(tables.fxRates, { driftMode: household.fxDriftMode ?? 'fixed', fixedDrift: household.fxDriftDefault ?? 0, pairDrift: household.fxPairDrift ?? {}, base }),
    [tables.fxRates, household.fxDriftMode, household.fxDriftDefault, household.fxPairDrift, base],
  )
  const info = rateInfo(fx, base, currency, month)
  const rec = tables.fxRates.find((r) => r.pair === pair && r.month === month)
  const tag = rateTag(rec, info)
  const readable = readableRate(base, currency, info?.rate ?? 1, locale)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  /** Runs one change; `done` is called once it went through. */
  const run = async (fn: () => Promise<unknown>, done?: () => void) => {
    setBusy(true)
    setError(null)
    try {
      await fn()
      done?.()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not change the rate.')
    } finally {
      setBusy(false)
    }
  }
  /** A rate typed the way it is read ("1 EUR = 1.08 USD"), for this month alone. */
  const save = (text: string, done?: () => void) => {
    const v = Number(text.replace(',', '.'))
    if (!(v > 0)) return setError('A rate must be a positive number.')
    void run(() => setManualRate(store, pair, month, toStored(readable, base, v)), done)
  }
  /** Drop what is stored for the month and fetch the ECB's rate afresh. */
  const restore = (done?: () => void) => void run(() => restoreEcbRate(store, pair, month), done)

  return { base, locale, fx, info, rec, tag, readable, busy, error, setError, save, restore }
}
