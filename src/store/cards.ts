/**
 * Credit cards from before schema 23, put right by the app itself.
 *
 * A card is a debt that its payment row brings down, like a loan (rule C1), and nothing is bought on a card: what is
 * paid with one is an expense like any other, and a payment method says that it was the card. Before that a card had a
 * mode. Either every purchase was an expense row that named the card and raised what was owed, with a payment row
 * under Transfers that only moved money; or only the payments were rows, and what was owed moved with real balances
 * alone. Data of that shape can be on the device, arrive from another one, or come in with a file, so the pass goes by
 * what it finds and not by a mark that it ran.
 */
import { AccountSchema, RecurringItemSchema, RowSchema, isPayOffRow, type Account, type Row, type Tables } from '@/model'
import { accountTypeForRow, loadTables, payOffKindOf, payOffPatches } from './actions'
import type { Mutation, Store } from './store'

/** A record the app changed by itself keeps its stamp, plus one: it is no edit of anyone's, and must not overrule one made elsewhere since. */
const stamp = <T extends { updatedAt: number }>(record: T): T => ({ ...record, updatedAt: record.updatedAt + 1 })

/**
 * What the app does by itself with a household's cards (`App.tsx`, after the first sync; the file check; the scenario
 * world when it settles). Pure, and the same on every device, so two that run it agree; a second run on its own
 * result writes nothing. It asks nothing, and changes months that are over: the rule itself changed for them.
 *
 * - **A row that pays a loan or a card off and stands under Transfers** moves under Expenses, to the end of the rows
 *   without a category, and loses the category it had there. Such rows keep the order they had among themselves, and a
 *   row stored with the kind of the other debt takes its account's (`payOffPatches`). Archived rows too: they count in
 *   the months before they were archived.
 * - **An expense row, or a schedule, that names a card** as what it was bought on loses that link. Its amounts come
 *   out of the main account, as every expense's do.
 * - **A card that recorded only its payments, opened owing nothing and never had a real balance typed** stops being
 *   tracked. Its payment was the month's spending and nothing was owed on it, and a payment to a tracked card stops at
 *   what is owed, so it would count as nothing; untracked, it counts as it did.
 * - **Every card loses its mode** in the same write, so the rule above reads a card once: one that is tracked again
 *   later, or whose only real balance is cleared, stays as its owner left it.
 */
export function planCards(tables: Tables): Mutation[] {
  const accounts = new Map(tables.accounts.filter((a) => !a.deletedAt).map((a) => [a.id, a]))
  const debtOf = (id: string | null): Account | undefined => {
    const acc = id ? accounts.get(id) : undefined
    return acc && (acc.type === 'loan' || acc.type === 'credit-card') ? acc : undefined
  }
  const isCard = (id: string | null): boolean => debtOf(id)?.type === 'credit-card'
  const out: Mutation[] = []

  const rows = tables.rows.filter((r) => !r.deletedAt)
  // one call for every row that moves, so two cards' rows do not land on the same place in the order
  const kindOf = (r: Row): Row['kind'] => { const acc = debtOf(r.accountId); return acc ? payOffKindOf(acc) : r.kind }
  const patches = payOffPatches(tables, rows.filter(isPayOffRow), kindOf)
  for (const r of rows) {
    const patch = patches.get(r.id)
    if (patch) out.push({ op: 'put', table: 'rows', record: RowSchema.parse(stamp({ ...r, ...patch })) })
    else if (r.section === 'expense' && accountTypeForRow(r) == null && isCard(r.accountId)) out.push({ op: 'put', table: 'rows', record: RowSchema.parse(stamp({ ...r, accountId: null })) })
  }
  for (const s of tables.recurringItems) {
    if (!s.deletedAt && isCard(s.accountId)) out.push({ op: 'put', table: 'recurringItems', record: RecurringItemSchema.parse(stamp({ ...s, accountId: null })) })
  }

  const typed = new Set(tables.accountMonths.filter((m) => m.actualBalance != null).map((m) => m.accountId))
  for (const a of accounts.values()) {
    if (a.type !== 'credit-card' || a.card == null) continue
    const onlyTheBill = a.card.cardMode === 'lump' && a.tracked && (a.openingBalance ?? 0) === 0 && !typed.has(a.id)
    out.push({ op: 'put', table: 'accounts', record: AccountSchema.parse(stamp({ ...a, card: undefined, tracked: onlyTheBill ? false : a.tracked })) })
  }
  return out
}

/** `planCards` as a system commit (not undoable). Returns how many records it wrote. */
export async function keepCards(store: Store): Promise<number> {
  const mutations = planCards(await loadTables(store))
  if (mutations.length) await store.commitSystem(mutations)
  return mutations.length
}
