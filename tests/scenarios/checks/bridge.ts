import { cellKey, convertMoney, householdFx, type CellResult, type RecordedPart } from '@/engine'
import { accountRef, addMonths, cardIsItemized, cardOf, isTakenFromAccount, movesInto, payContext, pocketLandsIn, poolRef, type Money, type MonthKey, type Row } from '@/model'
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
  const fx = householdFx(tables.fxRates, household)
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

  /**
   * What recorded conversions (rule X10) did beside the month's rate, per account kept in another currency: the account
   * moves by the recorded amount, which at the month's rate is worth a little more or less than the household's amount
   * the rows count. `sign` is the one the money lands with: + into an asset or onto a debt, − out of it.
   */
  const recordedRates = new Map<string, Money>()
  const recorded = (id: string | null | undefined, c: CellResult, sign: 1 | -1, only: (p: RecordedPart) => boolean = () => true) => {
    const acc = id ? accounts.get(id) : undefined
    if (!acc || acc.currency === base || !c.recorded) return
    let diff: Money = 0
    for (const p of c.recorded) {
      if (!only(p)) continue
      const inAccount = acc.currency === c.currency ? p.amount : acc.currency === p.conversion.foreign ? p.conversion.foreignAmount : convertMoney(fx, p.conversion.homeAmount, base, acc.currency, m).value
      diff += convertMoney(fx, inAccount, acc.currency, base, m).value - p.conversion.homeAmount
    }
    recordedRates.set(acc.id, (recordedRates.get(acc.id) ?? 0) + sign * diff)
  }

  /**
   * What of an expense row's month was bought on which card (rule C2), read from the row and its items: the whole
   * amount on the row's card while no item names a payment method of its own; otherwise each item on the card its
   * method draws on, or on the row's card where it names none.
   */
  const pay = payContext(tables)
  const boughtOn = (row: Row, c: CellResult): Array<{ cardId: string; amount: Money; only: (p: RecordedPart) => boolean }> => {
    const live = c.source === 'items' ? c.items.filter((i) => !i.skipped) : []
    const named = live.some((i) => i.methodId != null || (i.recurringItemId != null && pay.schedules.get(i.recurringItemId)?.methodId != null))
    if (!named) {
      const cardId = cardOf(null, row, pay)
      return cardId ? [{ cardId, amount: c.valueBase, only: () => true }] : []
    }
    const by = new Map<string, { rest: Money; home: Money; items: Set<string> }>()
    for (const it of live) {
      const cardId = cardOf(it, row, pay)
      if (!cardId) continue
      const part = by.get(cardId) ?? { rest: 0, home: 0, items: new Set<string>() }
      const held = c.recorded?.find((p) => p.itemId === it.id)
      if (held) part.home += held.conversion.homeAmount
      else part.rest += it.effectiveAmount
      part.items.add(it.id)
      by.set(cardId, part)
    }
    return [...by].map(([cardId, part]) => ({
      cardId, amount: part.home + (part.rest !== 0 ? convertMoney(fx, part.rest, c.currency, base, m).value : 0), only: (p: RecordedPart) => p.itemId != null && part.items.has(p.itemId),
    }))
  }

  let toSavingsRows: Money = 0
  /** Paid to a card that records only its payments: spending, and nothing that changes what is owed. */
  let paidToLumpCards: Money = 0
  for (const row of engine.rows) {
    const c = engine.cells[cellKey(row.id, m)]
    if (!c || c.source === 'archived') continue
    const v = c.valueBase
    const account = row.accountId ? accounts.get(row.accountId) : undefined
    if (isTakenFromAccount(row)) {
      route(row.accountId, -v)
      recorded(row.accountId, c, -1)
    } else if (row.section === 'income') continue
    else if (row.kind === 'to-savings') {
      toSavingsRows += v
      route(row.accountId, v)
      recorded(row.accountId, c, 1)
    } else if (row.kind === 'to-investment') {
      route(row.accountId, v)
      recorded(row.accountId, c, 1)
    } else if (row.kind === 'pocket-money') {
      // pocket money leaves net worth whatever happens to it; where it lands is an account net worth does not count
      if (account && pocketLandsIn(row, account) && kindOf(account.id) !== 'none') land(account.id, v)
    } else if (row.kind === 'pool-allocation') {
      const pool = [...pools.values()].find((p) => p.allocationRowId === row.id)
      route(pool?.accountId, v)
    } else if (movesInto(row, account)) {
      // a row that moves money into the account it names: it arrives there. One that names none is in the month's
      // "moved elsewhere", and no account receives it.
      route(row.accountId, v)
      recorded(row.accountId, c, 1)
    } else if (row.kind === 'card-payment' && account?.type === 'credit-card' && !cardIsItemized(account)) {
      // nothing says what was bought on such a card, so its payment is what was spent; what is owed moves only with a real balance
      paidToLumpCards += v
    } else if (row.kind === 'debt-payment' || row.kind === 'card-payment') {
      owe(row.accountId, v)
      recorded(row.accountId, c, -1)
    } else if (row.section === 'expense') {
      // bought on a card whose purchases are recorded: the money is still in the current account, and owed on the card
      for (const part of boughtOn(row, c)) {
        owe(part.cardId, -part.amount)
        recorded(part.cardId, c, 1, part.only)
      }
      route(engine.primarySavingsId, -c.funding.savings)
      recorded(engine.primarySavingsId, c, -1, (p) => p.source === 'savings')
      for (const [pid, amount] of Object.entries(c.funding.pools)) {
        route(pools.get(pid)?.accountId, -amount)
        recorded(pools.get(pid)?.accountId, c, -1, (p) => p.source === poolRef(pid))
      }
      for (const [aid, amount] of Object.entries(c.funding.accounts)) {
        route(aid, -amount)
        recorded(aid, c, -1, (p) => p.source === accountRef(aid))
      }
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
    // and what recorded conversions came to beside the month's rate
    const byRecorded = recordedRates.get(id) ?? 0
    const fixedDeposits = acc?.investment?.depositFxMode === 'fixed' && acc.investment.fixedRate != null
    if (!fixedDeposits && Math.abs(left - byRate - byRecorded) > allowed) {
      problems.push(`"${acc?.name ?? id}" (${series.currency}) moved by ${moneyText(moved)} in ${monthName(m)}; the rows, growth and real balances explain ${moneyText(moved - left)}, the change in the rate ${moneyText(byRate)} and recorded conversions ${moneyText(byRecorded)}: ${moneyText(left - byRate - byRecorded)} is unexplained.`)
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
