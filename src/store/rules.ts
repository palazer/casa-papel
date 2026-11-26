import { txt } from '@/i18n'
import { cellKey, computeEngine, sortRows, type EngineOutput } from '@/engine'
import {
  HouseholdSchema, PoolSchema, RowSchema, addMonths, canCarryRule, canTakeRest, compareMonths, isOldPocketShare, isPocketRow, isTakenFromAccount, monthRange, poolRowName,
  resolveRules, rowsFeeding, sharePercent,
  type Cell, type Money, type MonthKey, type Pool, type Row, type RuleState, type Tables,
} from '@/model'
import type { Mutation, Store } from './store'
import { loadTables, newRowMutation, replaceFollowing } from './actions'
import { cellPut, writtenDown, type CellPatch } from './cells'
import { applyMutations } from './impact'

/**
 * What the rule dialog can choose for the transfer that feeds an account, or for an adult's pocket money. Pocket money
 * never takes the rest; only pocket money can be a share of its adult's own income.
 */
export type RuleChoice =
  | { kind: 'fixed'; amount: Money }
  | { kind: 'share-of-income'; share: number }
  | { kind: 'share-of-own-income'; share: number }
  /** A share of one income row's take-home; `rowId` is that income row. */
  | { kind: 'share-of-row'; share: number; rowId: string }
  | { kind: 'share-of-rest'; share: number }
  | { kind: 'rest' }

/** What a rule is set on: a row, or the account or virtual account a row feeds (the row is made when there is none). */
export type RuleTarget = { rowId: string } | { accountId: string } | { poolId: string }

/** The row a rule on `target` sits on, or null when the account or virtual account has no row yet. */
export function ruleRowOf(tables: Tables, target: RuleTarget): Row | null {
  if ('rowId' in target) {
    const row = tables.rows.find((r) => r.id === target.rowId && !r.deletedAt)
    if (!row) throw new Error(txt.errors.rowNotFound)
    return row
  }
  if ('poolId' in target) {
    const pool = tables.pools.find((p) => p.id === target.poolId && !p.deletedAt)
    if (!pool) throw new Error(txt.errors.virtualAccountNoLongerExists)
    if (pool.archivedMonth) throw new Error(txt.errors.archived(pool.name))
    return tables.rows.find((r) => !r.deletedAt && r.id === pool.allocationRowId) ?? null
  }
  const acc = tables.accounts.find((a) => a.id === target.accountId && !a.deletedAt)
  if (!acc) throw new Error(txt.errors.accountNoLongerExists)
  if (acc.archivedMonth) throw new Error(txt.errors.archived(acc.name))
  if (acc.type !== 'savings' && acc.type !== 'investment') throw new Error(txt.errors.notSavingsInvestmentAccountNo(acc.name))
  const feeding = rowsFeeding(tables.rows, acc)
  if (feeding.length > 1) throw new Error(txt.errors.severalRowsFeed(acc.name, feeding.map((r) => r.name)))
  return feeding[0] ?? null
}

/** The transfer row for an account or virtual account that has none, named the way setup names them. */
function makeRuleRow(tables: Tables, target: { accountId: string } | { poolId: string }, ts: number): { row: Row; mutations: Mutation[] } {
  if ('poolId' in target) {
    const pool = tables.pools.find((p) => p.id === target.poolId) as Pool
    const made = newRowMutation(tables, { name: poolRowName(pool.name), section: 'transfer', kind: 'pool-allocation', accountId: pool.accountId, defaultStatus: 'committed' })
    return { row: made.row, mutations: [made.mutation, { op: 'put', table: 'pools', record: PoolSchema.parse({ ...pool, allocationRowId: made.row.id, updatedAt: ts }) }] }
  }
  const acc = tables.accounts.find((a) => a.id === target.accountId)!
  const made = newRowMutation(tables, { name: `To ${acc.name}`, section: 'transfer', kind: acc.type === 'savings' ? 'to-savings' : 'to-investment', accountId: acc.id, defaultStatus: 'committed' })
  return { row: made.row, mutations: [made.mutation] }
}

/**
 * Everything that gives the transfer behind `target` a rule from `from` on, as one set of mutations. Pure; the caller
 * commits, and the rule dialog runs it on a copy to show what the rule would give.
 *
 * A rule has no start month of its own. Instead a month with a typed amount shows that amount (see the engine), so:
 * the months before `from` get what they showed written down, the typed amounts from `from` on are cleared, and the
 * rule fills what is left open. Moving the rest does the same for the row that had it, which then gets nothing until
 * it has a rule of its own; `closingRule` follows (the rest is taken, or it stays in the main account). Any account a
 * rule can feed may take the rest, one at a time.
 */
export function ruleMutations(tables: Tables, target: RuleTarget, choice: RuleChoice, from: MonthKey, ts: number = Date.now()): { row: Row; mutations: Mutation[] } {
  const household = tables.household.find((h) => !h.deletedAt)
  if (!household) throw new Error(txt.errors.noHouseholdYet)
  if (choice.kind === 'fixed') {
    if (!Number.isFinite(choice.amount) || choice.amount < 0) throw new Error(txt.errors.amountCannotBelowZero)
  } else if (choice.kind !== 'rest' && !(choice.share > 0 && choice.share <= 1)) {
    throw new Error(txt.errors.percentageMustAboveMost)
  }
  if (compareMonths(from, household.startMonth) < 0) throw new Error(txt.errors.householdStartsRuleCannotStart(household.startMonth))

  const mutations: Mutation[] = []
  let working = tables
  let found = ruleRowOf(tables, target)
  if (!found) {
    const made = makeRuleRow(tables, target as { accountId: string } | { poolId: string }, ts)
    found = made.row
    mutations.push(...made.mutations)
    working = applyMutations(tables, made.mutations)
  }
  const row = found
  if (!canCarryRule(row)) throw new Error(txt.errors.cannotRuleOnlyPocketMoney(row.name))
  if (choice.kind === 'rest' && !canTakeRest(row)) throw new Error(txt.errors.pocketMoneyCannotTakeRest)
  if (choice.kind === 'share-of-own-income') {
    if (!isPocketRow(row)) throw new Error(txt.errors.onlyPocketMoneyPercentageAdult(row.name))
    const adult = tables.entities.find((e) => e.id === row.scope && !e.deletedAt && e.kind === 'adult')
    if (!adult) throw new Error(txt.errors.doesNotBelongAdultSay(row.name))
  }
  if (choice.kind === 'share-of-row') {
    const of = working.rows.find((r) => r.id === choice.rowId && !r.deletedAt)
    if (!of) throw new Error(txt.errors.pickIncomePercentageTaken)
    if (of.section !== 'income' || isTakenFromAccount(of)) throw new Error(txt.errors.notIncomeLineThereNothing(of.name))
    if (of.archivedMonth && compareMonths(of.archivedMonth, from) <= 0) throw new Error(txt.errors.archivedPickIncomeStillComing(of.name, from))
  }

  const liveRows = sortRows(working.rows.filter((r) => !r.deletedAt), working.categories)
  const before = resolveRules(liveRows, household.closingRule)
  const wasRest = before.restRowId === row.id
  if (choice.kind === 'rest' && wasRest) return { row, mutations }
  if (choice.kind === 'share-of-rest') {
    const others = liveRows.filter((r) => r.id !== row.id && before.byRow.get(r.id)?.kind === 'share-of-rest')
    const total = others.reduce((sum, r) => sum + (before.byRow.get(r.id)?.share ?? 0), 0) + choice.share
    if (total > 1.000001) {
      throw new Error(txt.errors.sharesOfRestOver(others.map((r) => r.name), sharePercent(total)))
    }
  }

  // what every month before the start shows now
  const months = compareMonths(household.startMonth, from) < 0 ? monthRange(household.startMonth, addMonths(from, -1)) : []
  const engine: EngineOutput | null = months.length ? computeEngine({ tables: working, months }) : null
  /** Write a month of a row: what is stored for it, with `patch` on top (`cellRecord`). */
  const put = (cur: Cell | undefined, patch: CellPatch): void => { mutations.push(cellPut(cur, patch, ts)) }
  const rowPatches = new Map<string, Partial<Row>>()

  /**
   * Hand a row over to a rule (`then` = 'rule') or to a typed amount from `from` on: the months before keep what they
   * showed, the typed amounts from `from` on go.
   */
  const rework = (r: Row, was: RuleState | undefined, then: 'rule' | { amount: Money }): void => {
    const stored = new Map(working.cells.filter((c) => c.rowId === r.id).map((c) => [c.month, c]))
    // a typed row that stays typed keeps its earlier months by itself: nothing before `from` reads the new amount.
    // Pocket money that was a share of the pocket total is not typed: its months are written down like a rule's.
    const staysTyped = !was && !r.followsRowId && !isOldPocketShare(r) && then !== 'rule'
    if (!staysTyped && engine) {
      for (const m of months) {
        const c = engine.cells[cellKey(r.id, m)]
        if (!c || c.source === 'archived' || c.source === 'value' || c.source === 'items') continue
        const cur = stored.get(m)
        const currencyOverride = c.currency === (r.currency ?? household.baseCurrency) ? null : c.currency
        // what the month showed, written down as an amount of the usual kind: whatever its record said before was not
        // read. An automatic amount ticked as moved keeps its tick, a share of a recorded conversion stays recorded.
        put(cur, { rowId: r.id, month: m, ...writtenDown(c, r.defaultFundedBy, r.defaultStatus), currencyOverride, once: false })
      }
    }
    if (then === 'rule') {
      for (const cur of stored.values()) {
        if (compareMonths(cur.month, from) < 0 || cur.mode === 'inherit') continue
        // a month whose typed amount was ticked as done stays ticked when the rule fills it
        const live = cur.items.filter((i) => !i.skipped)
        const ticked = cur.mode === 'items' && live.length > 0 && live.every((i) => i.status === 'done')
        put(cur, { rowId: r.id, month: cur.month, mode: 'inherit', value: null, items: [], markedDone: ticked || (cur.markedDone ?? false) })
      }
    } else {
      // a typed amount from `from` on is "this and following months": what the later months held goes, and a month
      // in which something is ticked as done keeps what it shows
      mutations.push(...replaceFollowing(working, r.id, from, then.amount, ts).mutations)
      const cur = stored.get(from)
      put(cur, { rowId: r.id, month: from, mode: 'value', value: then.amount, items: [], currencyOverride: null, markedDone: false, once: false })
    }
  }

  rework(row, before.byRow.get(row.id), choice.kind === 'fixed' ? { amount: choice.amount } : 'rule')
  rowPatches.set(row.id, {
    rule: choice.kind, ruleShare: 'share' in choice ? choice.share : null,
    // only a share of one income names a row; any other rule lets go of it
    ruleRowId: choice.kind === 'share-of-row' ? choice.rowId : null,
    followsRowId: null, followShare: null,
    // pocket money with a rule of its own no longer reads the household's pocket total
    ...(isPocketRow(row) ? { pocketMode: 'fixed' as const, pocketShare: null } : {}),
  })

  let closingRule = household.closingRule
  if (choice.kind === 'rest') {
    const oldRest = before.restRowId ? liveRows.find((r) => r.id === before.restRowId) : undefined
    if (oldRest) {
      // the account that had the rest gets nothing more until it has a rule of its own
      rework(oldRest, before.byRow.get(oldRest.id), { amount: 0 })
      rowPatches.set(oldRest.id, { rule: 'fixed', ruleShare: null })
    }
    if (closingRule !== 'savings-plug') {
      closingRule = 'savings-plug'
      // the rows that were typed until now stay so: without this a "to savings" row would read as idle, and a row
      // someone once set to take the rest would take it again
      for (const r of liveRows) {
        if (r.id === row.id) continue
        if ((r.kind === 'to-savings' && (r.rule ?? null) === null) || (canTakeRest(r) && r.rule === 'rest')) rowPatches.set(r.id, { rule: 'fixed', ruleShare: null })
      }
    }
  } else if (wasRest) {
    // no account takes the rest any more: it stays in the main account
    closingRule = 'leftover-plug'
    // the idle rows beside the rest row showed zero in every month; typed now, they keep showing it
    for (const r of liveRows) {
      if (before.byRow.get(r.id)?.kind !== 'idle') continue
      for (const cur of working.cells) if (cur.rowId === r.id && cur.mode !== 'inherit') put(cur, { rowId: r.id, month: cur.month, mode: 'inherit', value: null, items: [] })
      rowPatches.set(r.id, { rule: 'fixed', ruleShare: null })
    }
  }

  let updated = row
  for (const [id, patch] of rowPatches) {
    const r = liveRows.find((x) => x.id === id)
    if (!r) continue
    const next = RowSchema.parse({ ...r, ...patch, updatedAt: ts })
    mutations.push({ op: 'put', table: 'rows', record: next })
    if (id === row.id) updated = next
  }
  if (closingRule !== household.closingRule) mutations.push({ op: 'put', table: 'household', record: HouseholdSchema.parse({ ...household, closingRule, updatedAt: ts }) })
  return { row: updated, mutations }
}

/** Give the transfer behind `target` a rule from `from` on; one undoable step. Returns the row the rule sits on. */
export async function setRule(store: Store, target: RuleTarget, choice: RuleChoice, from: MonthKey): Promise<Row> {
  const { row, mutations } = ruleMutations(await loadTables(store), target, choice, from)
  if (mutations.length) await store.commit(mutations)
  return row
}

/** What the months would show with the rule, without saving anything: the engine run on a copy. Throws what saving would throw. */
export function previewRule(tables: Tables, target: RuleTarget, choice: RuleChoice, from: MonthKey, months: MonthKey[]): { row: Row; engine: EngineOutput } {
  const { row, mutations } = ruleMutations(tables, target, choice, from)
  return { row, engine: computeEngine({ tables: applyMutations(tables, mutations), months }) }
}
