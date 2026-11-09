/**
 * The main account, read as what stays behind. The month's money passes through the current, joint and cash accounts:
 * the Statement's upper half is their month. The engine keeps no balance for them, so this works one out from what it
 * already knows, for all of them together:
 *
 *   balance = opening balances + every month's leftover + bought on an itemized card − paid to it
 *
 * The card term is there because a card purchase counts as spent in the month it is made while the cash only leaves
 * when the bill is paid; until then the money waits in the account and the card shows the same amount as a debt.
 * It is a calculated figure, not a bank balance: nothing re-anchors it to a real one yet.
 */
import { cardIsItemized, compareMonths, type Money, type MonthKey, type Tables } from '@/model'
import { buildFxIndex, convertMoney } from './fx'
import { cellKey, type EngineOutput } from './types'

const CURRENT_TYPES: ReadonlySet<string> = new Set(['checking', 'joint', 'cash'])

export interface MainAccountMonth {
  /** Balance when the month began, in the base currency. */
  start: Money
  /** What the month left in the account: the cash buffer or the leftover. Negative when the month overran. */
  kept: Money
  /** Bought on an itemized card this month: spent on paper, the cash is still here. */
  cardBought: Money
  /** Paid to an itemized card this month. */
  cardPaid: Money
  balance: Money
}

export interface MainAccountSeries {
  /** The current, joint and cash accounts counted, in their own order. */
  accountIds: string[]
  /** An opening balance in another currency had no rate and was taken 1:1. */
  missingRate: boolean
  months: Record<MonthKey, MainAccountMonth>
}

/** Null when a running balance cannot be told: no household, or the engine's months do not start at its first month. */
export function computeMainAccount(tables: Tables, engine: EngineOutput): MainAccountSeries | null {
  const household = tables.household.find((h) => !h.deletedAt)
  if (!household || engine.months.length === 0) return null
  if (compareMonths(engine.months[0], household.startMonth) > 0) return null

  const base = household.baseCurrency
  const fx = buildFxIndex(tables.fxRates, { driftMode: household.fxDriftMode ?? 'fixed', fixedDrift: household.fxDriftDefault ?? 0, pairDrift: household.fxPairDrift ?? {}, base })
  const accounts = tables.accounts.filter((a) => !a.deletedAt)
  const current = accounts.filter((a) => CURRENT_TYPES.has(a.type)).sort((a, b) => (a.order < b.order ? -1 : a.order > b.order ? 1 : 0))
  const itemizedCards = new Set(accounts.filter((a) => cardIsItemized(a)).map((a) => a.id))
  const cardRows = engine.rows.filter((r) => r.accountId != null && itemizedCards.has(r.accountId))

  const series: MainAccountSeries = { accountIds: current.map((a) => a.id), missingRate: false, months: {} }
  const entered = new Set<string>()
  let balance: Money = 0
  for (const m of engine.months) {
    // an opening balance joins in its own month (the first month shown, when it is older than that)
    for (const acc of current) {
      if (entered.has(acc.id) || compareMonths(acc.openingMonth, m) > 0) continue
      entered.add(acc.id)
      const conv = convertMoney(fx, acc.openingBalance ?? 0, acc.currency, base, m)
      if (conv.missingRate) series.missingRate = true
      balance += conv.value
    }
    const start = balance
    const kept = engine.totals[m]?.leftover ?? 0
    let cardBought: Money = 0
    let cardPaid: Money = 0
    for (const row of cardRows) {
      const c = engine.cells[cellKey(row.id, m)]
      if (!c || c.value === 0 || c.source === 'archived') continue
      if (row.kind === 'card-payment') cardPaid += c.valueBase
      else if (row.section === 'expense') cardBought += c.valueBase
    }
    balance = start + kept + cardBought - cardPaid
    series.months[m] = { start, kept, cardBought, cardPaid, balance }
  }
  return series
}
