/**
 * Currency rates: which pairs the household needs, fetching month rates from the ECB (via
 * Frankfurter, no key, only currency codes and dates leave the device), manual overrides,
 * and the drift settings used to project future months.
 */
import { FxRateSchema, type FxMonthRate, type Household, type MonthKey, type Tables } from '@/model'
import type { Mutation, Store } from './store'
import { loadTables, updateHousehold } from './actions'

const now = () => Date.now()

/** Currencies other than the base that appear in rows, accounts or schedules. */
export function neededCurrencies(tables: Tables): string[] {
  const base = tables.household.find((h) => !h.deletedAt)?.baseCurrency
  const set = new Set<string>()
  for (const r of tables.rows) if (!r.deletedAt && r.currency && r.currency !== base) set.add(r.currency)
  for (const a of tables.accounts) if (!a.deletedAt && a.currency !== base) set.add(a.currency)
  for (const i of tables.recurringItems) if (!i.deletedAt && i.currency && i.currency !== base) set.add(i.currency)
  return [...set].sort()
}

export function neededPairs(tables: Tables): string[] {
  const base = tables.household.find((h) => !h.deletedAt)?.baseCurrency
  return base ? neededCurrencies(tables).map((c) => `${base}/${c}`) : []
}

export interface MonthRate { rate: number; date: string | null }

/** Daily rates → one rate per month and symbol, by the household's month-rate policy, with the day it was taken on
 *  (the first or last business day the ECB published; none for an average). */
export function monthRatesWithDates(daily: Record<string, Record<string, number>>, policy: FxMonthRate): Record<MonthKey, Record<string, MonthRate>> {
  const buckets: Record<MonthKey, Record<string, Array<{ date: string; rate: number }>>> = {}
  for (const date of Object.keys(daily).sort()) {
    const m = date.slice(0, 7)
    const b = (buckets[m] ??= {})
    for (const [sym, rate] of Object.entries(daily[date])) (b[sym] ??= []).push({ date, rate })
  }
  const out: Record<MonthKey, Record<string, MonthRate>> = {}
  for (const [m, syms] of Object.entries(buckets)) {
    out[m] = {}
    for (const [sym, list] of Object.entries(syms)) {
      const first = list[0]
      const last = list[list.length - 1]
      out[m][sym] = policy === 'first' ? { rate: first.rate, date: first.date }
        : policy === 'average' ? { rate: list.reduce((a, b) => a + b.rate, 0) / list.length, date: null }
        : { rate: last.rate, date: last.date }
    }
  }
  return out
}

/** Daily rates → one rate per month and symbol (the number alone). */
export function monthRates(daily: Record<string, Record<string, number>>, policy: FxMonthRate): Record<MonthKey, Record<string, number>> {
  const out: Record<MonthKey, Record<string, number>> = {}
  for (const [m, syms] of Object.entries(monthRatesWithDates(daily, policy))) out[m] = Object.fromEntries(Object.entries(syms).map(([s, r]) => [s, r.rate]))
  return out
}

const lastDay = (m: MonthKey) => {
  const [y, mo] = m.split('-').map(Number)
  return new Date(Date.UTC(y, mo, 0)).toISOString().slice(0, 10)
}

export interface FetchResult { written: number; months: MonthKey[]; unsupported: string[] }

/**
 * Fetch ECB month rates for base→symbols between two months (future months are clipped to today)
 * and store them as 'api' rates. Months that already have a manual rate are left alone unless `replaceManual` is set.
 */
export async function fetchEcbRates(
  store: Store,
  opts: { base: string; symbols: string[]; from: MonthKey; to: MonthKey; policy: FxMonthRate; replaceManual?: boolean },
  fetchFn: typeof fetch = fetch,
): Promise<FetchResult> {
  const today = new Date().toISOString().slice(0, 10)
  const start = `${opts.from}-01`
  const end = lastDay(opts.to) < today ? lastDay(opts.to) : today
  if (start > end || opts.symbols.length === 0) return { written: 0, months: [], unsupported: [] }

  async function getDaily(symbols: string[]): Promise<Record<string, Record<string, number>> | null> {
    const url = `https://api.frankfurter.dev/v1/${start}..${end}?base=${encodeURIComponent(opts.base)}&symbols=${encodeURIComponent(symbols.join(','))}`
    const res = await fetchFn(url)
    if (res.status === 404 || res.status === 422) return null
    if (!res.ok) throw new Error(`The rate service answered ${res.status}. Try again later.`)
    const json = (await res.json()) as { rates?: Record<string, Record<string, number>> }
    return json.rates ?? {}
  }

  let daily = await getDaily(opts.symbols)
  const unsupported: string[] = []
  if (daily == null) {
    // one of the symbols is unknown to the ECB: fetch the rest one by one
    daily = {}
    for (const sym of opts.symbols) {
      const d = await getDaily([sym])
      if (d == null) { unsupported.push(sym); continue }
      for (const [date, rates] of Object.entries(d)) Object.assign((daily[date] ??= {}), rates)
    }
  }

  const tables = await loadTables(store)
  const manual = new Set(opts.replaceManual ? [] : tables.fxRates.filter((r) => r.source === 'manual').map((r) => `${r.pair}|${r.month}`))
  const byMonth = monthRatesWithDates(daily, opts.policy)
  const ts = now()
  const mutations: Mutation[] = []
  const months = new Set<MonthKey>()
  for (const [m, syms] of Object.entries(byMonth)) {
    for (const [sym, { rate, date }] of Object.entries(syms)) {
      const pair = `${opts.base}/${sym}`
      if (manual.has(`${pair}|${m}`)) continue
      mutations.push({ op: 'put', table: 'fxRates', record: FxRateSchema.parse({ pair, month: m, rate, date, source: 'api', updatedAt: ts }) })
      months.add(m)
    }
  }
  if (mutations.length) await store.commitSystem(mutations)
  return { written: mutations.length, months: [...months].sort(), unsupported }
}

/** Set a rate by hand (wins over fetched rates); null removes whatever is stored for that month, a manual or a fetched rate alike. */
export async function setManualRate(store: Store, pair: string, month: MonthKey, rate: number | null): Promise<void> {
  if (rate == null) {
    await store.commit([{ op: 'delete', table: 'fxRates', key: [pair, month] }])
    return
  }
  if (!(rate > 0)) throw new Error('A rate must be a positive number.')
  await store.commit([{ op: 'put', table: 'fxRates', record: FxRateSchema.parse({ pair, month, rate, source: 'manual', updatedAt: now() }) }])
}

/**
 * "Use the ECB rate again": drop what is stored for one month of one pair (your rate, or a stale fetched one) and fetch
 * that month from the ECB with the household's month-rate policy. A future month has nothing to fetch and is projected again.
 */
export async function restoreEcbRate(store: Store, pair: string, month: MonthKey, fetchFn: typeof fetch = fetch): Promise<FetchResult> {
  const tables = await loadTables(store)
  const household = tables.household.find((h) => !h.deletedAt)
  if (!household) throw new Error('No household yet')
  const [base, symbol] = pair.split('/')
  if (base !== household.baseCurrency) throw new Error(`Rates are fetched against ${household.baseCurrency}; ${pair} is not one of its pairs.`)
  // fetch first: a failed fetch throws here and the stored rate stays; a fetched rate replaces it in one write
  const res = await fetchEcbRates(store, { base, symbols: [symbol], from: month, to: month, policy: household.fxMonthRate, replaceManual: true }, fetchFn)
  // a month the ECB has nothing for (the future) goes back to a projection
  if (res.written === 0 && tables.fxRates.some((r) => r.pair === pair && r.month === month)) await setManualRate(store, pair, month, null)
  return res
}

export const setFxSettings = (store: Store, patch: Partial<Pick<Household, 'fxDriftMode' | 'fxDriftDefault' | 'fxPairDrift' | 'fxMonthRate'>>) => updateHousehold(store, patch)
