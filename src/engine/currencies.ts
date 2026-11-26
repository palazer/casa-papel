import { txt } from '@/i18n'
import { accountIdOf, movesInto, paysExpenses, pocketLandsIn, poolIdOf, resolveRules, type Account, type FundedBy, type Row, type Tables } from '@/model'
import { primarySavingsOf } from './compute'

/**
 * Rule X15 of docs/calculations.md: no amount across three currencies. An amount is typed in its row's currency, the
 * plan counts it in the household's, and it moves money out of or into accounts that each keep their own. Together
 * that may be two currencies, never three: a pound expense comes out of an account in pounds or in the household's
 * currency, a euro transfer in a euro household goes into an account in one other currency at most.
 *
 * The current accounts are in the household's currency, so an amount that only goes through them is always allowed.
 */

/** An end of an amount: an account it comes out of or goes into. */
export interface AmountEnd {
  account: Account
  way: 'out-of' | 'into'
}

/**
 * One amount of a row as the rule sees it. An expense has one per source it is paid from (the row's own, an item's,
 * a schedule's), keyed by the source; any other row has one, keyed 'row'.
 */
export interface AmountUnit {
  key: string
  /** The currency the amount is in: the row's own, or for a row that follows another, that row's. */
  currency: string
  ends: AmountEnd[]
}

/** The kinds of rows the calculation books by kind; every other expense comes out of its source. */
const BOOKED_BY_KIND = new Set<Row['kind']>(['to-savings', 'to-investment', 'pocket-money', 'pool-allocation', 'debt-payment', 'card-payment'])

interface View {
  tables: Tables
  home: string
  accounts: Map<string, Account>
  rows: Map<string, Row>
  ruled: Set<string>
  primarySavings: string | null
}

function viewOf(tables: Tables): View | null {
  const household = tables.household.find((h) => !h.deletedAt)
  if (!household) return null
  const rows = tables.rows.filter((r) => !r.deletedAt)
  return {
    tables,
    home: household.baseCurrency,
    accounts: new Map(tables.accounts.filter((a) => !a.deletedAt).map((a) => [a.id, a])),
    rows: new Map(rows.map((r) => [r.id, r])),
    ruled: new Set(resolveRules(rows, household.closingRule).byRow.keys()),
    primarySavings: primarySavingsOf(tables),
  }
}

/** The currency a row's amounts are in. A row that follows another takes that row's (`computeEngine` pass 1). */
function currencyOf(v: View, row: Row): string {
  let r: Row | undefined = row
  for (let depth = 0; r && depth < 16; depth++) {
    const target: Row | undefined = r.followsRowId && !v.ruled.has(r.id) ? v.rows.get(r.followsRowId) : undefined
    if (!target) return r.currency ?? v.home
    r = target
  }
  return row.currency ?? v.home
}

/** The account a row names, at the end the calculation books it at; none where the calculation does not read it. */
function ownEnd(v: View, row: Row): AmountEnd | null {
  if (row.kind === 'pool-allocation') {
    const pool = v.tables.pools.find((p) => !p.deletedAt && p.allocationRowId === row.id)
    const acc = pool ? v.accounts.get(pool.accountId) : undefined
    return acc ? { account: acc, way: 'into' } : null
  }
  const acc = row.accountId ? v.accounts.get(row.accountId) : undefined
  if (!acc) return null
  switch (row.kind) {
    case 'to-savings': case 'to-investment': case 'debt-payment': case 'card-payment':
      return { account: acc, way: 'into' }
    case 'from-savings': case 'from-investment':
      return { account: acc, way: 'out-of' }
    case 'pocket-money':
      return pocketLandsIn(row, acc) ? { account: acc, way: 'into' } : null
  }
  if (movesInto(row, acc)) return { account: acc, way: 'into' }
  return null
}

/** The account a source names; none for the current accounts, or for an account no expense can come out of. */
function sourceEnd(v: View, fundedBy: FundedBy): AmountEnd | null {
  const poolId = poolIdOf(fundedBy)
  const accountId = poolId ? v.tables.pools.find((p) => p.id === poolId && !p.deletedAt)?.accountId : fundedBy === 'savings' ? v.primarySavings : accountIdOf(fundedBy)
  const acc = accountId ? v.accounts.get(accountId) : undefined
  return acc && paysExpenses(acc) ? { account: acc, way: 'out-of' } : null
}

/** Every source a row's amounts come out of: the row's own, its items' in every month, its schedules'. */
function sourcesOf(v: View, row: Row): FundedBy[] {
  const out = new Set<FundedBy>([row.defaultFundedBy])
  for (const c of v.tables.cells) if (c.rowId === row.id) for (const it of c.items) if (!it.skipped) out.add(it.fundedBy)
  for (const s of v.tables.recurringItems) if (s.rowId === row.id && !s.deletedAt) out.add(s.fundedBy)
  return [...out]
}

function unitsIn(v: View, row: Row): AmountUnit[] {
  const currency = currencyOf(v, row)
  const own = ownEnd(v, row)
  const ends = own ? [own] : []
  if (row.section !== 'expense' || BOOKED_BY_KIND.has(row.kind)) return [{ key: 'row', currency, ends }]
  return sourcesOf(v, row).map((s) => {
    const from = sourceEnd(v, s)
    return { key: s, currency, ends: from ? [...ends, from] : ends }
  })
}

/** A row's amounts, one per source, with the accounts each moves money out of or into. */
export function amountUnits(tables: Tables, row: Row): AmountUnit[] {
  const v = viewOf(tables)
  return v ? unitsIn(v, row) : []
}

/**
 * The other currency of a conversion recorded for one of a row's amounts (rule X10): the currency the money is really
 * changed into or out of on its way, besides the household's. Null where nothing is changed (a dollar expense paid out
 * of a dollar account, a euro expense from the month's income) and where the amount spans three currencies (data
 * stored before rule X15). `source` is the amount's own, for an expense; `currency` the one it is typed in.
 */
export function conversionCurrency(tables: Tables, row: Row, source: FundedBy = row.defaultFundedBy, currency?: string): string | null {
  const v = viewOf(tables)
  if (!v) return null
  const own = ownEnd(v, row)
  const spends = row.section === 'expense' && !BOOKED_BY_KIND.has(row.kind)
  const from = spends ? sourceEnd(v, source) : null
  const ends = [own, from].filter((e): e is AmountEnd => e != null)
  // the current accounts are in the household's currency: every amount goes through them, except an expense paid
  // out of an account
  const viaCurrent = !(spends && from != null)
  const on = new Set([currency ?? currencyOf(v, row), ...ends.map((e) => e.account.currency), ...(viaCurrent ? [v.home] : [])])
  if (on.size !== 2 || !on.has(v.home)) return null
  return [...on].find((c) => c !== v.home) ?? null
}

/** The currencies an amount involves: its own, the household's, and those of the accounts at its ends. */
export function unitCurrencies(unit: AmountUnit, home: string): Set<string> {
  return new Set([home, unit.currency, ...unit.ends.map((e) => e.account.currency)])
}

/**
 * Why the change from `before` to `after` would make an amount of one of `rowIds` count across three currencies, or
 * null. Only what the change brings in is refused: an amount that already counted across three currencies before it,
 * from data stored before the rule, keeps counting as it did, and a change that adds no new currency to it passes.
 * The sentence names the two currencies the amount accepts and the account or currency that would be the third.
 */
export function thirdCurrency(before: Tables, after: Tables, rowIds: Iterable<string>): string | null {
  const was = viewOf(before)
  const now = viewOf(after)
  if (!now) return null
  const home = now.home
  for (const id of rowIds) {
    const row = now.rows.get(id)
    if (!row || row.archivedMonth) continue
    const old = was?.rows.get(id)
    const oldUnits = old && was ? unitsIn(was, old) : []
    const oldSets = new Map(oldUnits.map((u) => [u.key, unitCurrencies(u, home)]))
    for (const unit of unitsIn(now, row)) {
      const all = unitCurrencies(unit, home)
      if (all.size <= 2) continue
      // the same amount counted across these currencies before the change: data from before the rule
      const known = oldSets.get(unit.key)
      if (known && [...all].every((c) => known.has(c))) continue
      return reasonFor(now, was, row, unit, { currency: old && was ? currencyOf(was, old) : null, ends: new Set(oldUnits.flatMap((u) => u.ends.map(endKey))) })
    }
  }
  return null
}

const endKey = (e: AmountEnd) => `${e.account.id}|${e.way}`

/** What the row's amounts were before the change: their currency, and the account ends they had. */
interface Before {
  currency: string | null
  ends: Set<string>
}

function reasonFor(now: View, was: View | null, row: Row, unit: AmountUnit, before: Before): string {
  const home = now.home
  const say = txt.engine.thirdCurrency
  const accountMoved = (e: AmountEnd) => {
    const then = was?.accounts.get(e.account.id)
    return then != null && then.currency !== e.account.currency
  }
  const isNew = (e: AmountEnd) => accountMoved(e) || !before.ends.has(endKey(e))
  const currencyMoved = before.currency != null && before.currency !== unit.currency
  const followed = row.followsRowId && !now.ruled.has(row.id) ? now.rows.get(row.followsRowId) : undefined
  if (unit.currency !== home) {
    const foreignEnds = unit.ends.filter((e) => e.account.currency !== unit.currency && e.account.currency !== home)
    const e = foreignEnds.find(accountMoved) ?? foreignEnds.find(isNew) ?? foreignEnds[0]
    // the account's own currency is what changed
    if (e && accountMoved(e)) return say.accountMoved({ row: row.name, currency: unit.currency, way: e.way, account: e.account.name, home })
    // the amount's currency is what changed: the account stays, and says which two the amount can be in
    if (e && currencyMoved && !isNew(e)) {
      return followed
        ? say.followedRow({ row: row.name, way: e.way, account: e.account.name, accountCurrency: e.account.currency, home, followed: followed.name, currency: unit.currency })
        : say.amountMoved({ row: row.name, way: e.way, account: e.account.name, accountCurrency: e.account.currency, home })
    }
    if (e) return say.accountNew({ row: row.name, currency: unit.currency, way: e.way, home, account: e.account.name, accountCurrency: e.account.currency })
  }
  // in the household's currency, between accounts in two others: the one that came with the change is the third
  const foreign = unit.ends.filter((x) => x.account.currency !== home)
  const e = foreign.find(accountMoved) ?? foreign.find(isNew) ?? foreign[foreign.length - 1]
  const kept = foreign.find((x) => x.account.currency !== e.account.currency) ?? foreign[0]
  if (accountMoved(e)) return say.betweenMoved({ row: row.name, keptWay: kept.way, kept: kept.account.name, keptCurrency: kept.account.currency, way: e.way, account: e.account.name, home })
  return say.betweenNew({ row: row.name, keptWay: kept.way, kept: kept.account.name, keptCurrency: kept.account.currency, way: e.way, home, account: e.account.name, accountCurrency: e.account.currency })
}
