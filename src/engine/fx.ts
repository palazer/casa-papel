import { addMonths, fromMinor, toMinor, type FxRate, type Household, type Money, type MonthKey } from '@/model'

interface Entry { month: MonthKey; rate: number; /** Typed by the user, not fetched. */ typed: boolean }

export interface FxOptions {
  /**
   * A pair's own change per month as a fraction (0.015 is 1.5 %), where the household set one; 0 holds the last rate.
   * A pair without an entry follows its trend (rule X12).
   */
  pairDrift?: Record<string, number>
  /** The household's base currency: a pair known only against it is crossed through it (USD→TRY via EUR/USD and EUR/TRY). */
  base?: string
}

export interface FxIndex {
  /** pair → stored entries (fetched or typed) sorted by month ascending */
  pairs: Map<string, Entry[]>
  opts: { pairDrift: Record<string, number> }
  base: string | null
  /** What was worked out already: a forecast per pair and month, a trend per pair. */
  forecasts: Map<string, RateInfo>
  trends: Map<string, number>
}

export interface RateInfo {
  rate: number
  /** A forecast: the month lies after the pair's last official month and has no typed rate of its own. */
  projected: boolean
}

/** The trend is the average of this many changes from one month to the next: a year of them, so thirteen months of rates. */
export const TREND_CHANGES = 12
/** How much of a month's step is left in the next one: the trend fades out. */
export const TREND_FADE = 0.8

/**
 * A household's rate options, read in this one place. Every index that converts for a household is built from these
 * (`householdFx`): the calculation, the rates card, the rate under an amount and the checks. Read in several places,
 * they could come to disagree, and a screen would show another rate than the one the calculation used. The settings
 * of older versions (one % for all currencies, "repeat the average") are not read any more: `planHousekeeping`
 * copies such a % to each currency once.
 */
export function fxOptionsOf(household: Pick<Household, 'baseCurrency' | 'fxPairDrift'>): FxOptions {
  return { pairDrift: household.fxPairDrift ?? {}, base: household.baseCurrency }
}

/** The index a household converts with: its stored rates, read with its options. */
export function householdFx(rates: FxRate[], household: Parameters<typeof fxOptionsOf>[0]): FxIndex {
  return buildFxIndex(rates, fxOptionsOf(household))
}

const monthIndex = (m: MonthKey) => {
  const [y, mo] = m.split('-').map(Number)
  return y * 12 + mo
}

export function buildFxIndex(rates: FxRate[], opts: FxOptions = {}): FxIndex {
  const pairs = new Map<string, Entry[]>()
  for (const r of rates) {
    if (r.source === 'projected') continue
    const list = pairs.get(r.pair) ?? []
    list.push({ month: r.month, rate: r.rate, typed: r.source === 'manual' })
    pairs.set(r.pair, list)
  }
  for (const list of pairs.values()) list.sort((a, b) => (a.month < b.month ? -1 : a.month > b.month ? 1 : 0))
  return { pairs, opts: { pairDrift: opts.pairDrift ?? {} }, base: opts.base ?? null, forecasts: new Map(), trends: new Map() }
}

/**
 * Where a pair's history ends: at its last official month. What is typed for a month after that is a rate for a
 * month to come, not history. A pair that has typed rates only ends at its last stored month. The place in `list`.
 */
function historyEnd(list: Entry[]): number {
  for (let i = list.length - 1; i >= 0; i--) if (!list[i].typed) return i
  return list.length - 1
}

/**
 * A pair's trend: the average change per month over the last twelve changes of its history (rule X12). With less
 * than a year of rates there is no such average and the trend is nothing: the last rate is held, and two rates that
 * happen to be known are not drawn out into a course.
 */
export function trendFor(fx: FxIndex, pair: string): number {
  const known = fx.trends.get(pair)
  if (known != null) return known
  const list = fx.pairs.get(pair) ?? []
  const tail = list.slice(0, historyEnd(list) + 1).slice(-(TREND_CHANGES + 1))
  let trend = 0
  if (tail.length === TREND_CHANGES + 1) {
    let sum = 0
    let n = 0
    for (let i = 1; i < tail.length; i++) {
      // a month without a rate of its own in between: the change is spread over the months it took
      const gap = monthIndex(tail[i].month) - monthIndex(tail[i - 1].month)
      if (gap <= 0 || tail[i - 1].rate <= 0) continue
      sum += Math.pow(tail[i].rate / tail[i - 1].rate, 1 / gap) - 1
      n++
    }
    if (n > 0) trend = sum / n
  }
  fx.trends.set(pair, trend)
  return trend
}

/** How many months of rates a pair's history holds. The trend needs thirteen: twelve changes. */
export function historyMonths(fx: FxIndex, pair: string): number {
  const list = fx.pairs.get(pair) ?? []
  return list.length === 0 ? 0 : historyEnd(list) + 1
}

/** A pair's own change per month where the household set one (0 holds the last rate); null where it follows its trend. */
export function ownChangeFor(fx: FxIndex, pair: string): number | null {
  return fx.opts.pairDrift[pair] ?? null
}

/**
 * The rate of a stored pair in a month. Up to the end of its history: the month's own rate, else the nearest earlier
 * one, else the first. After it, the forecast (rule X12): each month takes the rate of the month before and moves it
 * by a step. The first step is the trend, and each further one is 80 % of the step before, so the course flattens
 * out. A pair with a change of its own moves by that every month, without fading. A rate typed for a month to come
 * is used as it is, and the forecast goes on from it.
 */
function lookup(fx: FxIndex, pair: string, month: MonthKey): RateInfo | null {
  const list = fx.pairs.get(pair)
  if (!list || list.length === 0) return null
  const h = historyEnd(list)
  const end = list[h]
  if (month <= end.month) {
    let best: number | null = null
    for (const e of list) {
      if (e.month <= month) best = e.rate
      else break
    }
    return { rate: best ?? list[0].rate, projected: false }
  }
  const worked = fx.forecasts.get(`${pair}|${month}`)
  if (worked) return worked
  const own = ownChangeFor(fx, pair)
  const typed = new Map(list.slice(h + 1).map((e) => [e.month, e.rate]))
  const n = monthIndex(month) - monthIndex(end.month)
  let rate = end.rate
  let step = own ?? trendFor(fx, pair)
  let m = end.month
  let info: RateInfo = { rate, projected: true }
  for (let k = 1; k <= n; k++) {
    m = addMonths(m, 1)
    const set = typed.get(m)
    rate = set ?? rate * (1 + step)
    if (own == null) step *= TREND_FADE
    info = { rate, projected: set == null }
    fx.forecasts.set(`${pair}|${m}`, info)
  }
  return info
}

/** A known pair or its inverse, nothing else. */
function pairInfo(fx: FxIndex, from: string, to: string, month: MonthKey): RateInfo | null {
  const direct = lookup(fx, `${from}/${to}`, month)
  if (direct != null) return direct
  const inverse = lookup(fx, `${to}/${from}`, month)
  if (inverse != null && inverse.rate !== 0) return { rate: 1 / inverse.rate, projected: inverse.projected }
  return null
}

/** How many `to` units one `from` unit buys in `month` (`lookup`). The inverse pair is a fallback, and a pair known only
 *  against the base currency is crossed through it (from→base→to): a forecast when either leg is one. */
export function rateInfo(fx: FxIndex, from: string, to: string, month: MonthKey): RateInfo | null {
  if (from === to) return { rate: 1, projected: false }
  const pair = pairInfo(fx, from, to, month)
  if (pair) return pair
  const via = fx.base
  if (!via || via === from || via === to) return null
  const a = pairInfo(fx, from, via, month)
  const b = pairInfo(fx, via, to, month)
  return a && b ? { rate: a.rate * b.rate, projected: a.projected || b.projected } : null
}

export function rateFor(fx: FxIndex, from: string, to: string, month: MonthKey): number | null {
  return rateInfo(fx, from, to, month)?.rate ?? null
}

export function convertMoney(fx: FxIndex, minor: Money, from: string, to: string, month: MonthKey): { value: Money; missingRate: boolean; projected: boolean } {
  if (from === to) return { value: minor, missingRate: false, projected: false }
  const info = rateInfo(fx, from, to, month)
  if (info == null) return { value: minor, missingRate: true, projected: false }
  return { value: toMinor(fromMinor(minor, from) * info.rate, to), missingRate: false, projected: info.projected }
}
