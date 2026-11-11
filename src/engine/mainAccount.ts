/**
 * The main account, read as what stays behind. The month's money passes through the current, joint and cash accounts:
 * the Statement's upper half is their month. The engine keeps no balance of their own for them, so this works one out
 * from what it already knows, for all of them together:
 *
 *   balance = opening balances + every month's leftover + bought on an itemized card − paid to it
 *
 * The card term is there because a card purchase counts as spent in the month it is made while the cash only leaves
 * when the bill is paid; until then the money waits in the account and the card shows the same amount as a debt.
 * It is a calculated figure, not a bank balance: nothing re-anchors it to a real one yet. The engine works it out
 * over its whole range (`EngineOutput.main`) and counts it in net worth.
 */
import { cardIsItemized, compareMonths, type Account, type Money, type MonthKey, type Row } from '@/model'
import { convertMoney, type FxIndex } from './fx'
import { cellKey, type CellResult, type MainAccountSeries, type MonthTotals } from './types'

const CURRENT_TYPES: ReadonlySet<string> = new Set(['checking', 'joint', 'cash'])

/**
 * The running balance over `months`, which must begin at the household's first month (or before it) for the balance
 * to be a balance. `accounts` are the live ones; `cells` and `totals` cover every one of `months`.
 */
export function mainAccountSeries(input: {
  months: MonthKey[]
  rows: Row[]
  cells: Record<string, CellResult>
  totals: Record<MonthKey, MonthTotals>
  accounts: Account[]
  fx: FxIndex
  base: string
}): MainAccountSeries {
  const { months, rows, cells, totals, accounts, fx, base } = input
  const current = accounts.filter((a) => CURRENT_TYPES.has(a.type)).sort((a, b) => (a.order < b.order ? -1 : a.order > b.order ? 1 : 0))
  const itemizedCards = new Set(accounts.filter((a) => cardIsItemized(a)).map((a) => a.id))
  const cardRows = rows.filter((r) => r.accountId != null && itemizedCards.has(r.accountId))

  const series: MainAccountSeries = { accountIds: current.map((a) => a.id), missingRate: false, months: {} }
  const entered = new Set<string>()
  let balance: Money = 0
  for (const m of months) {
    // an opening balance joins in its own month (the first month counted, when it is older than that)
    for (const acc of current) {
      if (entered.has(acc.id) || compareMonths(acc.openingMonth, m) > 0) continue
      entered.add(acc.id)
      const conv = convertMoney(fx, acc.openingBalance ?? 0, acc.currency, base, m)
      if (conv.missingRate) series.missingRate = true
      balance += conv.value
    }
    const start = balance
    const kept = totals[m]?.leftover ?? 0
    let cardBought: Money = 0
    let cardPaid: Money = 0
    for (const row of cardRows) {
      const c = cells[cellKey(row.id, m)]
      if (!c || c.value === 0 || c.source === 'archived') continue
      if (row.kind === 'card-payment') cardPaid += c.valueBase
      else if (row.section === 'expense') cardBought += c.valueBase
    }
    balance = start + kept + cardBought - cardPaid
    series.months[m] = { start, kept, cardBought, cardPaid, balance }
  }
  return series
}
