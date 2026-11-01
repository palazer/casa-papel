import { fromMinor, toMinor, type FxRate, type Money, type MonthKey } from '@/model'

export interface FxIndex {
  /** pair → entries sorted by month ascending */
  pairs: Map<string, Array<{ month: MonthKey; rate: number }>>
}

export function buildFxIndex(rates: FxRate[]): FxIndex {
  const pairs = new Map<string, Array<{ month: MonthKey; rate: number }>>()
  for (const r of rates) {
    const list = pairs.get(r.pair) ?? []
    list.push({ month: r.month, rate: r.rate })
    pairs.set(r.pair, list)
  }
  for (const list of pairs.values()) list.sort((a, b) => (a.month < b.month ? -1 : a.month > b.month ? 1 : 0))
  return { pairs }
}

function lookup(list: Array<{ month: MonthKey; rate: number }> | undefined, month: MonthKey): number | null {
  if (!list || list.length === 0) return null
  let best: number | null = null
  for (const e of list) {
    if (e.month <= month) best = e.rate
    else break
  }
  return best ?? list[0].rate
}

/** How many `to` units one `from` unit buys in `month`. Falls back to the nearest known month, then the inverse pair. */
export function rateFor(fx: FxIndex, from: string, to: string, month: MonthKey): number | null {
  if (from === to) return 1
  const direct = lookup(fx.pairs.get(`${from}/${to}`), month)
  if (direct != null) return direct
  const inverse = lookup(fx.pairs.get(`${to}/${from}`), month)
  if (inverse != null && inverse !== 0) return 1 / inverse
  return null
}

export function convertMoney(fx: FxIndex, minor: Money, from: string, to: string, month: MonthKey): { value: Money; missingRate: boolean } {
  if (from === to) return { value: minor, missingRate: false }
  const rate = rateFor(fx, from, to, month)
  if (rate == null) return { value: minor, missingRate: true }
  return { value: toMinor(fromMinor(minor, from) * rate, to), missingRate: false }
}
