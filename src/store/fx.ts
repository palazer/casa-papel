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

/** Daily rates → one rate per month and symbol, by the household's month-rate policy. */
export function monthRates(daily: Record<string, Record<string, number>>, policy: FxMonthRate): Record<MonthKey, Record<string, number>> {
  const buckets: Record<MonthKey, Record<string, number[]>> = {}
  for (const date of Object.keys(daily).sort()) {
    const m = date.slice(0, 7)
    const b = (buckets[m] ??= {})
    for (const [sym, rate] of Object.entries(daily[date])) (b[sym] ??= []).push(rate)
  }
  const out: Record<MonthKey, Record<string, number>> = {}
  for (const [m, syms] of Object.entries(buckets)) {
    out[m] = {}
    for (const [sym, list] of Object.entries(syms)) {
      out[m][sym] = policy === 'first' ? list[0] : policy === 'average' ? list.reduce((a, b) => a + b, 0) / list.length : list[list.length - 1]
    }
  }
  return out
}

const lastDay = (m: MonthKey) => {
  const [y, mo] = m.split('-').map(Number)
  return new Date(Date.UTC(y, mo, 0)).toISOString().slice(0, 10)
}

export interface FetchResult { written: number; months: MonthKey[]; unsupported: string[] }

/**
 * Fetch ECB month rates for base→symbols between two months (future months are clipped to today)
 * and store them as 'api' rates. Months that already have a manual rate are left alone.
 */
export async function fetchEcbRates(
  store: Store,
  opts: { base: string; symbols: string[]; from: MonthKey; to: MonthKey; policy: FxMonthRate },
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
  const manual = new Set(tables.fxRates.filter((r) => r.source === 'manual').map((r) => `${r.pair}|${r.month}`))
  const byMonth = monthRates(daily, opts.policy)
  const ts = now()
  const mutations: Mutation[] = []
  const months = new Set<MonthKey>()
  for (const [m, syms] of Object.entries(byMonth)) {
    for (const [sym, rate] of Object.entries(syms)) {
      const pair = `${opts.base}/${sym}`
      if (manual.has(`${pair}|${m}`)) continue
      mutations.push({ op: 'put', table: 'fxRates', record: FxRateSchema.parse({ pair, month: m, rate, source: 'api', updatedAt: ts }) })
      months.add(m)
    }
  }
  if (mutations.length) await store.commitSystem(mutations)
  return { written: mutations.length, months: [...months].sort(), unsupported }
}

/** Set a rate by hand (wins over fetched rates); null removes whatever is stored for that month. */
export async function setManualRate(store: Store, pair: string, month: MonthKey, rate: number | null): Promise<void> {
  if (rate == null) {
    await store.commit([{ op: 'delete', table: 'fxRates', key: [pair, month] }])
    return
  }
  if (!(rate > 0)) throw new Error('A rate must be a positive number.')
  await store.commit([{ op: 'put', table: 'fxRates', record: FxRateSchema.parse({ pair, month, rate, source: 'manual', updatedAt: now() }) }])
}

export const setFxSettings = (store: Store, patch: Partial<Pick<Household, 'fxDriftMode' | 'fxDriftDefault' | 'fxPairDrift' | 'fxMonthRate'>>) => updateHousehold(store, patch)
