import { fromMinor, toMinor, type FxRate, type Money, type MonthKey } from '@/model'

interface Entry { month: MonthKey; rate: number }

export interface FxOptions {
  /** 'fixed' uses fixedDrift (or a per-pair override); 'average' uses the mean month-over-month change of the last 12 known months. */
  driftMode?: 'fixed' | 'average'
  /** Monthly drift as a fraction, e.g. 0.015. */
  fixedDrift?: number
  pairDrift?: Record<string, number>
  /** The household's base currency: a pair known only against it is crossed through it (USD→TRY via EUR/USD and EUR/TRY). */
  base?: string
}

export interface FxIndex {
  /** pair → known entries (api or manual) sorted by month ascending */
  pairs: Map<string, Entry[]>
  opts: Required<Omit<FxOptions, 'base'>>
  base: string | null
}

export interface RateInfo {
  rate: number
  /** Beyond the last known month: extrapolated with the drift. */
  projected: boolean
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
    list.push({ month: r.month, rate: r.rate })
    pairs.set(r.pair, list)
  }
  for (const list of pairs.values()) list.sort((a, b) => (a.month < b.month ? -1 : a.month > b.month ? 1 : 0))
  return { pairs, opts: { driftMode: opts.driftMode ?? 'fixed', fixedDrift: opts.fixedDrift ?? 0, pairDrift: opts.pairDrift ?? {} }, base: opts.base ?? null }
}

/** Monthly drift used to extrapolate `pair` past its last known month. */
export function driftFor(fx: FxIndex, pair: string): number {
  const override = fx.opts.pairDrift[pair]
  if (override != null) return override
  if (fx.opts.driftMode === 'average') {
    const list = fx.pairs.get(pair) ?? []
    const tail = list.slice(-13)
    let sum = 0
    let n = 0
    for (let i = 1; i < tail.length; i++) {
      const gap = monthIndex(tail[i].month) - monthIndex(tail[i - 1].month)
      if (gap <= 0 || tail[i - 1].rate <= 0) continue
      sum += Math.pow(tail[i].rate / tail[i - 1].rate, 1 / gap) - 1
      n++
    }
    if (n > 0) return sum / n
  }
  return fx.opts.fixedDrift
}

function lookup(fx: FxIndex, pair: string, month: MonthKey): RateInfo | null {
  const list = fx.pairs.get(pair)
  if (!list || list.length === 0) return null
  const last = list[list.length - 1]
  if (month > last.month) {
    const n = monthIndex(month) - monthIndex(last.month)
    return { rate: last.rate * Math.pow(1 + driftFor(fx, pair), n), projected: true }
  }
  let best: number | null = null
  for (const e of list) {
    if (e.month <= month) best = e.rate
    else break
  }
  return { rate: best ?? list[0].rate, projected: false }
}

/** A known pair or its inverse, nothing else. */
function pairInfo(fx: FxIndex, from: string, to: string, month: MonthKey): RateInfo | null {
  const direct = lookup(fx, `${from}/${to}`, month)
  if (direct != null) return direct
  const inverse = lookup(fx, `${to}/${from}`, month)
  if (inverse != null && inverse.rate !== 0) return { rate: 1 / inverse.rate, projected: inverse.projected }
  return null
}

/** How many `to` units one `from` unit buys in `month`. Known months use the nearest earlier rate; later months are drifted;
 *  the inverse pair is a fallback, and a pair known only against the base currency is crossed through it (from→base→to),
 *  projected when either leg is. */
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
