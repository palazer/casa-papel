/**
 * What an account held when a month began and when it ended. The two are one number per moment: the start of a month
 * is the end of the month before (`AccountMonth.actualBalance` of that month), or the account's opening amount in its
 * first month. A number that is stored is real; without one the engine works the amount out and carries it on.
 *
 * Every balance dialog writes through here. "Balances…" can tick every line of the month in the same step
 * (`opts.done`).
 */
import { txt } from '@/i18n'
import { mainAccountsIn, type AccountMonthResult, type EngineOutput, type MainAccountMonth } from '@/engine'
import {
  AccountMonthSchema, AccountSchema, accountGroup, addMonths, compareMonths,
  type Account, type AccountGroup, type Household, type Money, type MonthKey, type Tables,
} from '@/model'
import { countDoneMutations, engineFor, loadTables } from './actions'
import { applyMutations } from './impact'
import { NO_QUESTION, type Mutation, type Store } from './store'

/**
 * What was typed into a month's balance fields, per account id and in the account's own currency. A number is a real
 * balance, `null` goes back to the calculated amount, and an account that is left out keeps what it has.
 */
export interface BalanceEntry {
  /** What the account held when the month began: the end of the month before, or its opening amount in its first month. */
  starts?: Record<string, Money | null>
  /** What it held when the month ended. */
  ends?: Record<string, Money | null>
}

/** One account in a month's list of balances. */
export interface BalanceLine {
  account: Account
  /** The heading it stands under, as on the Statement. */
  group: AccountGroup
  /** The account has no earlier month: its start is its opening amount, which is always a real number. */
  opening: boolean
  /** The real start that is stored (the opening amount, or the real end of the month before); null while it is calculated. */
  startStored: Money | null
  /** What the start comes to with nothing stored; null when the plan does not know it for this account alone. */
  startCalculated: Money | null
  /** The real end that is stored; null while it is calculated. */
  endStored: Money | null
  /** What the end comes to with nothing stored; null when the plan does not know it for this account alone. */
  endCalculated: Money | null
  /** The engine's month for the account. The main account has none of its own: see `MonthBalances.main`. */
  result?: AccountMonthResult
}

export interface MonthBalances {
  /** Every account with a balance in the month: the main account, then savings, investments, other assets and debts. */
  lines: BalanceLine[]
  /** The main account's month, in the household currency (the main accounts together, where an old one was replaced in it). */
  main?: MainAccountMonth
}

/** In a month where an archived main account and the one that replaced it were both open, the line is the two together (rule B9). */
export const FILL_EVERY_MAIN = txt.errors.bothMainAccountsOpenMonth

const GROUP_ORDER: AccountGroup[] = ['current', 'savings', 'investment', 'other', 'debt']
const byOrder = (a: Account, b: Account) => (a.order < b.order ? -1 : a.order > b.order ? 1 : 0)
const storedActual = (tables: Tables, accountId: string, month: MonthKey): Money | null =>
  tables.accountMonths.find((a) => a.accountId === accountId && a.month === month)?.actualBalance ?? null

/** Whether an account's start in the month after `prev` is its opening amount: there is no earlier month to end on. */
function startsOnOpening(engine: EngineOutput, acc: Account, prev: MonthKey): boolean {
  if (accountGroup(acc) === 'current') return !(engine.main?.months[prev] && compareMonths(acc.openingMonth, prev) <= 0)
  return !engine.accounts[acc.id]?.months[prev]
}

/** The accounts of a month with what is stored and what is calculated for its start and its end. `engine` must cover the month and the one before. */
export function monthBalances(tables: Tables, engine: EngineOutput, month: MonthKey): MonthBalances {
  const prev = addMonths(month, -1)
  const base = tables.household.find((h) => !h.deletedAt)?.baseCurrency
  const main = engine.main?.months[month]
  const lines: BalanceLine[] = []
  const current = mainAccountsIn(tables.accounts, month)
  for (const acc of current) {
    const opening = startsOnOpening(engine, acc, prev)
    // the plan knows the main account in the household currency, and two that were open together only together
    const alone = current.length === 1 && acc.currency === base ? main : undefined
    lines.push({
      account: acc, group: 'current', opening,
      startStored: opening ? acc.openingBalance : storedActual(tables, acc.id, prev), startCalculated: alone?.start ?? null,
      endStored: storedActual(tables, acc.id, month), endCalculated: alone?.computed ?? null,
    })
  }
  for (const acc of tables.accounts.filter((a) => !a.deletedAt).sort(byOrder)) {
    const result = engine.accounts[acc.id]?.months[month]
    if (!result) continue
    const opening = startsOnOpening(engine, acc, prev)
    lines.push({
      account: acc, group: accountGroup(acc), opening, result,
      startStored: opening ? acc.openingBalance : storedActual(tables, acc.id, prev), startCalculated: result.start,
      endStored: storedActual(tables, acc.id, month), endCalculated: result.computed,
    })
  }
  // a stable sort: under each heading the accounts keep their own order
  lines.sort((a, b) => GROUP_ORDER.indexOf(a.group) - GROUP_ORDER.indexOf(b.group))
  return { lines, main }
}

/** Store (or clear) one real balance; nothing when it already reads so. */
function actualMutations(tables: Tables, accountId: string, month: MonthKey, actualBalance: Money | null, ts: number): Mutation[] {
  const existing = tables.accountMonths.find((a) => a.accountId === accountId && a.month === month)
  if ((existing?.actualBalance ?? null) === actualBalance) return []
  return [{ op: 'put', table: 'accountMonths', record: AccountMonthSchema.parse({ ...existing, accountId, month, actualBalance, updatedAt: ts }) }]
}

/**
 * What typed starts write: the real end of the month before, or the opening amount of an account that has no earlier
 * month. With `strict` an opening amount cannot be emptied (it is never calculated); a preview skips it instead.
 */
function startMutations(tables: Tables, engine: EngineOutput, month: MonthKey, starts: Record<string, Money | null>, ts: number, strict: boolean): Mutation[] {
  const prev = addMonths(month, -1)
  const out: Mutation[] = []
  for (const [id, value] of Object.entries(starts)) {
    const acc = tables.accounts.find((a) => a.id === id && !a.deletedAt)
    if (!acc) continue
    if (!startsOnOpening(engine, acc, prev)) {
      out.push(...actualMutations(tables, id, prev, value, ts))
      continue
    }
    if (value == null) {
      if (strict) throw new Error(txt.errors.noEarlierMonthStartingAmount(acc.name))
      continue
    }
    if (acc.openingBalance !== value) out.push({ op: 'put', table: 'accounts', record: AccountSchema.parse({ ...acc, openingBalance: value, updatedAt: ts }) })
  }
  return out
}

/**
 * The main account of a month counts as entered when it has a real balance. In a month where an archived one and the
 * one that replaced it were both open, both need one, because the plan knows them together. `listed` are the
 * accounts the month being edited shows: one that is missing from it (still open in the month before, archived since)
 * is named, as it cannot be filled in from there.
 */
function assertAllOrNone(tables: Tables, month: MonthKey, listed: ReadonlySet<string>): void {
  const open = mainAccountsIn(tables.accounts, month)
  const missing = open.filter((a) => storedActual(tables, a.id, month) == null)
  if (missing.length === 0 || missing.length === open.length) return
  const elsewhere = missing.find((a) => !listed.has(a.id))
  throw new Error(elsewhere
    ? txt.errors.stillOpenNoRealBalance(elsewhere.name, month)
    : FILL_EVERY_MAIN)
}

/**
 * Everything a month's typed balances write, in order: the starts first. Pure. A start is the end of the month before, so typing it corrects
 * that month too: it says what the account really held and leaves that month's rows alone.
 */
export function monthBalanceMutations(tables: Tables, household: Household, month: MonthKey, entry: BalanceEntry): Mutation[] {
  const starts = entry.starts ?? {}
  const ends = entry.ends ?? {}
  const touched = [...Object.keys(starts), ...Object.keys(ends)]
  if (touched.length === 0) return []
  for (const v of [...Object.values(starts), ...Object.values(ends)]) if (v != null && !Number.isFinite(v)) throw new Error(txt.errors.notNumberIRead)
  const ts = Date.now()
  const prev = addMonths(month, -1)
  const engine = engineFor(tables, household, month)
  const lines = new Map(monthBalances(tables, engine, month).lines.map((l) => [l.account.id, l]))
  const listed = new Set(lines.keys())
  for (const id of touched) if (!lines.has(id)) throw new Error(txt.errors.accountNoBalance(month))
  const isCurrent = (id: string) => lines.get(id)!.group === 'current'

  const first = startMutations(tables, engine, month, starts, ts, true)
  let work = applyMutations(tables, first)
  if (Object.keys(starts).some((id) => isCurrent(id) && !lines.get(id)!.opening)) assertAllOrNone(work, prev, listed)

  const second: Mutation[] = []
  for (const [id, value] of Object.entries(ends)) {
    const made = actualMutations(work, id, month, value, ts)
    second.push(...made)
    work = applyMutations(work, made)
  }
  if (Object.keys(ends).some(isCurrent)) assertAllOrNone(work, month, listed)
  return [...first, ...second]
}

/**
 * The month's balances as they would read with `starts` typed, so the calculated end follows a start at once: what
 * an empty end field shows is what it will give. Checks nothing and writes nothing.
 */
export function previewMonthBalances(tables: Tables, household: Household, month: MonthKey, starts: Record<string, Money | null> = {}): MonthBalances {
  const engine = engineFor(tables, household, month)
  const typed = startMutations(tables, engine, month, starts, Date.now(), false)
  if (typed.length === 0) return monthBalances(tables, engine, month)
  const after = applyMutations(tables, typed)
  return monthBalances(after, engineFor(after, household, month), month)
}

/**
 * Save a month's typed balances. With `done`, every line of the month is ticked as done in the same step ("Count
 * everything in <Month> as done"), as the month reads with those balances. One undoable step.
 */
export async function setMonthBalances(store: Store, month: MonthKey, entry: BalanceEntry, opts: { done?: boolean } = {}): Promise<void> {
  const tables = await loadTables(store)
  const household = tables.household.find((h) => !h.deletedAt)
  if (!household) throw new Error(txt.errors.noHouseholdYet)
  const mutations = monthBalanceMutations(tables, household, month, entry)
  if (opts.done) {
    const after = mutations.length ? applyMutations(tables, mutations) : tables
    mutations.push(...countDoneMutations(after, engineFor(after, household, month), month, Date.now()))
  }
  if (mutations.length) await store.commit(mutations, NO_QUESTION)
}
