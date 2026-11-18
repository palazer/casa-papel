/**
 * Currency rates: which pairs the household needs, the official month rates (the ECB's, via Frankfurter: no key,
 * only currency codes and dates leave the device), rates typed by hand, and how each currency's months to come run.
 */
import { withDeadline } from '@/lib/deadline'
import {
  FxRateSchema, addMonths, compareMonths, isoDateOfToday, lastDayOfMonth, monthOfDate, monthRange, parseMonth,
  type FxRate, type MonthKey, type Tables,
} from '@/model'
import type { Mutation, Store } from './store'
import { loadTables, updateHousehold } from './actions'

const now = () => Date.now()

/** How long the rate service gets to answer before "Fetch rates" gives up. */
export const RATE_TIMEOUT_MS = 20_000

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

export interface MonthRate { rate: number; date: string }

/**
 * Daily rates → one rate per month and symbol: the one of the last day the month has in the answer, with that day.
 * For a month that is over that is its last working day; for the running month it is the latest rate (rule X11).
 */
export function monthRatesWithDates(daily: Record<string, Record<string, number>>): Record<MonthKey, Record<string, MonthRate>> {
  const out: Record<MonthKey, Record<string, MonthRate>> = {}
  for (const date of Object.keys(daily).sort()) {
    const month = (out[date.slice(0, 7)] ??= {})
    for (const [sym, rate] of Object.entries(daily[date])) month[sym] = { rate, date }
  }
  return out
}

/**
 * A month's rate is settled when nothing is left to fetch for it: you typed it, or the month is over and its record
 * holds the rate of its last working day, fetched after the month had ended. Everything else is open: no record, the
 * running month (its rate moves until it is over), a record taken while the month was still running, and a record
 * of an earlier version that took the month's first working day or an average. The day test tells those apart
 * without a calendar of holidays: the last published day of a month is never before the 26th, the first never after
 * the 5th. So what is fetched again is read from each record, on any device and after an old file is imported, and
 * needs no flag that could be lost or overrule another device.
 */
export function rateSettled(rec: Pick<FxRate, 'source' | 'date' | 'updatedAt'> | undefined, month: MonthKey, today: MonthKey = monthOfDate()): boolean {
  if (!rec) return false
  if (rec.source === 'manual') return true
  if (compareMonths(month, today) >= 0) return false
  if (!rec.date || rec.date.slice(0, 7) !== month || Number(rec.date.slice(8, 10)) < 20) return false
  const { year, month: number } = parseMonth(month)
  return rec.updatedAt >= new Date(year, number, 1).getTime()
}

export interface RatesPlan { base: string; symbols: string[]; from: MonthKey; to: MonthKey }

/**
 * What there is to fetch for some of the household's currencies: from the earliest month whose rate is still open
 * (`rateSettled`) up to the current month, for the currencies that have such a month. The months looked at start
 * with the household's first month, and a year back at least, so the trend has its twelve changes. Null when every
 * month is settled, which only happens while the running month has a rate you typed.
 */
export function ratesToFetch(tables: Tables, symbols: string[] = neededCurrencies(tables), today: MonthKey = monthOfDate()): RatesPlan | null {
  const household = tables.household.find((h) => !h.deletedAt)
  if (!household || symbols.length === 0) return null
  const yearAgo = addMonths(today, -13)
  const floor = compareMonths(yearAgo, household.startMonth) < 0 ? yearAgo : household.startMonth
  const stored = new Map(tables.fxRates.map((r) => [`${r.pair}|${r.month}`, r]))
  const months = monthRange(floor, today)
  let from: MonthKey | null = null
  const open: string[] = []
  for (const sym of symbols) {
    const first = months.find((m) => !rateSettled(stored.get(`${household.baseCurrency}/${sym}|${m}`), m, today))
    if (!first) continue
    open.push(sym)
    if (from == null || compareMonths(first, from) < 0) from = first
  }
  return from == null ? null : { base: household.baseCurrency, symbols: open, from, to: today }
}

export interface FetchResult { written: number; months: MonthKey[]; unsupported: string[] }

const NOTHING: FetchResult = { written: 0, months: [], unsupported: [] }

/**
 * Fetch the official month rates for base→symbols between two months (months to come are cut off at today) and
 * store them as 'api' rates: for each month the rate of its last published day. A month that is settled
 * (`rateSettled`: typed, or final) is left alone unless `replaceSettled` is set, and a running month whose rate did
 * not move is not written again, so a fetch that finds nothing new leaves nothing to sync.
 *
 * The service starts its answer at the last published day before the range when the range begins on a day without
 * one. That day is not written into its own month, which is outside what was asked for; it serves the running month
 * in its first days, before a rate is published in it: the month then takes that latest rate, with its real day.
 *
 * `byHand`: the fetch is one you asked for ("Use the ECB rate again"): it is saved as your change, so it can be undone
 * and asks first where it alters a month that is over (rule T4). Otherwise it is the app's own write.
 */
export async function fetchEcbRates(
  store: Store,
  opts: { base: string; symbols: string[]; from: MonthKey; to: MonthKey; replaceSettled?: boolean; byHand?: boolean },
  fetchFn: typeof fetch = fetch,
  timeoutMs: number = RATE_TIMEOUT_MS,
): Promise<FetchResult> {
  const today = isoDateOfToday()
  const thisMonth = monthOfDate()
  const start = `${opts.from}-01`
  const end = lastDayOfMonth(opts.to) < today ? lastDayOfMonth(opts.to) : today
  if (start > end || opts.symbols.length === 0) return { ...NOTHING }
  const get = withDeadline(fetchFn, timeoutMs, 'The rate service did not answer. Try again.')

  async function getDaily(symbols: string[]): Promise<Record<string, Record<string, number>> | null> {
    const url = `https://api.frankfurter.dev/v1/${start}..${end}?base=${encodeURIComponent(opts.base)}&symbols=${encodeURIComponent(symbols.join(','))}`
    const res = await get(url)
    if (res.status === 404 || res.status === 422) return null
    if (!res.ok) throw new Error(`The rate service answered ${res.status}. Try again later.`)
    const json = (await res.json()) as { rates?: Record<string, Record<string, number>> }
    return json.rates ?? {}
  }

  let daily = await getDaily(opts.symbols)
  const unsupported: string[] = []
  if (daily == null) {
    // none of the symbols is known to the ECB, or the service refuses the lot: ask one by one
    daily = {}
    for (const sym of opts.symbols) {
      const d = await getDaily([sym])
      if (d == null) { unsupported.push(sym); continue }
      for (const [date, rates] of Object.entries(d)) Object.assign((daily[date] ??= {}), rates)
    }
  }
  // a symbol the ECB does not publish is left out of an answer that has the others, without a word
  const answered = new Set(Object.values(daily).flatMap((day) => Object.keys(day)))
  if (answered.size > 0) for (const sym of opts.symbols) if (!answered.has(sym) && !unsupported.includes(sym)) unsupported.push(sym)

  const byMonth = monthRatesWithDates(daily)
  if (opts.to === thisMonth) {
    // the running month before its first rate is published: the latest rate there is
    const running = (byMonth[thisMonth] ??= {})
    const earlier = Object.keys(byMonth).filter((m) => m < thisMonth).sort()
    for (const sym of answered) {
      if (running[sym]) continue
      const latest = earlier.map((m) => byMonth[m][sym]).filter(Boolean).at(-1)
      if (latest) running[sym] = latest
    }
  }

  const tables = await loadTables(store)
  const stored = new Map(tables.fxRates.map((r) => [`${r.pair}|${r.month}`, r]))
  const ts = now()
  const mutations: Mutation[] = []
  const months = new Set<MonthKey>()
  for (const [m, syms] of Object.entries(byMonth)) {
    if (compareMonths(m, opts.from) < 0 || compareMonths(m, opts.to) > 0) continue
    for (const [sym, { rate, date }] of Object.entries(syms)) {
      const pair = `${opts.base}/${sym}`
      const has = stored.get(`${pair}|${m}`)
      if (!opts.replaceSettled && rateSettled(has, m, thisMonth)) continue
      // the running month, and nothing moved: no write. A month that is over is written once more even when the
      // rate is the same, because the write after its end is what settles it.
      if (has?.source === 'api' && has.rate === rate && has.date === date && compareMonths(m, thisMonth) >= 0) continue
      mutations.push({ op: 'put', table: 'fxRates', record: FxRateSchema.parse({ pair, month: m, rate, date, source: 'api', updatedAt: ts }) })
      months.add(m)
    }
  }
  if (mutations.length) await (opts.byHand ? store.commit(mutations) : store.commitSystem(mutations))
  return { written: mutations.length, months: [...months].sort(), unsupported }
}

/**
 * Bring the official rates up to date: the latest rate for the running month, the rate of its last working day for
 * every month that ended since, and whatever else is still open (`ratesToFetch`). For the currencies in use, and for
 * `also` (a currency that is being chosen and not saved yet). Used by the app itself once a day and by "Fetch ECB
 * rates".
 */
export async function refreshRates(store: Store, fetchFn: typeof fetch = fetch, also: string[] = []): Promise<FetchResult> {
  const tables = await loadTables(store)
  const base = tables.household.find((h) => !h.deletedAt)?.baseCurrency
  const plan = ratesToFetch(tables, [...new Set([...neededCurrencies(tables), ...also.filter((c) => c !== base)])])
  return plan ? fetchEcbRates(store, plan, fetchFn) : { ...NOTHING }
}

/** Set a rate by hand (it counts for its month instead of the official one); null removes whatever is stored for that month. */
export async function setManualRate(store: Store, pair: string, month: MonthKey, rate: number | null): Promise<void> {
  if (rate == null) {
    await store.commit([{ op: 'delete', table: 'fxRates', key: [pair, month] }])
    return
  }
  if (!(rate > 0)) throw new Error('A rate must be a positive number.')
  await store.commit([{ op: 'put', table: 'fxRates', record: FxRateSchema.parse({ pair, month, rate, source: 'manual', updatedAt: now() }) }])
}

/**
 * The official rate of one day, for a conversion recorded at it (rule X10): how many of `foreign` one `base` buys, and
 * the day the rate is of. The service is asked for that day alone and answers with the last day it published on or
 * before it, so a weekend or a holiday takes the working day before. Only the two codes and the date are sent.
 */
export async function fetchDayRate(base: string, foreign: string, day: string, fetchFn: typeof fetch = fetch, timeoutMs: number = RATE_TIMEOUT_MS): Promise<{ rate: number; date: string }> {
  const get = withDeadline(fetchFn, timeoutMs, 'The rate service did not answer. Try again.')
  const res = await get(`https://api.frankfurter.dev/v1/${day}..${day}?base=${encodeURIComponent(base)}&symbols=${encodeURIComponent(foreign)}`)
  if (res.status === 404 || res.status === 422) throw new Error(`The European Central Bank publishes no ${foreign} rate.`)
  if (!res.ok) throw new Error(`The rate service answered ${res.status}. Try again later.`)
  const json = (await res.json()) as { rates?: Record<string, Record<string, number>> }
  const found = Object.entries(json.rates ?? {}).filter(([date, rates]) => date <= day && rates[foreign] > 0).sort(([a], [b]) => (a < b ? -1 : 1)).at(-1)
  if (!found) throw new Error(`The European Central Bank published no ${foreign} rate on or before ${day}.`)
  return { rate: found[1][foreign], date: found[0] }
}

/**
 * "Use the ECB rate again": fetch one month of one pair from the ECB in place of what is stored for it (your rate, or
 * a stale fetched one). Only that month is written, as your change: Undo takes it back, and in a month that is over
 * it asks first. A month to come has nothing to fetch: what is stored for it goes, and the month is a forecast again.
 */
export async function restoreEcbRate(store: Store, pair: string, month: MonthKey, fetchFn: typeof fetch = fetch): Promise<FetchResult> {
  const tables = await loadTables(store)
  const household = tables.household.find((h) => !h.deletedAt)
  if (!household) throw new Error('No household yet')
  const [base, symbol] = pair.split('/')
  if (base !== household.baseCurrency) throw new Error(`Rates are fetched against ${household.baseCurrency}; ${pair} is not one of its pairs.`)
  // fetch first: a failed fetch throws here and the stored rate stays; a fetched rate replaces it in one write
  const res = await fetchEcbRates(store, { base, symbols: [symbol], from: month, to: month, replaceSettled: true, byHand: true }, fetchFn)
  if (res.unsupported.length) throw new Error(`The ECB does not publish ${symbol}. Keep entering its rate by hand.`)
  if (res.written === 0) {
    // only a month the ECB cannot have yet (one to come) goes back to a forecast; otherwise what was typed stays
    if (compareMonths(month, monthOfDate()) > 0) {
      if (tables.fxRates.some((r) => r.pair === pair && r.month === month)) await setManualRate(store, pair, month, null)
    } else if (!tables.fxRates.some((r) => r.pair === pair && r.month === month && r.source === 'api')) {
      throw new Error(`The ECB has no ${symbol} rate for that month yet; the one you typed stays.`)
    }
  }
  return res
}

/**
 * How one currency pair goes on after its last official rate (rule X12): its own change per month as a fraction (0
 * holds the last rate), or null to follow its trend again.
 */
export async function setPairForecast(store: Store, pair: string, change: number | null): Promise<void> {
  const household = (await loadTables(store)).household.find((h) => !h.deletedAt)
  if (!household) throw new Error('No household yet')
  if (change != null && !Number.isFinite(change)) throw new Error('The change per month is not a number.')
  const own = { ...(household.fxPairDrift ?? {}) }
  if (change == null) delete own[pair]
  else own[pair] = change
  await updateHousehold(store, { fxPairDrift: own })
}
