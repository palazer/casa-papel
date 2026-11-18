import { compareMonths, type MonthKey } from './month'
import type { InvestmentSettings } from './schema'

type Growth = Pick<InvestmentSettings, 'annualRate' | 'rateChanges'>

/** An investment's yearly growth in a month: the latest change from that month or earlier, else its rate. */
export function growthIn(inv: Growth, m: MonthKey): number {
  let rate = inv.annualRate ?? 0
  let at: MonthKey | null = null
  for (const c of inv.rateChanges ?? []) {
    if (compareMonths(c.from, m) <= 0 && (at == null || compareMonths(c.from, at) >= 0)) {
      rate = c.annualRate
      at = c.from
    }
  }
  return rate
}

/** The changes with a new rate from `from` on: changes from earlier months stay, those from `from` on give way to it. */
export function growthChangedFrom(inv: Growth, from: MonthKey, annualRate: number): NonNullable<InvestmentSettings['rateChanges']> {
  return [...(inv.rateChanges ?? []).filter((c) => compareMonths(c.from, from) < 0), { from, annualRate }]
}
