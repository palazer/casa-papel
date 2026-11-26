/**
 * The main account, read as what stays behind (rule B9). The month's money passes through it: the Statement's upper
 * half is its month. The engine keeps no balance of its own for it, so this works one out from what it already knows:
 *
 *   balance = opening balances + every month's leftover
 *
 * It is a calculated figure until someone says what the bank says: a month in which the main account has a real
 * balance (`AccountMonth.actualBalance`) takes it instead, and later months continue from it. The engine works the
 * series out over its whole range (`EngineOutput.main`) and counts it in net worth.
 *
 * A household has one main account open at a time, in its own currency (the store refuses a second one). One that was
 * archived stays part of the line, as its history: its money stays in the line, taken to have moved to the one that
 * replaced it. In a month where both were open the line is the two together, and a real balance needs both. Data from
 * before rule B9 can hold several main accounts until the app's upgrade has run (`planMainAccount`); they count
 * together in the same way, and one in another currency is converted once, when it opens, as it was then.
 */
import { compareMonths, type Account, type AccountMonth, type Money, type MonthKey } from '@/model'
import { convertMoney, type FxIndex } from './fx'
import type { MainAccountSeries, MonthTotals } from './types'

/**
 * Whether an account is a main account (type `checking`). An other current account (type `joint`) and cash have a
 * balance of their own, like any other asset (see `compute.ts`).
 */
export const isMainAccount = (account: Pick<Account, 'type'>): boolean => account.type === 'checking'
const byOrder = (a: Account, b: Account) => (a.order < b.order ? -1 : a.order > b.order ? 1 : 0)

/**
 * The main accounts that exist in a month, in their own order: opened by then, not archived yet. One, or none; two
 * only where an archived one and the one that replaced it were both open, or in data from before rule B9. Their real
 * balances are asked for, and all of them are needed for the month to count as entered.
 */
export function mainAccountsIn(accounts: Account[], month: MonthKey): Account[] {
  return accounts
    .filter((a) => !a.deletedAt && isMainAccount(a) && compareMonths(a.openingMonth, month) <= 0 && !(a.archivedMonth && compareMonths(month, a.archivedMonth) >= 0))
    .sort(byOrder)
}

/**
 * What the line is called on every screen: the main account's name, "Main account" without one. One that was
 * archived names the line only while there is no other.
 */
export function mainAccountLabel(series: MainAccountSeries, accounts: Account[]): string {
  const counted = series.accountIds.flatMap((id) => accounts.filter((a) => a.id === id))
  const open = counted.filter((a) => !a.archivedMonth)
  const named = open.length ? open : counted.sort((a, b) => compareMonths(a.archivedMonth ?? '', b.archivedMonth ?? '')).slice(-1)
  if (named.length === 1) return named[0].name
  return named.length > 1 ? 'Main accounts' : 'Main account'
}

/**
 * The running balance over `months`, which must begin at the household's first month (or before it) for the balance
 * to be a balance. `accounts` are the live ones; `totals` cover every one of `months`.
 */
export function mainAccountSeries(input: {
  months: MonthKey[]
  totals: Record<MonthKey, MonthTotals>
  accounts: Account[]
  /** Real balances by `<accountId>|<month>`. */
  actuals: ReadonlyMap<string, AccountMonth>
  fx: FxIndex
  base: string
}): MainAccountSeries {
  const { months, totals, accounts, actuals, fx, base } = input
  const current = accounts.filter(isMainAccount).sort(byOrder)

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
    const computed = start + kept
    // the real balance, of every main account open this month (one, but for the month an old one was replaced)
    const open = mainAccountsIn(current, m)
    let real: Money | null = open.length > 0 ? 0 : null
    const each: Record<string, { own: Money; base: Money }> = {}
    for (const acc of open) {
      const typed = actuals.get(`${acc.id}|${m}`)?.actualBalance
      if (typed == null) {
        real = null
        break
      }
      const conv = convertMoney(fx, typed, acc.currency, base, m)
      if (conv.missingRate) series.missingRate = true
      real = (real ?? 0) + conv.value
      each[acc.id] = { own: typed, base: conv.value }
    }
    balance = real ?? computed
    series.months[m] = { start, kept, computed, entered: real != null, adjustment: real != null ? real - computed : 0, balance, ...(real != null ? { real: each } : {}) }
  }
  return series
}
