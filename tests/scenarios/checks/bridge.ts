import { buildFxIndex, cellKey, convertMoney } from '@/engine'
import { addMonths, cardIsItemized, isTakenFromAccount, pocketLandsIn, type Money, type MonthKey } from '@/model'
import { moneyText, monthName } from '../registry'
import type { View } from '../world'

/**
 * Why net worth moved in a month, in named parts (rule N2 of `docs/calculations.md`). Worked out here from the rows and
 * the accounts' settings, on its own: the engine's balances are only what the parts are compared with. So this is a
 * second calculation of every account's month, and of the month as a whole:
 *
 *   net worth at the end − net worth at the end of the month before
 *     = income − spending − pocket money − moved elsewhere
 *       + growth + rates + real balances + accounts starting or ending
 *       + accounts left out of net worth + money without an account
 */
export const BRIDGE_TERMS = [
  'income', 'spending', 'pocket money', 'moved elsewhere', 'growth', 'rates', 'real balances',
  'accounts starting or ending', 'accounts left out of net worth', 'money without an account',
] as const
export type BridgeTerm = (typeof BRIDGE_TERMS)[number]

export interface Bridge {
  month: MonthKey
  /** Net worth at the end of the month minus net worth at the end of the month before (nothing before the first month). */
  change: Money
  terms: Record<BridgeTerm, Money>
  /** What the terms leave over; zero when the month is explained. */
  unexplained: Money
  /** How far rounding between currencies may put it out; zero while every account is in the household's currency. */
  tolerance: Money
  /** What does not add up, in words: per account, and for the month as a whole. Empty when all of it does. */
  problems: string[]
}

export function bridgeOf(view: View, m: MonthKey): Bridge {
  const { tables, household, engine } = view
  const base = household.baseCurrency
  const prev = addMonths(m, -1)
  const t = engine.totals[m]
  const fx = buildFxIndex(tables.fxRates, { driftMode: household.fxDriftMode ?? 'fixed', fixedDrift: household.fxDriftDefault ?? 0, pairDrift: household.fxPairDrift ?? {}, base })
  const accounts = new Map(tables.accounts.filter((a) => !a.deletedAt).map((a) => [a.id, a]))
  const pools = new Map(tables.pools.filter((p) => !p.deletedAt).map((p) => [p.id, p]))
  const terms = Object.fromEntries(BRIDGE_TERMS.map((k) => [k, 0])) as Record<BridgeTerm, Money>
  const problems: string[] = []
  let tolerance: Money = 0

  // ---------- where each row's money goes, read from the rows alone ----------
  /** What the month's rows put into an account (+) or take out of it (−), in the household currency. For a card or a loan: what is owed. */
  const lands = new Map<string, Money>()
  /** How many amounts moved an account, for the rounding a foreign account is allowed. */
  const touches = new Map<string, number>()
  const land = (id: string, v: Money) => {
    if (v === 0) return
    lands.set(id, (lands.get(id) ?? 0) + v)
    touches.set(id, (touches.get(id) ?? 0) + 1)
  }
  /** An account with a balance this month that net worth counts, one it leaves out, or nothing to land in. */
  const kindOf = (id: string | null | undefined): 'counted' | 'outside' | 'none' => {
    const s = id ? engine.accounts[id] : undefined
    if (!s?.months[m]) return 'none'
    return s.outside ? 'outside' : 'counted'
  }
  /** Money between the month and an asset: `v` above zero goes into the account, below zero comes out of it. */
  const route = (id: string | null | undefined, v: Money) => {
    if (v === 0) return
    const kind = kindOf(id)
    if (kind === 'none') terms['money without an account'] -= v
    else {
      land(id!, v)
      if (kind === 'outside') terms['accounts left out of net worth'] -= v
    }
  }
  /** Money between the month and a debt: `v` above zero pays it down, below zero is bought on it. */
  const owe = (id: string | null | undefined, v: Money) => {
    if (v === 0) return
    if (kindOf(id) === 'none') terms['money without an account'] -= v
    else land(id!, -v)
  }

  let toSavingsRows: Money = 0
  /** Paid to a card that records only its payments: spending, and nothing that changes what is owed. */
  let paidToLumpCards: Money = 0
  for (const row of engine.rows) {
    const c = engine.cells[cellKey(row.id, m)]
    if (!c || c.source === 'archived') continue
    const v = c.valueBase
    const account = row.accountId ? accounts.get(row.accountId) : undefined
    if (isTakenFromAccount(row)) route(row.accountId, -v)
    else if (row.section === 'income') continue
    else if (row.kind === 'to-savings') {
      toSavingsRows += v
      route(row.accountId, v)
    } else if (row.kind === 'to-investment') route(row.accountId, v)
    else if (row.kind === 'pocket-money') {
      // pocket money leaves net worth whatever happens to it; where it lands is an account net worth does not count
      if (account && pocketLandsIn(row, account) && kindOf(account.id) !== 'none') land(account.id, v)
    } else if (row.kind === 'pool-allocation') {
      const pool = [...pools.values()].find((p) => p.allocationRowId === row.id)
      route(pool?.accountId, v)
    } else if (row.kind === 'card-payment' && account?.type === 'credit-card' && !cardIsItemized(account)) {
      // nothing says what was bought on such a card, so its payment is what was spent; what is owed moves only with a real balance
      paidToLumpCards += v
    } else if (row.kind === 'debt-payment' || row.kind === 'card-payment') owe(row.accountId, v)
    else if (row.section === 'expense') {
      // bought on a card whose purchases are expense rows: the money is still in the current account, and owed on the card
      if (account && cardIsItemized(account)) owe(account.id, -v)
      route(engine.primarySavingsId, -c.funding.savings)
      for (const [pid, amount] of Object.entries(c.funding.pools)) route(pools.get(pid)?.accountId, -amount)
      for (const [aid, amount] of Object.entries(c.funding.accounts)) route(aid, -amount)
    }
  }
  // the rest of the month when no row takes it: it counts as saved, and no account receives it
  terms['money without an account'] -= t.toSavings - toSavingsRows

  // ---------- the month's own sums ----------
  terms.income = t.income - t.fromAccounts
  // payments that bring a debt down are no spending; a payment to a card that records only its payments is
  terms.spending = -(t.expensesTotal - t.debt + paidToLumpCards)
  terms['pocket money'] = -t.pocket
  terms['moved elsewhere'] = -t.moved

  // ---------- every account's month, explained ----------
  const inBase = (currency: string, amount: Money): Money => convertMoney(fx, amount, currency, base, m).value
  for (const [id, series] of Object.entries(engine.accounts)) {
    const acc = accounts.get(id)
    const r = series.months[m]
    const before = series.months[prev]
    const sign = series.liability ? -1 : 1
    const count = (term: BridgeTerm, v: Money) => { if (!series.outside) terms[term] += sign * v }
    if (!r) {
      // the account ended: what it held is no longer counted
      if (before) count('accounts starting or ending', -before.balanceBase)
      continue
    }
    // rule C1: a payment stops at what is owed, so the rows never take a loan below nothing
    if (acc?.type === 'loan' && r.start >= 0 && r.computed < 0) {
      problems.push(`"${acc.name}" was paid down to ${moneyText(r.computed)} in ${monthName(m)}: a payment to a loan stops at what is owed.`)
    }
    const foreign = series.currency !== base
    const opening = before ? 0 : inBase(series.currency, r.start)
    const growth = inBase(series.currency, r.computed - r.start - r.inflow + r.outflow)
    const real = inBase(series.currency, r.adjustment)
    const flows = lands.get(id) ?? 0
    const moved = r.balanceBase - (before?.balanceBase ?? 0)
    const left = moved - opening - growth - real - flows
    count('accounts starting or ending', opening)
    count('growth', growth)
    count('real balances', real)
    if (!foreign) {
      if (left !== 0) problems.push(`"${acc?.name ?? id}" moved by ${moneyText(moved)} in ${monthName(m)}, and the rows explain ${moneyText(moved - left)}: ${moneyText(left)} is unexplained.`)
      continue
    }
    // kept in another currency: what is left over is what the rate did to the amount the month began with
    count('rates', left)
    const allowed = 2 * (4 + (touches.get(id) ?? 0))
    if (!series.outside) tolerance += allowed
    const byRate = before ? inBase(series.currency, r.start) - before.balanceBase : 0
    const fixedDeposits = acc?.investment?.depositFxMode === 'fixed' && acc.investment.fixedRate != null
    if (!fixedDeposits && Math.abs(left - byRate) > allowed) {
      problems.push(`"${acc?.name ?? id}" (${series.currency}) moved by ${moneyText(moved)} in ${monthName(m)}; the rows, growth and real balances explain ${moneyText(moved - left)} and the change in the rate ${moneyText(byRate)}: ${moneyText(left - byRate)} is unexplained.`)
    }
  }

  // ---------- the current accounts ----------
  const main = engine.main?.months[m]
  const mainBefore = engine.main?.months[prev]
  if (main) {
    terms['accounts starting or ending'] += main.start - (mainBefore?.balance ?? 0)
    terms['real balances'] += main.adjustment
    if (main.kept !== t.leftover) problems.push(`The current accounts kept ${moneyText(main.kept)} in ${monthName(m)}, and the month left ${moneyText(t.leftover)}.`)
  }

  const change = (engine.netWorth[m] ?? 0) - (engine.netWorth[prev] ?? 0)
  const unexplained = change - BRIDGE_TERMS.reduce((sum, k) => sum + terms[k], 0)
  if (Math.abs(unexplained) > tolerance) {
    const said = BRIDGE_TERMS.filter((k) => terms[k] !== 0).map((k) => `${k} ${moneyText(terms[k])}`).join(', ') || 'nothing'
    problems.push(`Net worth moved by ${moneyText(change)} in ${monthName(m)}; explained: ${said}; unexplained: ${moneyText(unexplained)}.`)
  }
  return { month: m, change, terms, unexplained, tolerance, problems }
}
