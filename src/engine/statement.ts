/**
 * The Statement: one month in accounting form, read from numbers the engine already computes. Two halves, each with
 * two sides that agree to the cent:
 *
 *   the month      Money in  = Money out                closed by "the rest" (to savings) and what the account keeps
 *   the position   Assets    = Debts and net worth      closed by "Free"
 *
 * The upper half is the main account's month. For both month-end rules the engine guarantees
 *   income = cashExpense + allocations + toInvestment + pocket + debt + toSavings + leftover
 * so with the spending paid from savings and pool accounts added to both sides, and a negative closing figure moved
 * across (a short month takes from savings or from the account):
 *   in  = income + savingsFunded + poolFunded + max(0, −toSavings) + max(0, −leftover)
 *   out = spending + set aside and paid off + max(0, toSavings) + max(0, leftover)
 * Rows are sorted into the same buckets the engine's totals use (compute.ts, pass 2), which is what keeps the cents.
 */
import { addMonths, cardIsItemized, type Account, type Money, type MonthKey, type Row, type Section, type Tables } from '@/model'
import { computeGoals, type GoalProgress } from './goals'
import { computeMainAccount, type MainAccountSeries } from './mainAccount'
import { cellKey, type AccountSeries, type CellResult, type CellStatus, type EngineOutput } from './types'

export type StatementHue = 'income' | 'expense' | 'transfer' | 'worth' | 'pool'
export type StatementLineKind = 'group' | 'category' | 'row' | 'item' | 'source' | 'account' | 'pool' | 'figure' | 'note'

export interface StatementLine {
  id: string
  kind: StatementLineKind
  label: string
  /** Base currency unless `currency` is set. Lines of the month are positive amounts; balances keep their sign. */
  amount: Money
  currency?: string
  /** The position: how the month moved this balance. */
  change?: Money
  /** `amount` is the sum of the children that are not a memo (items are in the row's own currency and exempt). */
  children: StatementLine[]
  hue?: StatementHue
  /** Open before anyone touches it. */
  open?: boolean
  status?: CellStatus
  /** An estimate, or a line with an estimate under it: the yellow shade. */
  estimate?: boolean
  /** No amount this month. */
  empty?: boolean
  /** Worked out by the app (the rest, a pocket share, a follower): ticked as moved, never typed. */
  automatic?: boolean
  /** The figure that closes its half. */
  balancing?: boolean
  /** Derived from other figures, not a balance anyone entered. */
  calculated?: boolean
  /** A real balance was entered for this month. */
  entered?: boolean
  /** How far the entered balance is from what the plan expected, in the base currency; left out when it is not. */
  adjustment?: Money
  /** Shown for the record and left out of every sum. */
  memo?: boolean
  /** A short lowercase tag beside the name: `automatic`, `the rest`, `calculated`. */
  chip?: string
  skipped?: boolean
  scheduled?: boolean
  missingRate?: boolean
  /** The amount in the row's own currency, when that is not the base currency. */
  native?: { amount: Money; currency: string }
  /** Income after its deductions. */
  net?: Money
  goals?: GoalProgress[]
  rowId?: string
  itemId?: string
  accountId?: string
  poolId?: string
}

export interface StatementSide {
  key: 'in' | 'out' | 'assets' | 'claims'
  label: string
  total: Money
  change?: Money
  lines: StatementLine[]
}

export interface StatementBand {
  left: StatementSide
  right: StatementSide
  /** left − right; 0 when the half balances. */
  difference: Money
}

export interface Statement {
  month: MonthKey
  currency: string
  closed: boolean
  rule: 'savings-plug' | 'leftover-plug'
  flow: StatementBand
  position: StatementBand
  warnings: string[]
}

type Bucket = 'income' | 'from-investment' | 'expense' | 'pocket' | 'moved' | 'set-aside' | 'pay-off' | 'to-savings' | 'memo'

/** The engine's pass-2 switch, named. */
function bucketOf(row: Row, accountsById: Map<string, Account>): Bucket {
  if (row.section === 'income') return 'income'
  switch (row.kind) {
    case 'to-savings': return 'to-savings'
    case 'to-investment':
    case 'pool-allocation': return 'set-aside'
    case 'pocket-money': return 'pocket'
    case 'debt-payment': return 'pay-off'
    case 'card-payment': {
      const acc = row.accountId ? accountsById.get(row.accountId) : undefined
      return acc && cardIsItemized(acc) ? 'memo' : 'pay-off'
    }
    case 'from-investment': return 'from-investment'
    default: return row.section === 'expense' ? 'expense' : 'moved'
  }
}

const sum = (lines: StatementLine[]): Money => lines.reduce((s, l) => (l.memo ? s : s + l.amount), 0)
const anyEstimate = (lines: StatementLine[]): boolean => lines.some((l) => l.estimate)
const byOrder = <T extends { order: string }>(a: T, b: T) => (a.order < b.order ? -1 : a.order > b.order ? 1 : 0)

function group(id: string, label: string, hue: StatementHue, children: StatementLine[]): StatementLine {
  return { id, kind: 'group', label, hue, open: true, amount: sum(children), children }
}

function side(key: StatementSide['key'], label: string, lines: StatementLine[]): StatementSide {
  return { key, label, total: sum(lines), lines }
}

/** Null when the engine has no figures for the month. `main` saves recomputing the main account for every month shown. */
export function buildStatement(tables: Tables, engine: EngineOutput, month: MonthKey, main: MainAccountSeries | null = computeMainAccount(tables, engine)): Statement | null {
  const household = tables.household.find((h) => !h.deletedAt)
  const t = engine.totals[month]
  if (!household || !t) return null
  const base = household.baseCurrency
  const savingsPlug = household.closingRule === 'savings-plug'
  const accounts = tables.accounts.filter((a) => !a.deletedAt).sort(byOrder)
  const accountsById = new Map(accounts.map((a) => [a.id, a]))
  const poolsById = new Map(tables.pools.filter((p) => !p.deletedAt).map((p) => [p.id, p]))
  const warnings: string[] = []

  const cellOf = (row: Row): CellResult | null => {
    const c = engine.cells[cellKey(row.id, month)]
    return c && c.source !== 'archived' ? c : null
  }

  function rowLine(row: Row, c: CellResult, amount: Money, over: Partial<StatementLine> = {}): StatementLine {
    const live = c.items.filter((i) => !i.skipped)
    const empty = c.source === 'empty' || (c.source === 'items' && live.length === 0)
    const children: StatementLine[] = live.length > 1
      ? c.items.map((it) => ({
          id: `${row.id}:${it.id}`, kind: 'item' as const, label: it.label || 'Amount', amount: it.effectiveAmount, currency: c.currency, children: [],
          status: it.status, estimate: !it.skipped && it.status === 'projected', skipped: !!it.skipped, scheduled: it.recurringItemId != null,
          rowId: row.id, itemId: it.id,
        }))
      : []
    return {
      id: row.id, kind: 'row', label: row.name, amount, children, status: c.status, estimate: !empty && c.status === 'projected', empty,
      automatic: c.source === 'derived', chip: c.source === 'derived' ? 'automatic' : undefined, missingRate: c.missingRate || undefined,
      native: c.currency !== base ? { amount: c.value, currency: c.currency } : undefined,
      net: row.section === 'income' && c.deductionsBase > 0 ? c.netBase : undefined,
      rowId: row.id, ...over,
    }
  }

  /**
   * Rows under their categories, when the section has any; a category's amount is its rows' sum. Every live category
   * of the section is listed in its own order, one without rows too (it is where its first row gets added); rows
   * without a category come last, as in `groupRowsByCategory`.
   */
  function categorised(section: Section, lines: Array<{ row: Row; line: StatementLine }>): StatementLine[] {
    const cats = tables.categories.filter((c) => !c.deletedAt && c.section === section).sort(byOrder)
    if (cats.length === 0) return lines.map((l) => l.line)
    const known = new Set(cats.map((c) => c.id))
    const under = new Map<string, StatementLine[]>()
    for (const { row, line } of lines) {
      const key = row.categoryId && known.has(row.categoryId) ? row.categoryId : 'none'
      under.set(key, [...(under.get(key) ?? []), line])
    }
    const category = (key: string, label: string): StatementLine => {
      const children = under.get(key) ?? []
      return { id: `cat:${section}:${key}`, kind: 'category', label, amount: sum(children), children, estimate: anyEstimate(children), empty: children.length === 0 || undefined }
    }
    const out = cats.map((c) => category(c.id, c.name))
    if (under.has('none')) out.push(category('none', 'No category'))
    return out
  }

  // ---------- the month ----------
  const income: Array<{ row: Row; line: StatementLine }> = []
  const fromInvestment: StatementLine[] = []
  const expense: Array<{ row: Row; line: StatementLine }> = []
  const pocket: StatementLine[] = []
  const moved: StatementLine[] = []
  const setAside: StatementLine[] = []
  const cover: StatementLine[] = []
  const fromSavings: StatementLine[] = []
  const fromPool = new Map<string, StatementLine[]>()
  const toSavingsRows = engine.rows.filter((r) => r.section !== 'income' && r.kind === 'to-savings')

  for (const row of engine.rows) {
    const c = cellOf(row)
    if (!c) continue
    const v = c.valueBase
    switch (bucketOf(row, accountsById)) {
      case 'income':
        income.push({ row, line: rowLine(row, c, v) })
        break
      case 'from-investment':
        fromInvestment.push(rowLine(row, c, v))
        break
      case 'expense': {
        // the engine's totals count an expense by its funding parts, each rounded on its own
        const pools = Object.entries(c.funding.pools)
        const amount = c.funding.cash + c.funding.savings + pools.reduce((s, [, a]) => s + a, 0)
        expense.push({ row, line: rowLine(row, c, amount) })
        if (c.funding.savings !== 0) fromSavings.push({ id: `src:savings:${row.id}`, kind: 'note', label: row.name, amount: c.funding.savings, children: [], rowId: row.id })
        for (const [pid, a] of pools) {
          if (a === 0) continue
          const list = fromPool.get(pid) ?? []
          list.push({ id: `src:${pid}:${row.id}`, kind: 'note', label: row.name, amount: a, children: [], rowId: row.id })
          fromPool.set(pid, list)
        }
        break
      }
      case 'pocket':
        pocket.push(rowLine(row, c, v))
        break
      case 'moved':
        moved.push(rowLine(row, c, v))
        break
      case 'set-aside':
      case 'pay-off':
        setAside.push(rowLine(row, c, v))
        break
      case 'memo':
        // paying an itemized card moves no new money: its purchases were counted when they were made
        setAside.push(rowLine(row, c, v, { memo: true, chip: 'counted when bought' }))
        break
      case 'to-savings': {
        // under the plug the first row carries the rest and the others are idle
        if (savingsPlug && row.id !== toSavingsRows[0]?.id) break
        const over: Partial<StatementLine> = savingsPlug ? { balancing: true } : {}
        if (v < 0) cover.push(rowLine(row, c, -v, { ...over, label: 'From savings' }))
        else setAside.push(rowLine(row, c, v, savingsPlug ? { ...over, chip: 'the rest' } : over))
        break
      }
    }
  }
  if (savingsPlug && toSavingsRows.length === 0 && t.toSavings !== 0) {
    // the rest has no row to sit in: still part of the month, so the half keeps balancing
    warnings.push('The rest of the month has no "To savings" row to go to.')
    const line: StatementLine = { id: 'rest', kind: 'figure', label: t.toSavings < 0 ? 'From savings' : 'To savings', amount: Math.abs(t.toSavings), children: [], balancing: true, automatic: true, chip: t.toSavings < 0 ? 'automatic' : 'the rest' }
    if (t.toSavings < 0) cover.push(line)
    else setAside.push(line)
  }
  if (savingsPlug) {
    if (t.leftover !== 0) setAside.push({ id: 'kept', kind: 'figure', label: 'Kept in account', amount: t.leftover, children: [], automatic: true })
  } else if (t.leftover < 0) {
    cover.push({ id: 'leftover', kind: 'figure', label: 'From the account', amount: -t.leftover, children: [], balancing: true, automatic: true })
  } else {
    setAside.push({ id: 'leftover', kind: 'figure', label: 'Leftover', amount: t.leftover, children: [], balancing: true, automatic: true })
  }

  const sources: StatementLine[] = []
  if (fromSavings.length) sources.push({ id: 'src:savings', kind: 'source', label: 'Savings', amount: sum(fromSavings), children: fromSavings })
  for (const [pid, list] of fromPool) sources.push({ id: `src:${pid}`, kind: 'source', label: poolsById.get(pid)?.name ?? 'A removed pool account', amount: sum(list), children: list, poolId: pid })

  const inLines: StatementLine[] = [group('income', 'Income', 'income', categorised('income', income))]
  if (fromInvestment.length) inLines.push(group('from-investment', 'From investments', 'worth', fromInvestment))
  if (sources.length) inLines.push(group('sources', 'From savings and pool accounts', 'pool', sources))
  if (cover.length) inLines.push(group('cover', 'To cover the month', 'transfer', cover))

  const spending = categorised('expense', expense)
  if (pocket.length) spending.push({ id: 'pocket', kind: 'category', label: 'Pocket money', amount: sum(pocket), children: pocket, estimate: anyEstimate(pocket) })
  const outLines: StatementLine[] = [group('expenses', 'Expenses', 'expense', spending)]
  if (moved.length) outLines.push(group('moved', 'Moved elsewhere', 'transfer', moved))
  outLines.push(group('set-aside', 'Set aside, pay off', 'transfer', setAside))

  const moneyIn = side('in', 'Money in', inLines)
  const moneyOut = side('out', 'Money out', outLines)

  // ---------- the position ----------
  const prevMonth = addMonths(month, -1)
  const changeOf = (s: AccountSeries, acc: Account): Money => {
    const r = s.months[month]
    const prev = s.months[prevMonth]
    if (prev) return r.balanceBase - prev.balanceBase
    // the first month: the opening balance at this month's rate
    const opening = acc.openingBalance ?? 0
    const openingBase = s.currency !== base && r.balance !== 0 ? Math.round(opening * (r.balanceBase / r.balance)) : opening
    return r.balanceBase - openingBase
  }
  const accountLines = new Map<string, StatementLine>()
  const poolLines = new Map<string, StatementLine>()
  const assets: StatementLine[] = []
  const debts: StatementLine[] = []
  let setAsideTotal: Money = 0
  let setAsideChange: Money = 0

  if (main?.months[month]) {
    const mm = main.months[month]
    const single = main.accountIds.length === 1 ? accountsById.get(main.accountIds[0]) : undefined
    const parts: StatementLine[] = [{ id: 'main:start', kind: 'note', label: 'At the start of the month', amount: mm.start, children: [] }]
    if (mm.kept !== 0) parts.push({ id: 'main:kept', kind: 'note', label: mm.kept < 0 ? 'Short this month' : 'Kept this month', amount: mm.kept, children: [] })
    if (mm.cardBought !== 0) parts.push({ id: 'main:bought', kind: 'note', label: 'Bought on the card, not yet paid', amount: mm.cardBought, children: [] })
    if (mm.cardPaid !== 0) parts.push({ id: 'main:paid', kind: 'note', label: 'Paid to the card', amount: -mm.cardPaid, children: [] })
    assets.push({
      id: 'main', kind: 'account', label: single?.name ?? (main.accountIds.length > 1 ? 'Current accounts' : 'Main account'), amount: mm.balance, change: mm.balance - mm.start,
      children: parts, calculated: true, chip: 'calculated', missingRate: main.missingRate || undefined,
    })
  }

  for (const acc of accounts) {
    const s = engine.accounts[acc.id]
    const r = s?.months[month]
    if (!s || !r) continue
    const change = changeOf(s, acc)
    const line: StatementLine = { id: `acc:${acc.id}`, kind: 'account', label: acc.name, amount: r.balanceBase, change, children: [], accountId: acc.id, missingRate: r.missingRate || undefined, native: s.currency !== base ? { amount: r.balance, currency: s.currency } : undefined }
    if (r.adjustment !== 0 || r.projected === false) line.entered = true
    if (r.adjustment !== 0) line.adjustment = s.currency !== base && r.balance !== 0 ? Math.round(r.adjustment * (r.balanceBase / r.balance)) : r.adjustment
    accountLines.set(acc.id, line)
    if (s.liability) {
      debts.push(line)
      continue
    }
    const held = tables.pools.filter((p) => !p.deletedAt && p.accountId === acc.id && engine.pools[p.id]?.months[month]).sort(byOrder)
    if (held.length) {
      let inPools: Money = 0
      let poolsChange: Money = 0
      for (const p of held) {
        const pm = engine.pools[p.id].months[month]
        const poolLine: StatementLine = { id: `pool:${p.id}`, kind: 'pool', label: p.name, amount: pm.balance, change: pm.allocation - pm.spend, children: [], poolId: p.id }
        poolLines.set(p.id, poolLine)
        line.children.push(poolLine)
        inPools += pm.balance
        poolsChange += pm.allocation - pm.spend
      }
      line.children.push({ id: `free:${acc.id}`, kind: 'figure', label: 'Not set aside', amount: r.balanceBase - inPools, change: change - poolsChange, children: [] })
      line.open = true
      setAsideTotal += inPools
      setAsideChange += poolsChange
    }
    assets.push(line)
  }

  const assetsSide = side('assets', 'Assets', assets)
  assetsSide.change = assets.reduce((s, l) => s + (l.change ?? 0), 0)
  const debtsTotal = sum(debts)
  const debtsChange = debts.reduce((s, l) => s + (l.change ?? 0), 0)
  const netWorth = assetsSide.total - debtsTotal
  const netWorthChange = assetsSide.change - debtsChange
  const netWorthLine: StatementLine = {
    id: 'net-worth', kind: 'group', label: 'Net worth', hue: 'worth', open: true, amount: netWorth, change: netWorthChange,
    children: [
      { id: 'set-aside-total', kind: 'figure', label: 'Set aside', amount: setAsideTotal, change: setAsideChange, children: [] },
      { id: 'free', kind: 'figure', label: 'Free', amount: netWorth - setAsideTotal, change: netWorthChange - setAsideChange, children: [], balancing: true },
    ],
  }
  const claims: StatementLine[] = []
  if (debts.length) claims.push({ id: 'debts', kind: 'group', label: 'Debts', hue: 'expense', open: true, amount: debtsTotal, change: debtsChange, children: debts })
  claims.push(netWorthLine)
  const claimsSide = side('claims', 'Debts and net worth', claims)
  claimsSide.change = claims.reduce((s, l) => s + (l.change ?? 0), 0)

  // a goal sits on the line it measures
  for (const g of computeGoals(tables, engine, month)) {
    const line = g.goal.kind === 'net-worth' ? netWorthLine
      : g.goal.kind === 'pool-balance' ? (g.goal.poolId ? poolLines.get(g.goal.poolId) : undefined)
      : (g.goal.accountId ? accountLines.get(g.goal.accountId) : undefined)
    if (line) line.goals = [...(line.goals ?? []), g]
  }

  return {
    month, currency: base, closed: t.closed, rule: household.closingRule,
    flow: { left: moneyIn, right: moneyOut, difference: moneyIn.total - moneyOut.total },
    position: { left: assetsSide, right: claimsSide, difference: assetsSide.total - claimsSide.total },
    warnings,
  }
}
