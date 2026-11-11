import { cellKey, computeEngine, sortRows, type EngineOutput } from '@/engine'
import {
  CellSchema, HouseholdSchema, PoolSchema, RowSchema, addMonths, canCarryRule, canTakeRest, compareMonths, isOldPocketShare, isPocketRow, monthRange, newId,
  resolveRules, rowsFeeding, sharePercent,
  type Cell, type CellItem, type Money, type MonthKey, type Pool, type Row, type RuleState, type Tables,
} from '@/model'
import type { Mutation, Store } from './store'
import { loadTables, newRowMutation } from './actions'
import { applyMutations } from './impact'

/**
 * What the rule dialog can choose for the transfer that feeds an account, or for an adult's pocket money. Pocket money
 * never takes the rest; only pocket money can be a share of its adult's own income.
 */
export type RuleChoice =
  | { kind: 'fixed'; amount: Money }
  | { kind: 'share-of-income'; share: number }
  | { kind: 'share-of-own-income'; share: number }
  | { kind: 'share-of-rest'; share: number }
  | { kind: 'rest' }

/** What a rule is set on: a row, or the account or pool account a row feeds (the row is made when there is none). */
export type RuleTarget = { rowId: string } | { accountId: string } | { poolId: string }

/** The row a rule on `target` sits on, or null when the account or pool account has no row yet. */
export function ruleRowOf(tables: Tables, target: RuleTarget): Row | null {
  if ('rowId' in target) {
    const row = tables.rows.find((r) => r.id === target.rowId && !r.deletedAt)
    if (!row) throw new Error('Row not found')
    return row
  }
  if ('poolId' in target) {
    const pool = tables.pools.find((p) => p.id === target.poolId && !p.deletedAt)
    if (!pool) throw new Error('That pool account no longer exists.')
    if (pool.archivedMonth) throw new Error(`"${pool.name}" is archived.`)
    return tables.rows.find((r) => !r.deletedAt && r.id === pool.allocationRowId) ?? null
  }
  const acc = tables.accounts.find((a) => a.id === target.accountId && !a.deletedAt)
  if (!acc) throw new Error('That account no longer exists.')
  if (acc.archivedMonth) throw new Error(`"${acc.name}" is archived.`)
  if (acc.type !== 'savings' && acc.type !== 'investment') throw new Error(`"${acc.name}" is not a savings or an investment account, so no rule moves money to it.`)
  const feeding = rowsFeeding(tables.rows, acc)
  if (feeding.length > 1) throw new Error(`Several rows move money to "${acc.name}": ${feeding.map((r) => r.name).join(', ')}. Set the rule on one of them.`)
  return feeding[0] ?? null
}

/** The transfer row for an account or pool account that has none, named the way setup names them. */
function makeRuleRow(tables: Tables, target: { accountId: string } | { poolId: string }, ts: number): { row: Row; mutations: Mutation[] } {
  if ('poolId' in target) {
    const pool = tables.pools.find((p) => p.id === target.poolId) as Pool
    const made = newRowMutation(tables, { name: `${pool.name} pool`, section: 'transfer', kind: 'pool-allocation', accountId: pool.accountId, defaultStatus: 'committed' })
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
  if (!household) throw new Error('No household yet')
  if (choice.kind === 'fixed') {
    if (!Number.isFinite(choice.amount) || choice.amount < 0) throw new Error('The amount cannot be below zero.')
  } else if (choice.kind !== 'rest' && !(choice.share > 0 && choice.share <= 1)) {
    throw new Error('The percentage must be above 0 and at most 100.')
  }
  if (compareMonths(from, household.startMonth) < 0) throw new Error(`The household starts in ${household.startMonth}; a rule cannot start before that.`)
  const closedAfter = tables.monthStates.filter((s) => s.closed && compareMonths(s.month, from) >= 0).map((s) => s.month).sort()
  if (closedAfter.length) {
    throw new Error(closedAfter[0] === from
      ? `${from} is closed. Reopen it, or start the rule in an open month.`
      : `${closedAfter[0]} is closed, and a rule counts for every month from its start on. Reopen it, or start the rule after it.`)
  }

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
  if (!canCarryRule(row)) throw new Error(`"${row.name}" cannot have a rule: only pocket money and the transfer to a savings account, an investment account or a pool account can.`)
  if (choice.kind === 'rest' && !canTakeRest(row)) throw new Error('Pocket money cannot take the rest of the month. Give it an amount or a percentage.')
  if (choice.kind === 'share-of-own-income') {
    if (!isPocketRow(row)) throw new Error(`Only pocket money can be a percentage of an adult's own income; "${row.name}" is not pocket money.`)
    const adult = tables.entities.find((e) => e.id === row.scope && !e.deletedAt && e.kind === 'adult')
    if (!adult) throw new Error(`"${row.name}" does not belong to an adult. Say who it is for first: row menu, "Belongs to…".`)
  }

  const liveRows = sortRows(working.rows.filter((r) => !r.deletedAt), working.categories)
  const before = resolveRules(liveRows, household.closingRule)
  const wasRest = before.restRowId === row.id
  if (choice.kind === 'rest' && wasRest) return { row, mutations }
  if (choice.kind === 'share-of-rest') {
    const others = liveRows.filter((r) => r.id !== row.id && before.byRow.get(r.id)?.kind === 'share-of-rest')
    const total = others.reduce((sum, r) => sum + (before.byRow.get(r.id)?.share ?? 0), 0) + choice.share
    if (total > 1.000001) {
      throw new Error(`With ${others.map((r) => `"${r.name}"`).join(' and ')} the percentages of what is left would add up to ${sharePercent(total)}. Together they can take 100% at most.`)
    }
  }

  // what every month before the start shows now
  const months = compareMonths(household.startMonth, from) < 0 ? monthRange(household.startMonth, addMonths(from, -1)) : []
  const engine: EngineOutput | null = months.length ? computeEngine({ tables: working, months }) : null
  const closed = new Set(tables.monthStates.filter((s) => s.closed).map((s) => s.month))
  const put = (cell: Cell): void => { mutations.push({ op: 'put', table: 'cells', record: CellSchema.parse({ ...cell, updatedAt: ts }) }) }
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
        // an automatic amount ticked as moved in an open month keeps its tick as a done item
        const moved = c.status === 'done' && !closed.has(m) && c.value !== 0
        const items: CellItem[] = moved
          ? [{ id: newId(), label: '', amount: c.value, status: 'done', fundedBy: r.defaultFundedBy, date: null, note: null, recurringItemId: null, kind: 'normal', skipped: false }]
          : []
        put({ rowId: r.id, month: m, mode: moved ? 'items' : 'value', value: moved ? null : c.value, items, note: cur?.note ?? null, currencyOverride, markedDone: cur?.markedDone ?? false, updatedAt: ts })
      }
    }
    for (const cur of stored.values()) {
      if (compareMonths(cur.month, from) < 0 || cur.mode === 'inherit') continue
      if (then !== 'rule' && cur.month === from) continue
      put({ ...cur, mode: 'inherit', value: null, items: [] })
    }
    if (then !== 'rule') {
      const cur = stored.get(from)
      put({ rowId: r.id, month: from, mode: 'value', value: then.amount, items: [], note: cur?.note ?? null, currencyOverride: null, markedDone: false, updatedAt: ts })
    }
  }

  rework(row, before.byRow.get(row.id), choice.kind === 'fixed' ? { amount: choice.amount } : 'rule')
  rowPatches.set(row.id, {
    rule: choice.kind, ruleShare: 'share' in choice ? choice.share : null,
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
      for (const cur of working.cells) if (cur.rowId === r.id && cur.mode !== 'inherit') put({ ...cur, mode: 'inherit', value: null, items: [] })
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
