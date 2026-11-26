/**
 * Rule B9 in the store: a household has one main account open at a time, in its own currency. It is the account of
 * type `checking` ("Main account" in the form), and the month's money runs through it. Any other everyday account is
 * an other current account (type `joint`): it has a balance of its own, money is moved to it with a transfer row, and
 * expenses can come out of it. A main account that was archived stays one, as the history of the line: its money
 * stays there (`engine/mainAccount.ts`).
 */
import { txt } from '@/i18n'
import { AccountSchema, HouseholdSchema, accountRef, compareMonths, movesInto, pocketLandsIn, type Account, type Tables } from '@/model'
import { loadTables } from './actions'
import { quoteNames } from './impact'
import { NO_QUESTION, type Mutation, type Store } from './store'

const isCurrent = (a: Account) => a.type === 'checking' || a.type === 'joint'
const byOrder = (a: Account, b: Account) => (a.order < b.order ? -1 : a.order > b.order ? 1 : 0)

/**
 * The main account the upgrade picks among `candidates`: a "current account" before a "joint account" (what the
 * household called them before rule B9), then the one open from the earliest month, then the household's order, then
 * the id, so every device picks the same.
 */
function pickMain(candidates: Account[]): Account | null {
  return [...candidates].sort((a, b) =>
    (a.type === 'checking' ? 0 : 1) - (b.type === 'checking' ? 0 : 1)
    || compareMonths(a.openingMonth, b.openingMonth)
    || byOrder(a, b)
    || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))[0] ?? null
}

/** A converted account keeps its stamp, plus one: it is no edit of anyone's, and must not overrule one made elsewhere since. */
const retyped = (a: Account, type: Account['type']): Mutation =>
  ({ op: 'put', table: 'accounts', record: AccountSchema.parse({ ...a, type, updatedAt: a.updatedAt + 1 }) })

/**
 * What the app does by itself with a household's accounts under rule B9 (`App.tsx`, after the first sync; the
 * scenario world when it settles). Pure, and the same on every device, so two that run it agree; a second run on its
 * own result writes nothing.
 *
 * - **Data from before the rule** (`Household.askMainAccount` unset): every current and joint account was counted
 *   together then. An archived one becomes a main account, so its money stays in the line as it did. Of the open ones,
 *   the one in the household's currency that `pickMain` picks is the main account, and every other one is an other
 *   current account, with a balance of its own: what it held at the start and the real balances typed for it. Net
 *   worth stays what it was, but for an account in another currency, now worth what each month's rate makes of it
 *   (rule X6). With two or more open ones the household is marked to be asked which is the main account
 *   (`setMainAccount`); otherwise it is marked done.
 * - **Whatever the mark**: a second open main account, or one in another currency (written by an older app before it
 *   reloaded, or brought in from an older file), becomes an other current account, without asking again.
 */
export function planMainAccount(tables: Tables): Mutation[] {
  const household = tables.household.find((h) => !h.deletedAt)
  if (!household) return []
  const base = household.baseCurrency
  const live = tables.accounts.filter((a) => !a.deletedAt)
  const out: Mutation[] = []
  if (household.askMainAccount == null) {
    for (const a of live) if (a.archivedMonth && a.type === 'joint') out.push(retyped(a, 'checking'))
    const current = live.filter((a) => !a.archivedMonth && isCurrent(a))
    const main = pickMain(current.filter((a) => a.currency === base))
    for (const a of current) {
      const type = a.id === main?.id ? 'checking' : 'joint'
      if (a.type !== type) out.push(retyped(a, type))
    }
    out.push({ op: 'put', table: 'household', record: HouseholdSchema.parse({ ...household, askMainAccount: current.length >= 2, updatedAt: household.updatedAt + 1 }) })
    return out
  }
  const mains = live.filter((a) => !a.archivedMonth && a.type === 'checking')
  const main = pickMain(mains.filter((a) => a.currency === base))
  for (const a of mains) if (a.id !== main?.id) out.push(retyped(a, 'joint'))
  return out
}

/** `planMainAccount` as a system commit (not undoable). Returns how many records it wrote. */
export async function keepMainAccount(store: Store): Promise<number> {
  const mutations = planMainAccount(await loadTables(store))
  if (mutations.length) await store.commitSystem(mutations)
  return mutations.length
}

/** What the question after the upgrade offers: the open current accounts, those that can be the main account first. */
export interface MainAccountChoice {
  /** In the household's currency, in the household's order: one of them is the main account. */
  eligible: Account[]
  /** In another currency: other current accounts, whatever is chosen. */
  foreign: Account[]
  /** The main account now (the upgrade's pick, or the one chosen since). */
  mainId: string | null
}

export function mainAccountChoice(tables: Tables): MainAccountChoice {
  const household = tables.household.find((h) => !h.deletedAt)
  const base = household?.baseCurrency
  const current = tables.accounts.filter((a) => !a.deletedAt && !a.archivedMonth && isCurrent(a)).sort(byOrder)
  return {
    eligible: current.filter((a) => a.currency === base),
    foreign: current.filter((a) => a.currency !== base),
    mainId: current.find((a) => a.type === 'checking' && a.currency === base)?.id ?? null,
  }
}

/**
 * The answer to "Which is your main account?": `id` becomes the main account and every other open current account in
 * the household's currency an other current account; null keeps them as they are. The mark goes either way. It asks
 * nothing about the past (rule T4): the question already said what changes.
 */
export async function setMainAccount(store: Store, id: string | null): Promise<void> {
  const tables = await loadTables(store)
  const household = tables.household.find((h) => !h.deletedAt)
  if (!household) throw new Error(txt.errors.noHouseholdYet)
  const { eligible } = mainAccountChoice(tables)
  if (id != null && !eligible.some((a) => a.id === id)) throw new Error(txt.errors.mainAccountEverydayAccountHousehold(household.baseCurrency))
  const ts = Date.now()
  const out: Mutation[] = []
  if (id != null) {
    for (const a of eligible) {
      const type = a.id === id ? 'checking' : 'joint'
      if (a.type !== type) out.push({ op: 'put', table: 'accounts', record: AccountSchema.parse({ ...a, type, updatedAt: ts }) })
    }
  }
  if (household.askMainAccount !== false) out.push({ op: 'put', table: 'household', record: HouseholdSchema.parse({ ...household, askMainAccount: false, updatedAt: ts }) })
  if (out.length) await store.commit(out, NO_QUESTION)
}

/**
 * Why saving `next` would break rule B9, or null. `before` is the account as it is stored, for a change. An archived
 * or deleted main account is history and is never refused; the refusals are for one that is open:
 *
 * - a second one beside the open main account;
 * - one in another currency than the household's;
 * - an account that rows move money into or take money out of, made the main account: the main account is the
 *   month's money itself, so that money would leave the plan without a word.
 */
export function mainAccountRefusal(tables: Tables, next: Account, before?: Account): string | null {
  if (next.type !== 'checking' || next.deletedAt || next.archivedMonth) return null
  const base = tables.household.find((h) => !h.deletedAt)?.baseCurrency
  if (base && next.currency !== base) return txt.errors.mainAccountHouseholdSCurrency(base, next.currency)
  const other = tables.accounts.find((a) => a.id !== next.id && !a.deletedAt && !a.archivedMonth && a.type === 'checking')
  if (other) return txt.errors.wouldSecondMainAccountHousehold(next.name, other.name)
  if (before && before.type !== 'checking') {
    const ref = accountRef(before.id)
    const takes = new Set(tables.cells.filter((c) => c.items.some((i) => i.fundedBy === ref)).map((c) => c.rowId))
    const named = [
      ...tables.rows.filter((r) => !r.deletedAt && !r.archivedMonth && (movesInto(r, before) || pocketLandsIn(r, before) || r.defaultFundedBy === ref || takes.has(r.id))).map((r) => r.name),
      ...tables.recurringItems.filter((s) => !s.deletedAt && s.fundedBy === ref).map((s) => s.name),
    ]
    const names = [...new Set(named)]
    if (names.length) {
      const one = names.length === 1
      return txt.errors.mainAccountMovesMoney(quoteNames(names), one, before.name)
    }
  }
  return null
}

/** `mainAccountRefusal` as a refusal. */
export function assertMainAccount(tables: Tables, next: Account, before?: Account): void {
  const reason = mainAccountRefusal(tables, next, before)
  if (reason) throw new Error(reason)
}
