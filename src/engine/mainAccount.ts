/**
 * The main account, read as what stays behind. The month's money passes through the current, joint and cash accounts:
 * the Statement's upper half is their month. The engine keeps no balance of their own for them, so this works one out
 * from what it already knows, for all of them together:
 *
 *   balance = opening balances + every month's leftover + bought on an itemized card − paid to it
 *
 * The card term is there because a card purchase counts as spent in the month it is made while the cash only leaves
 * when the bill is paid; until then the money waits in the account and the card shows the same amount as a debt.
 * It is a calculated figure until someone says what the bank says: a month in which every current account open in it
 * has a real balance (`AccountMonth.actualBalance`) takes their sum instead, and later months continue from it. One
 * account alone cannot anchor the line, because the plan only knows what all of them hold together. The engine works
 * the series out over its whole range (`EngineOutput.main`) and counts it in net worth.
 */
import { cardIsItemized, compareMonths, type Account, type AccountMonth, type Money, type MonthKey, type Row } from '@/model'
import { convertMoney, type FxIndex } from './fx'
import { cellKey, type CellResult, type MainAccountSeries, type MonthTotals } from './types'

const CURRENT_TYPES: ReadonlySet<string> = new Set(['checking', 'joint', 'cash'])
const byOrder = (a: Account, b: Account) => (a.order < b.order ? -1 : a.order > b.order ? 1 : 0)

/**
 * The current, joint and cash accounts that exist in a month, in their own order: opened by then, not archived yet.
 * These are the accounts whose real balances are asked for, and all of them are needed for the month to count as entered.
 */
export function currentAccountsIn(accounts: Account[], month: MonthKey): Account[] {
  return accounts
    .filter((a) => !a.deletedAt && CURRENT_TYPES.has(a.type) && compareMonths(a.openingMonth, month) <= 0 && !(a.archivedMonth && compareMonths(month, a.archivedMonth) >= 0))
    .sort(byOrder)
}

/** What the line is called on every screen: the one current account's name, "Current accounts" for several, "Main account" for none. */
export function mainAccountLabel(series: MainAccountSeries, accounts: Account[]): string {
  if (series.accountIds.length === 1) return accounts.find((a) => a.id === series.accountIds[0])?.name ?? 'Main account'
  return series.accountIds.length > 1 ? 'Current accounts' : 'Main account'
}

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
  /** Real balances by `<accountId>|<month>`. */
  actuals: ReadonlyMap<string, AccountMonth>
  fx: FxIndex
  base: string
}): MainAccountSeries {
  const { months, rows, cells, totals, accounts, actuals, fx, base } = input
  const current = accounts.filter((a) => CURRENT_TYPES.has(a.type)).sort(byOrder)
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
    const computed = start + kept + cardBought - cardPaid
    // the real balances, when every account open this month has one
    const open = currentAccountsIn(current, m)
    let real: Money | null = open.length > 0 ? 0 : null
    for (const acc of open) {
      const typed = actuals.get(`${acc.id}|${m}`)?.actualBalance
      if (typed == null) {
        real = null
        break
      }
      const conv = convertMoney(fx, typed, acc.currency, base, m)
      if (conv.missingRate) series.missingRate = true
      real = (real ?? 0) + conv.value
    }
    balance = real ?? computed
    series.months[m] = { start, kept, cardBought, cardPaid, computed, entered: real != null, adjustment: real != null ? real - computed : 0, balance }
  }
  return series
}
