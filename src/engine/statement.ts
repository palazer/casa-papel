/**
 * The Statement: one month in accounting form, read from numbers the engine already computes. Two halves, each with
 * two sides that agree to the cent:
 *
 *   the month      Money in  = Money out                closed by the rest (to one savings account) or the leftover
 *   the position   Assets    = Debts and net worth      closed by "Free"
 *
 * The upper half is the main account's month. For both month-end rules the engine guarantees
 *   income = cashExpense + allocations + toInvestment + pocket + debt + toSavings + leftover
 * so with the spending paid from savings and virtual accounts added to both sides, and a negative closing figure moved
 * across (a short month takes from savings or from the account):
 *   in  = income + savingsFunded + poolFunded + max(0, −toSavings) + max(0, −leftover)
 *   out = spending + set aside and paid off + max(0, toSavings) + max(0, leftover)
 * Rows are sorted into the same buckets the engine's totals use (compute.ts, pass 2), which is what keeps the cents.
 */
import { accountGroup, addMonths, canCarryRule, cardIsItemized, describeCadence, isTakenFromAccount, nextDue, repeatsText, resolveRules, rowsFeeding, runningSchedules, type Account, type Money, type MonthKey, type RecurringItem, type Row, type Section, type Tables } from '@/model'
import { computeGoals, type GoalProgress } from './goals'
import { currentAccountsIn, mainAccountLabel } from './mainAccount'
import { cellKey, type AccountSeries, type CellResult, type CellStatus, type EngineOutput } from './types'

export type StatementHue = 'income' | 'expense' | 'transfer' | 'worth' | 'pool'
export type StatementLineKind = 'group' | 'category' | 'row' | 'item' | 'source' | 'account' | 'pool' | 'figure' | 'note'

/** The rule behind a transfer line, and behind the account or virtual account that transfer feeds. */
export interface StatementRule {
  /** `idle`: a savings row that gets nothing because another takes the rest. `none`: no row feeds the account yet. */
  kind: 'fixed' | 'share-of-income' | 'share-of-own-income' | 'share-of-row' | 'share-of-rest' | 'rest' | 'idle' | 'none'
  /** The fraction of a share rule. */
  share?: number
  /** For a share of one income: that income line's name; left out when the line is gone. */
  of?: string
  /** The row the rule sits on; absent for `none`. */
  rowId?: string
}

/**
 * Money that moves between a row of the month and an account of the lower half. On a row: the account or virtual
 * account it fills, takes from or pays off. On an account: the rows that do. `to` holds the other end's lines on this
 * Statement and `text` says it in words ("Pays off Car loan"). `open` is a loan or a card that no row pays off at all:
 * there is no other end yet.
 */
export interface StatementLink {
  to: string[]
  text: string
  open?: boolean
}

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
  /** The line for what stays in the current accounts: the accounts open this month, whose real balances it takes. */
  currentAccountIds?: string[]
  /** A real balance was entered for this month. */
  entered?: boolean
  /** How far the entered balance is from what the plan expected, in the base currency; left out when it is not. */
  adjustment?: Money
  /** A category with an estimate: what it is expected to come to this month. */
  budget?: Money
  /** "Not broken down yet": the category whose estimate this line is the rest of. */
  estimateFor?: string
  /** Shown for the record and left out of every sum. */
  memo?: boolean
  /** A short lowercase tag beside the name: `automatic`, `the rest`, `calculated`, `to cover the month`. */
  chip?: string
  /** A calculated line of "From accounts": the expenses it paid for, by name. */
  paidFor?: string[]
  /** A line of "From accounts": the kind of account the money came out of, said after its name (`virtual account`). */
  accountKind?: string
  /** A row shown under the name of the account it takes from: the row's own name, when that says something else. */
  ownName?: string
  /** An account or a virtual account that is archived from some month on: shown while it existed, with nothing new started on it. */
  archived?: boolean
  /** A virtual account that was asked for more than it held this month: by how much, on its own line and on the line of what it paid. */
  short?: Money
  /** With `short`: the savings account whose unassigned part covered it. */
  shortFrom?: string
  /** A row whose month is one labelled item that no schedule posted: the label, so a one-off (a top-up) says what it was without opening anything. */
  note?: string
  /** The rule that works this line out, or that feeds this account: shown as the rule symbol, which opens the rule dialog. */
  rule?: StatementRule
  /** A linked money flow: the other end of this line, shown as the link symbol. */
  link?: StatementLink
  skipped?: boolean
  /** On a schedule: an item a schedule posted, or a row with a schedule that has not ended. Shown as the repeat symbol. */
  scheduled?: boolean
  /** With `scheduled`: how it repeats, in a few words ("Yearly (Jan)", "3 items repeat"). */
  repeats?: string
  /** A scheduled line with nothing this month: the next month something lands in it. */
  nextDue?: MonthKey
  /** On a schedule and not landing this month: a row with nothing in it, or one of a row's schedules, listed all the same. Shown grey. */
  resting?: boolean
  /** With `resting`: what it brings in `nextDue`, shown grey where the amount would be. It counts in no sum: the line's amount stays zero. */
  upcoming?: { amount: Money; currency: string }
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

type Bucket = 'income' | 'from-account' | 'expense' | 'pocket' | 'moved' | 'set-aside' | 'pay-off' | 'to-savings' | 'memo'

/** The engine's pass-2 switch, named. */
function bucketOf(row: Row, accountsById: Map<string, Account>): Bucket {
  // money taken out of an account is its own section, wherever the row was placed
  if (isTakenFromAccount(row)) return 'from-account'
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

/** Null when the engine has no figures for the month. */
export function buildStatement(tables: Tables, engine: EngineOutput, month: MonthKey): Statement | null {
  const main = engine.main
  const household = tables.household.find((h) => !h.deletedAt)
  const t = engine.totals[month]
  if (!household || !t) return null
  const base = household.baseCurrency
  const rules = resolveRules(engine.rows, household.closingRule)
  const ruleOf = (row: Row): StatementRule => {
    const state = rules.byRow.get(row.id)
    const of = state?.kind === 'share-of-row' && state.ofRowId ? engine.rows.find((r) => r.id === state.ofRowId)?.name : undefined
    return { kind: state?.kind ?? 'fixed', share: state && state.share > 0 ? state.share : undefined, rowId: row.id, ...(of ? { of } : {}) }
  }
  /** An account or virtual account shows the rule of the one row that feeds it; fed by several, it shows none of its own. */
  const ruleOfRows = (feeding: Row[]): StatementRule | undefined =>
    feeding.length === 0 ? { kind: 'none' } : feeding.length === 1 ? ruleOf(feeding[0]) : undefined
  const accounts = tables.accounts.filter((a) => !a.deletedAt).sort(byOrder)
  const accountsById = new Map(accounts.map((a) => [a.id, a]))
  const poolsById = new Map(tables.pools.filter((p) => !p.deletedAt).map((p) => [p.id, p]))
  const warnings: string[] = []
  const kindOf = (acc: Account | undefined): string | undefined =>
    acc?.type === 'savings' ? 'savings account' : acc?.type === 'investment' ? 'investment account' : undefined
  /**
   * How a line under "From accounts" is named: after the account the money comes out of, with the kind of account
   * said beside it, so that no line there leaves open where its money came from.
   */
  const fromOf = (row: Row): Pick<StatementLine, 'label' | 'accountKind'> => {
    const pool = tables.pools.find((p) => !p.deletedAt && p.allocationRowId === row.id)
    if (pool) return { label: `From ${pool.name}`, accountKind: 'virtual account' }
    const acc = row.accountId ? accountsById.get(row.accountId) : undefined
    if (acc) return { label: `From ${acc.name}`, accountKind: kindOf(acc) }
    const investments = row.kind === 'from-investment' || row.kind === 'to-investment'
    return { label: investments ? 'From investments' : 'From savings', accountKind: investments ? 'investment account' : 'savings account' }
  }

  const schedulesById = new Map(tables.recurringItems.map((r) => [r.id, r]))
  const cellOf = (row: Row): CellResult | null => {
    const c = engine.cells[cellKey(row.id, month)]
    return c && c.source !== 'archived' ? c : null
  }

  function rowLine(row: Row, c: CellResult, amount: Money, over: Partial<StatementLine> = {}): StatementLine {
    const live = c.items.filter((i) => !i.skipped)
    const empty = c.source === 'empty' || (c.source === 'items' && live.length === 0)
    // A row on a schedule says so in every month, also in one where nothing lands: there it names the next month
    // something does and what that brings, in grey, so an empty line is not mistaken for a row nobody set up.
    const running = runningSchedules(tables.recurringItems, row.id, month)
    const comes = running.map((s) => ({ s, next: nextDue(s, addMonths(month, 1)) })).filter((x): x is { s: RecurringItem; next: MonthKey } => x.next !== null)
    const next = empty ? comes.map((x) => x.next).sort()[0] : undefined
    const upcoming = next ? { amount: comes.filter((x) => x.next === next).reduce((a, x) => a + x.s.amount, 0), currency: c.currency } : undefined
    // What repeats in the row and has nothing in this month is listed under it all the same, so the row reads the
    // same in every month: a yearly item is a grey line in the eleven months it does not land in.
    const resting = comes.filter((x) => !c.items.some((i) => i.recurringItemId === x.s.id))
    // one line says everything of a row that has one thing in it; from two on, the row opens to them
    const listed = live.length > 1 || (resting.length > 0 && live.length + resting.length > 1)
    const children: StatementLine[] = !listed ? [] : [
      ...c.items.map((it) => {
        const schedule = it.recurringItemId ? schedulesById.get(it.recurringItemId) : undefined
        return {
          id: `${row.id}:${it.id}`, kind: 'item' as const, label: it.label || 'Amount', amount: it.effectiveAmount, currency: c.currency, children: [],
          status: it.status, estimate: !it.skipped && it.status === 'projected', skipped: !!it.skipped, scheduled: it.recurringItemId != null,
          repeats: schedule ? describeCadence(schedule, household!.locale) : undefined,
          rowId: row.id, itemId: it.id,
        }
      }),
      ...resting.map(({ s, next: lands }) => ({
        id: `${row.id}:next:${s.id}`, kind: 'item' as const, label: s.name, amount: 0, currency: c.currency, children: [], empty: true,
        scheduled: true, repeats: describeCadence(s, household!.locale), nextDue: lands, resting: true, upcoming: { amount: s.amount, currency: c.currency },
        rowId: row.id,
      })),
    ]
    // a transfer that feeds an account says how through its rule symbol, not through a tag
    const rule = canCarryRule(row) ? ruleOf(row) : undefined
    return {
      id: row.id, kind: 'row', label: row.name, amount, children, status: c.status, estimate: !empty && c.status === 'projected', empty,
      // a one-off says what it was; a scheduled item only repeats its row's name
      note: live.length === 1 && live[0].label && live[0].recurringItemId == null ? live[0].label : undefined,
      automatic: c.source === 'derived', chip: c.source === 'derived' && !rule ? 'automatic' : undefined, rule, missingRate: c.missingRate || undefined,
      native: c.currency !== base ? { amount: c.value, currency: c.currency } : undefined,
      net: row.section === 'income' && c.deductionsBase > 0 ? c.netBase : undefined,
      ...(running.length ? { scheduled: true, repeats: repeatsText(running, household!.locale), nextDue: next, upcoming, resting: empty || undefined } : {}),
      rowId: row.id, ...over,
    }
  }

  /**
   * Rows under their categories, when the section has any; a category's amount is its rows' sum. Every live category
   * of the section is listed in its own order, one without rows too (it is where its first row gets added); rows
   * without a category come last, as in `groupRowsByCategory`.
   */
  function categorised(section: Section, lines: Array<{ row: Row; line: StatementLine }>, estimates: Map<string, { row: Row; cell: CellResult }> = new Map()): StatementLine[] {
    const cats = tables.categories.filter((c) => !c.deletedAt && c.section === section).sort(byOrder)
    if (cats.length === 0) return lines.map((l) => l.line)
    const known = new Set(cats.map((c) => c.id))
    const under = new Map<string, StatementLine[]>()
    for (const { row, line } of lines) {
      const key = row.categoryId && known.has(row.categoryId) ? row.categoryId : 'none'
      under.set(key, [...(under.get(key) ?? []), line])
    }
    const category = (key: string, label: string): StatementLine => {
      const children = [...(under.get(key) ?? [])]
      const est = estimates.get(key)
      // what the rows have not explained yet closes the category; it is an estimate until it is ticked or the month closes
      if (est && est.cell.valueBase > 0) {
        children.push(rowLine(est.row, est.cell, est.cell.valueBase, { label: 'Not broken down yet', estimate: est.cell.status !== 'done', estimateFor: key, children: [], native: undefined }))
      }
      const line: StatementLine = { id: `cat:${section}:${key}`, kind: 'category', label, amount: sum(children), children, estimate: anyEstimate(children), empty: children.length === 0 || undefined }
      if (est && (est.cell.estimateBase ?? 0) > 0) line.budget = est.cell.estimateBase
      return line
    }
    const out = cats.map((c) => category(c.id, c.name))
    if (under.has('none')) out.push(category('none', 'No category'))
    return out
  }

  // ---------- the month ----------
  const income: Array<{ row: Row; line: StatementLine }> = []
  const fromAccounts: StatementLine[] = []
  const expense: Array<{ row: Row; line: StatementLine }> = []
  const pocket: StatementLine[] = []
  const moved: StatementLine[] = []
  const setAside: StatementLine[] = []
  const cover: StatementLine[] = []
  const fromSavings: StatementLine[] = []
  const fromPool = new Map<string, StatementLine[]>()
  const estimates = new Map<string, { row: Row; cell: CellResult }>()
  const expenseCategories = new Set(tables.categories.filter((c) => !c.deletedAt && c.section === 'expense').map((c) => c.id))

  for (const row of engine.rows) {
    const c = cellOf(row)
    if (!c) continue
    const v = c.valueBase
    // a share of one income whose income line is gone this month gets nothing: say why, on the page that shows the zero
    const state = rules.byRow.get(row.id)
    if (state?.kind === 'share-of-row' && c.source === 'derived') {
      const of = state.ofRowId ? engine.rows.find((r) => r.id === state.ofRowId) : undefined
      const ofCell = of && of.section === 'income' && !isTakenFromAccount(of) ? cellOf(of) : null
      if (!ofCell) warnings.push(`"${row.name}" takes a percentage of an income line that is no longer there, so it gets nothing.`)
    }
    switch (bucketOf(row, accountsById)) {
      case 'income':
        income.push({ row, line: rowLine(row, c, v) })
        break
      case 'from-account': {
        // the line leads with the account; the row's own name follows when it says something else
        const from = fromOf(row)
        fromAccounts.push(rowLine(row, c, v, { ...from, ownName: row.name.trim().toLowerCase() === from.label.toLowerCase() ? undefined : row.name }))
        break
      }
      case 'expense': {
        if (row.kind === 'category-estimate') {
          // not a line of its own: its rest closes its category (and without a live category it counts nothing)
          if (row.categoryId && expenseCategories.has(row.categoryId)) estimates.set(row.categoryId, { row, cell: c })
          break
        }
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
      case 'set-aside': {
        // the rest on an investment or a virtual account closes the month; in a month that overruns it comes back from there
        const over: Partial<StatementLine> = rules.byRow.get(row.id)?.kind === 'rest' && c.source === 'derived' ? { balancing: true } : {}
        if (v < 0) cover.push(rowLine(row, c, -v, { ...over, ...fromOf(row) }))
        else setAside.push(rowLine(row, c, v, over))
        break
      }
      case 'pay-off':
        setAside.push(rowLine(row, c, v))
        break
      case 'memo':
        // paying an itemized card moves no new money: its purchases were counted when they were made
        setAside.push(rowLine(row, c, v, { memo: true, chip: 'counted when bought' }))
        break
      case 'to-savings': {
        const state = rules.byRow.get(row.id)
        // a row that gets nothing because another takes the rest has nothing to show
        if (state?.kind === 'idle') break
        // the rest closes the month; in a month with a typed amount the same row is a plain line
        const over: Partial<StatementLine> = state?.kind === 'rest' && c.source === 'derived' ? { balancing: true } : {}
        if (v < 0) cover.push(rowLine(row, c, -v, { ...over, ...fromOf(row) }))
        else setAside.push(rowLine(row, c, v, over))
        break
      }
    }
  }
  if (t.rest != null && rules.restRowId === null && t.rest !== 0) {
    // the rest has no row to sit in: still part of the month, so the half keeps balancing
    warnings.push('The rest of the month has no "To savings" row to go to.')
    const line: StatementLine = { id: 'rest', kind: 'figure', label: t.rest < 0 ? 'From savings' : 'To savings', amount: Math.abs(t.rest), children: [], balancing: true, automatic: true, chip: t.rest < 0 ? 'automatic' : 'the rest', accountKind: t.rest < 0 ? 'savings account' : undefined }
    if (t.rest < 0) cover.push(line)
    else setAside.push(line)
  }
  // `t.rest` says whether the rest was taken this month; a typed month on the rest row closes with the leftover instead
  if (t.rest != null) {
    if (t.leftover !== 0) setAside.push({ id: 'kept', kind: 'figure', label: 'Kept in account', amount: t.leftover, children: [], automatic: true })
  } else if (t.leftover < 0) {
    cover.push({ id: 'leftover', kind: 'figure', label: 'From the account', amount: -t.leftover, children: [], balancing: true, automatic: true, accountKind: 'current account' })
  } else {
    setAside.push({ id: 'leftover', kind: 'figure', label: 'Leftover', amount: t.leftover, children: [], balancing: true, automatic: true })
  }

  // what expenses took straight out of savings and virtual accounts: each line names the expenses it paid for
  const paidFor = (list: StatementLine[]): string[] => [...new Set(list.map((l) => l.label))]
  const sources: StatementLine[] = []
  // spending "from savings" comes out of one savings account, the engine's: the line is named after it
  const spendFrom = engine.primarySavingsId ? accountsById.get(engine.primarySavingsId) : undefined
  if (fromSavings.length) sources.push({ id: 'src:savings', kind: 'source', label: spendFrom ? `From ${spendFrom.name}` : 'From savings', accountKind: 'savings account', amount: sum(fromSavings), children: fromSavings, paidFor: paidFor(fromSavings) })
  for (const [pid, list] of fromPool) {
    const pool = poolsById.get(pid)
    const short = engine.pools[pid]?.months[month]?.short ?? 0
    const line: StatementLine = { id: `src:${pid}`, kind: 'source', label: pool ? `From ${pool.name}` : 'From a removed virtual account', accountKind: 'virtual account', amount: sum(list), children: list, poolId: pid, paidFor: paidFor(list) }
    // it paid more than it held: the difference came out of the unassigned part of its savings account
    if (short > 0) Object.assign(line, { short, shortFrom: pool ? accountsById.get(pool.accountId)?.name : undefined })
    sources.push(line)
  }

  const inLines: StatementLine[] = [group('income', 'Income', 'income', categorised('income', income))]
  // Money in is income plus one group for everything that came out of the household's own accounts. Each line says
  // which kind it is: what an expense took straight out of an account is worked out (`calculated`), what fills a
  // month that overran says so, and what is taken by hand has no tag. The group is always there: its first row is
  // added in it.
  const fromAll: StatementLine[] = [
    ...sources.map((l) => ({ ...l, calculated: true, chip: 'calculated' })),
    ...fromAccounts,
    ...cover.map((l) => ({ ...l, chip: 'to cover the month' })),
  ]
  inLines.push({ ...group('from-accounts', 'From accounts', 'worth', fromAll), empty: fromAll.length === 0 || undefined })

  const spending = categorised('expense', expense, estimates)
  if (pocket.length) spending.push({ id: 'pocket', kind: 'category', label: 'Pocket money', amount: sum(pocket), children: pocket, estimate: anyEstimate(pocket) })
  const outLines: StatementLine[] = [group('expenses', 'Expenses', 'expense', spending)]
  if (moved.length) outLines.push(group('moved', 'Moved elsewhere', 'transfer', moved))
  outLines.push(group('set-aside', 'To savings, investments and debts', 'transfer', setAside))

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
  // what the household has stands under a heading per kind, each with its own sum
  const assetsOf: Record<'savings' | 'investment' | 'other', StatementLine[]> = { savings: [], investment: [], other: [] }
  const debts: StatementLine[] = []
  let setAsideTotal: Money = 0
  let setAsideChange: Money = 0

  if (main?.months[month]) {
    const mm = main.months[month]
    const parts: StatementLine[] = [{ id: 'main:start', kind: 'note', label: 'At the start of the month', amount: mm.start, children: [] }]
    if (mm.kept !== 0) parts.push({ id: 'main:kept', kind: 'note', label: mm.kept < 0 ? 'Short this month' : 'Kept this month', amount: mm.kept, children: [] })
    if (mm.cardBought !== 0) parts.push({ id: 'main:bought', kind: 'note', label: 'Bought on the card, not yet paid', amount: mm.cardBought, children: [] })
    if (mm.cardPaid !== 0) parts.push({ id: 'main:paid', kind: 'note', label: 'Paid to the card', amount: -mm.cardPaid, children: [] })
    // what the bank says beyond what the plan explains, so the parts still add up to the balance
    if (mm.adjustment !== 0) parts.push({ id: 'main:adjustment', kind: 'note', label: 'Not in the plan', amount: mm.adjustment, children: [] })
    const open = currentAccountsIn(accounts, month).map((a) => a.id)
    const line: StatementLine = {
      id: 'main', kind: 'account', label: mainAccountLabel(main, accounts), amount: mm.balance, change: mm.balance - mm.start,
      children: parts, missingRate: main.missingRate || undefined,
    }
    // named after its one account, the line says what kind of account that is, as the headings under it do for theirs
    if (main.accountIds.length === 1) line.accountKind = 'current account'
    // worked out until the real balances are typed; then it reads like any other entered balance
    if (mm.entered) Object.assign(line, { entered: true, adjustment: mm.adjustment !== 0 ? mm.adjustment : undefined })
    else Object.assign(line, { calculated: true, chip: 'calculated' })
    if (open.length) line.currentAccountIds = open
    assets.push(line)
  }

  for (const acc of accounts) {
    const s = engine.accounts[acc.id]
    const r = s?.months[month]
    if (!s || !r) continue
    const change = changeOf(s, acc)
    const line: StatementLine = { id: `acc:${acc.id}`, kind: 'account', label: acc.name, amount: r.balanceBase, change, children: [], accountId: acc.id, missingRate: r.missingRate || undefined, native: s.currency !== base ? { amount: r.balance, currency: s.currency } : undefined }
    if ((acc.type === 'savings' || acc.type === 'investment') && !acc.archivedMonth) line.rule = ruleOfRows(rowsFeeding(engine.rows, acc))
    if (acc.archivedMonth) line.archived = true
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
        if (!p.archivedMonth) poolLine.rule = ruleOfRows(engine.rows.filter((row) => row.id === p.allocationRowId && !row.archivedMonth))
        else poolLine.archived = true
        if (pm.short > 0) Object.assign(poolLine, { short: pm.short, shortFrom: acc.name })
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
    const kind = accountGroup(acc)
    assetsOf[kind === 'savings' || kind === 'investment' ? kind : 'other'].push(line)
  }
  // a kind the household has nothing of gets no heading
  for (const [id, label, lines] of [
    ['savings-accounts', 'Savings accounts', assetsOf.savings], ['investment-accounts', 'Investment accounts', assetsOf.investment], ['other-assets', 'Other assets', assetsOf.other],
  ] as const) {
    if (lines.length) assets.push({ ...group(id, label, 'worth', lines), change: lines.reduce((s, l) => s + (l.change ?? 0), 0) })
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

  // a row that fills, takes from or pays off an account is linked to that account's line, and the line to its rows
  const fills: Row['kind'][] = ['to-savings', 'to-investment', 'pool-allocation']
  const takes: Row['kind'][] = ['from-savings', 'from-investment']
  const pays: Row['kind'][] = ['debt-payment', 'card-payment']
  const rowsById = new Map(engine.rows.map((r) => [r.id, r]))
  const poolOfRow = new Map(tables.pools.filter((p) => !p.deletedAt && p.allocationRowId).map((p) => [p.allocationRowId!, p]))
  const ends = new Map<StatementLine, Array<{ line: StatementLine; way: 'fills' | 'takes' | 'pays' }>>()
  const linkRows = (lines: StatementLine[], incoming: boolean) => {
    for (const line of lines) {
      linkRows(line.children, incoming)
      const row = line.kind === 'row' && line.rowId ? rowsById.get(line.rowId) : undefined
      if (!row) continue
      const pool = poolOfRow.get(row.id)
      const target = row.kind === 'pool-allocation' ? (pool ? poolLines.get(pool.id) : undefined)
        : fills.includes(row.kind) || takes.includes(row.kind) || pays.includes(row.kind) ? (row.accountId ? accountLines.get(row.accountId) : undefined)
        : undefined
      if (!target) continue
      // a month that overruns takes money back out of the account the row usually fills
      const way = pays.includes(row.kind) ? 'pays' : incoming || takes.includes(row.kind) ? 'takes' : 'fills'
      line.link = { to: [target.id], text: `${way === 'pays' ? 'Pays off' : way === 'takes' ? 'Comes from' : row.kind === 'pool-allocation' ? 'Fills' : 'Goes into'} ${target.label}` }
      ends.set(target, [...(ends.get(target) ?? []), { line, way }])
    }
  }
  linkRows(moneyIn.lines, true)
  linkRows(moneyOut.lines, false)
  // by the row's own name: under "From accounts" a line is labelled after its account
  const named = (list: StatementLine[]) => list.map((l) => rowsById.get(l.rowId ?? '')?.name ?? l.label).join(', ')
  for (const [target, list] of ends) {
    const by = (way: 'fills' | 'takes' | 'pays') => list.filter((e) => e.way === way).map((e) => e.line)
    const parts = [
      by('pays').length ? `Paid off by ${named(by('pays'))}` : '',
      by('fills').length ? `Filled by ${named(by('fills'))}` : '',
      by('takes').length ? `Money taken by ${named(by('takes'))}` : '',
    ].filter(Boolean)
    target.link = { to: list.map((e) => e.line.id), text: parts.join('; ') }
  }
  // a loan or a card that never had a payment row: the link is open, and pressing it adds the row
  for (const line of debts) {
    const acc = line.accountId ? accountsById.get(line.accountId) : undefined
    if (!acc || line.link || acc.archivedMonth || (acc.type !== 'loan' && acc.type !== 'credit-card')) continue
    if (engine.rows.some((r) => r.accountId === acc.id && pays.includes(r.kind))) continue
    line.link = { to: [], text: `No row pays off ${acc.name} yet`, open: true }
  }

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
