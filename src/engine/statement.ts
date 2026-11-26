/**
 * The Statement: one month in accounting form, read from numbers the engine already computes. Two halves, each with
 * two sides that agree to the cent:
 *
 *   the month      Money in  = Money out                closed by the rest (to one savings account) or the leftover
 *   the position   Assets    = Debts and net worth      closed by "Free"
 *
 * The upper half is the main account's month. For both month-end rules the engine guarantees
 *   income = cashExpense + allocations + toInvestment + pocket + debt + toSavings + leftover
 * so with the spending paid straight out of accounts and virtual accounts added to both sides, and a negative closing figure moved
 * across (a short month takes from savings or from the account):
 *   in  = income + savingsFunded + poolFunded + accountFunded + max(0, −toSavings) + max(0, −leftover)
 *   out = spending + set aside and paid off + max(0, toSavings) + max(0, leftover)
 * Rows are sorted into the same buckets the engine's totals use (compute.ts, pass 2), which is what keeps the cents.
 *
 * Money out follows the order in which a month is decided: first what it costs, then what happens with the rest.
 * "Expenses" is everything that has to be paid, a payment to a loan or a card among it (in the category its row has, as in the
 * Grid): that it brings a debt down shows in the lower half. "From what is left" is how the rest is shared out:
 * pocket money, savings, investments, virtual accounts, and the figure that closes the month.
 */
import { accountGroup, addMonths, canCarryRule, describeCadence, isPaymentRow, isTakenFromAccount, monthOfDate, movesInto, nextDue, payContext, payDayOf, pocketLandsIn, repeatsText, resolveRules, rowsFeeding, runningSchedules, type Account, type Money, type MonthKey, type RecurringItem, type Row, type Section, type Tables } from '@/model'
import { computeGoals, type GoalProgress } from './goals'
import { mainAccountsIn, mainAccountLabel } from './mainAccount'
import { cellKey, fundingTotal, type AccountSeries, type CellResult, type CellStatus, type EngineOutput } from './types'

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
  /** The line for what stays in the main account: the main accounts open this month (one), whose real balance it takes. */
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
  /** An account that net worth leaves out ("Leave out of net worth"): it stands under its heading, marked, in no sum. */
  outside?: boolean
  /** A short lowercase tag beside the name: `automatic`, `the rest`, `calculated`, `to cover the month`. */
  chip?: string
  /** A calculated line of "From accounts": the expenses it paid for, by name. */
  paidFor?: string[]
  /**
   * What kind of account a line stands for, said after its name where the name alone does not tell: a virtual
   * account under "From accounts", the main line under its account's name ("main account"), and an other current
   * account under Other assets ("current account"). An account named by its own name carries none otherwise, and a
   * name that says the kind already ("Main account") none at all.
   */
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
  /**
   * The day of the month the amount goes out on ("Paid on"), while the household plans its payments by day and method:
   * on a row with one amount, on each item of a row that lists them, and on that row itself where its items share a day.
   */
  day?: number
  /** With `resting`: what it brings in `nextDue`, shown grey where the amount would be. It counts in no sum: the line's amount stays zero. */
  upcoming?: { amount: Money; currency: string }
  missingRate?: boolean
  /** The amount in the row's own currency, when that is not the base currency. */
  native?: { amount: Money; currency: string }
  /** A payment to a loan that counts for less than was planned, because less was still owed: what was planned. The line's chip says `paid off`. */
  planned?: { amount: Money; currency: string }
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
  rule: 'savings-plug' | 'leftover-plug'
  flow: StatementBand
  position: StatementBand
  warnings: string[]
}

/**
 * What an account holds in a month that no virtual account has set aside, in the account's own currency, which is
 * that of its virtual accounts too (rule X14); null when the account has no balance that month. Below zero when its
 * virtual accounts claim more than it holds.
 */
export function notSetAside(tables: Tables, engine: EngineOutput, accountId: string, month: MonthKey): Money | null {
  const balance = engine.accounts[accountId]?.months[month]?.balance
  if (balance == null) return null
  let inPools: Money = 0
  for (const p of tables.pools) if (!p.deletedAt && p.accountId === accountId) inPools += engine.pools[p.id]?.months[month]?.balance ?? 0
  return balance - inPools
}

type Bucket = 'income' | 'from-account' | 'expense' | 'pocket' | 'moved' | 'set-aside' | 'pay-off' | 'to-savings'

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
    case 'debt-payment':
    case 'card-payment': return 'pay-off'
    // a row that moves money into another of the household's accounts stands with what is set aside; one that names
    // none moves its money out of the plan
    default: return row.section === 'expense' ? 'expense' : movesInto(row, row.accountId ? accountsById.get(row.accountId) : undefined) ? 'set-aside' : 'moved'
  }
}

const sum = (lines: StatementLine[]): Money => lines.reduce((s, l) => (l.memo ? s : s + l.amount), 0)
/** Says the kind of account after a line's name, unless the name says it already ("Main account"). */
function withKind(line: StatementLine, kind: string): void {
  if (line.label.trim().toLowerCase() !== kind) line.accountKind = kind
}
const anyEstimate = (lines: StatementLine[]): boolean => lines.some((l) => l.estimate)
const byOrder = <T extends { order: string }>(a: T, b: T) => (a.order < b.order ? -1 : a.order > b.order ? 1 : 0)

function group(id: string, label: string, hue: StatementHue, children: StatementLine[]): StatementLine {
  return { id, kind: 'group', label, hue, open: true, amount: sum(children), children }
}

function side(key: StatementSide['key'], label: string, lines: StatementLine[]): StatementSide {
  return { key, label, total: sum(lines), lines }
}

/**
 * Null when the engine has no figures for the month. `today` is the current calendar month: a card's line asks for its
 * statement there, and nowhere else.
 */
export function buildStatement(tables: Tables, engine: EngineOutput, month: MonthKey, today: MonthKey = monthOfDate()): Statement | null {
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
  /**
   * How a line under "From accounts" is named: after the account the money comes out of, so that no line there
   * leaves open where its money came from. An account's own name says enough; a virtual account says that it is one.
   */
  const fromOf = (row: Row): Pick<StatementLine, 'label' | 'accountKind'> => {
    const pool = tables.pools.find((p) => !p.deletedAt && p.allocationRowId === row.id)
    if (pool) return { label: `From ${pool.name}`, accountKind: 'virtual account' }
    const acc = row.accountId ? accountsById.get(row.accountId) : undefined
    if (acc) return { label: `From ${acc.name}` }
    return { label: row.kind === 'from-investment' || row.kind === 'to-investment' ? 'From investments' : 'From savings' }
  }

  const schedulesById = new Map(tables.recurringItems.map((r) => [r.id, r]))
  // "Plan payments by day and method": only then does a line say its day (rule W1: the item, its schedule, the row)
  const pay = household.payments ? payContext(tables) : null
  const dayOf = (row: Row, item: CellResult['items'][number] | null): number | undefined =>
    (pay && isPaymentRow(row) ? payDayOf(item, row, month, pay) ?? undefined : undefined)
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
          day: it.skipped || it.effectiveAmount === 0 ? undefined : dayOf(row, it),
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
    // the row's own day: its one amount's, or the day its items share; items on different days each say their own.
    // A line with nothing to pay says none: it is not on the month's list of payments either
    const days = listed ? [...new Set(live.map((i) => dayOf(row, i)))] : [dayOf(row, live.length === 1 ? live[0] : null)]
    const day = empty || amount === 0 || days.length !== 1 ? undefined : days[0]
    return {
      id: row.id, kind: 'row', label: row.name, amount, children, status: c.status, estimate: !empty && c.status === 'projected', empty,
      // a one-off says what it was; a scheduled item only repeats its row's name
      note: live.length === 1 && live[0].label && live[0].recurringItemId == null ? live[0].label : undefined,
      automatic: c.source === 'derived', chip: c.source === 'derived' && !rule ? 'automatic' : undefined, rule, missingRate: c.missingRate || undefined,
      native: c.currency !== base ? { amount: c.value, currency: c.currency } : undefined,
      net: row.section === 'income' && c.deductionsBase > 0 ? c.netBase : undefined,
      ...(day != null ? { day } : {}),
      ...(running.length ? { scheduled: true, repeats: repeatsText(running, household!.locale), nextDue: next, upcoming, resting: empty || undefined } : {}),
      // a payment to a loan that owed less than the payment, or nothing: the line says so, and what was planned
      ...(c.asked != null ? { chip: 'paid off', planned: { amount: c.asked, currency: c.currency } } : {}),
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
  const fromAccount = new Map<string, StatementLine[]>()
  // the old "Savings balance" comes out of one savings account, the engine's: it is counted with what names that account
  const spendFrom = engine.primarySavingsId ? accountsById.get(engine.primarySavingsId) : undefined
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
        expense.push({ row, line: rowLine(row, c, fundingTotal(c.funding)) })
        const byAccount: Record<string, Money> = { ...c.funding.accounts }
        if (c.funding.savings !== 0) {
          if (spendFrom) byAccount[spendFrom.id] = (byAccount[spendFrom.id] ?? 0) + c.funding.savings
          else fromSavings.push({ id: `src:savings:${row.id}`, kind: 'note', label: row.name, amount: c.funding.savings, children: [], rowId: row.id })
        }
        for (const [pid, a] of Object.entries(c.funding.pools)) {
          if (a === 0) continue
          const list = fromPool.get(pid) ?? []
          list.push({ id: `src:${pid}:${row.id}`, kind: 'note', label: row.name, amount: a, children: [], rowId: row.id })
          fromPool.set(pid, list)
        }
        for (const [aid, a] of Object.entries(byAccount)) {
          if (a === 0) continue
          const list = fromAccount.get(aid) ?? []
          list.push({ id: `src:acc:${aid}:${row.id}`, kind: 'note', label: row.name, amount: a, children: [], rowId: row.id })
          fromAccount.set(aid, list)
        }
        break
      }
      case 'pocket':
        pocket.push(rowLine(row, c, v))
        break
      case 'moved':
        // no account of the household receives it: the line says so, because net worth falls by it
        moved.push(rowLine(row, c, v, { chip: 'leaves the plan' }))
        break
      case 'set-aside': {
        // the rest on an investment or a virtual account closes the month; in a month that overruns it comes back from there
        const over: Partial<StatementLine> = rules.byRow.get(row.id)?.kind === 'rest' && c.source === 'derived' ? { balancing: true } : {}
        if (v < 0) cover.push(rowLine(row, c, -v, { ...over, ...fromOf(row) }))
        else setAside.push(rowLine(row, c, v, over))
        break
      }
      case 'pay-off':
        // a payment that has to be made is part of what the month costs: it stands with the expenses, in its row's category
        expense.push({ row, line: rowLine(row, c, v) })
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
    const line: StatementLine = { id: 'rest', kind: 'figure', label: t.rest < 0 ? 'From savings' : 'To savings', amount: Math.abs(t.rest), children: [], balancing: true, automatic: true, chip: t.rest < 0 ? 'automatic' : 'the rest' }
    if (t.rest < 0) cover.push(line)
    else setAside.push(line)
  }
  // `t.rest` says whether the rest was taken this month; a typed month on the rest row closes with the leftover instead
  if (t.rest != null) {
    if (t.leftover !== 0) setAside.push({ id: 'kept', kind: 'figure', label: 'Kept in account', amount: t.leftover, children: [], automatic: true })
  } else if (t.leftover < 0) {
    cover.push({ id: 'leftover', kind: 'figure', label: 'From the account', amount: -t.leftover, children: [], balancing: true, automatic: true, accountKind: 'main account' })
  } else {
    setAside.push({ id: 'leftover', kind: 'figure', label: 'Leftover', amount: t.leftover, children: [], balancing: true, automatic: true })
  }

  // what expenses took straight out of accounts and virtual accounts: each line names its account and the expenses it paid for
  const paidFor = (list: StatementLine[]): string[] => [...new Set(list.map((l) => l.label))]
  const sources: StatementLine[] = []
  // "Savings balance" in a household without a savings account: no account to name
  if (fromSavings.length) sources.push({ id: 'src:savings', kind: 'source', label: 'From savings', amount: sum(fromSavings), children: fromSavings, paidFor: paidFor(fromSavings) })
  for (const acc of accounts) {
    const list = fromAccount.get(acc.id)
    if (list) sources.push({ id: `src:acc:${acc.id}`, kind: 'source', label: `From ${acc.name}`, amount: sum(list), children: list, paidFor: paidFor(list) })
  }
  for (const [pid, list] of fromPool) {
    const pool = poolsById.get(pid)
    const short = engine.pools[pid]?.months[month]?.shortBase ?? 0
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

  const outLines: StatementLine[] = [group('expenses', 'Expenses', 'expense', categorised('expense', expense, estimates))]
  if (moved.length) outLines.push(group('moved', 'Moved elsewhere', 'transfer', moved))
  // pocket money is shared out of what the month leaves, like what goes to savings and investments: it leads the block
  outLines.push(group('set-aside', 'From what is left', 'transfer', [...pocket, ...setAside]))

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
  /** The months of an account for which a real balance is stored. */
  const typedBalance = new Set(tables.accountMonths.filter((am) => am.actualBalance != null).map((am) => `${am.accountId}|${am.month}`))
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
    // what the bank says beyond what the plan explains, so the parts still add up to the balance
    if (mm.adjustment !== 0) parts.push({ id: 'main:adjustment', kind: 'note', label: 'Not in the plan', amount: mm.adjustment, children: [] })
    const openAccounts = mainAccountsIn(accounts, month)
    const open = openAccounts.map((a) => a.id)
    // In the month an archived main account and the one that replaced it were both open (or in data from before rule
    // B9), each stands under the line that counts them together, so they can be seen and edited. They are listed, not
    // added up: the lines after them explain the figure. The plan knows what one of them holds only in a month whose
    // real balances were typed; until then the line says it is counted together.
    const listed: StatementLine[] = openAccounts.length > 1 ? openAccounts.map((a): StatementLine => {
      const real = mm.real?.[a.id]
      const own: StatementLine = { id: `cur:${a.id}`, kind: 'account', label: a.name, amount: real?.base ?? 0, children: [], accountId: a.id, memo: true }
      if (!real) return { ...own, empty: true, chip: 'counted together' }
      return { ...own, entered: true, native: a.currency !== base ? { amount: real.own, currency: a.currency } : undefined }
    }) : []
    const line: StatementLine = {
      id: 'main', kind: 'account', label: mainAccountLabel(main, accounts), amount: mm.balance, change: mm.balance - mm.start,
      children: [...listed, ...parts], missingRate: main.missingRate || undefined,
    }
    // named after its account, the line says what kind of account that is, as the headings under it do for theirs
    withKind(line, 'main account')
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
    if ((acc.type === 'savings' || acc.type === 'investment') && !acc.archivedMonth) {
      const feeding = rowsFeeding(engine.rows, acc)
      // an account left out of net worth is not asked for a rule: it shows one only when a row of its own fills it
      if (!s.outside || feeding.length) line.rule = ruleOfRows(feeding)
    }
    if (acc.archivedMonth) line.archived = true
    // an other current account stands among the other assets, and says what it is: its name alone may not
    if (acc.type === 'joint') withKind(line, 'current account')
    if (r.entered) line.entered = true
    if (r.adjustment !== 0) line.adjustment = s.currency !== base && r.balance !== 0 ? Math.round(r.adjustment * (r.balanceBase / r.balance)) : r.adjustment
    // left out of net worth: the line stays where its kind stands, and no sum above it counts it
    if (s.outside) Object.assign(line, { memo: true, outside: true })
    accountLines.set(acc.id, line)
    if (s.liability) {
      // What the month did to the debt, under its line: what was owed when it began, what was paid, and what a typed
      // figure says beyond that. Only in the household's currency, where the three add up to the line's figure (in
      // another one the rate moves between the start and the end), and only when the month did something.
      if (s.currency === base && (r.outflow !== 0 || r.adjustment !== 0)) {
        const part = (key: string, label: string, amount: Money): StatementLine => ({ id: `owed:${acc.id}:${key}`, kind: 'note', label, amount, children: [] })
        line.children.push(part('start', 'At the start of the month', r.start))
        // an amount below zero on the payment row is money drawn again
        if (r.outflow !== 0) line.children.push(part('paid', r.outflow > 0 ? 'Paid' : 'Drawn again', -r.outflow))
        if (r.adjustment !== 0) line.children.push(part('adjustment', 'Not in the plan', r.adjustment))
      }
      // A card keeps being used, so the plan cannot know what is owed on it: in the current month its line says so
      // until what the statement says is typed, for the start of the month (the end of the one before) or its end.
      // Read from what is stored: the engine holds only the months it was asked for. A card's first month starts on
      // the amount typed in its form.
      if (acc.type === 'credit-card' && month === today && month !== acc.openingMonth && !acc.archivedMonth && !typedBalance.has(`${acc.id}|${month}`) && !typedBalance.has(`${acc.id}|${prevMonth}`)) {
        line.note = 'not checked against the statement'
      }
      debts.push(line)
      continue
    }
    const held = tables.pools.filter((p) => !p.deletedAt && p.accountId === acc.id && engine.pools[p.id]?.months[month]).sort(byOrder)
    if (held.length) {
      let inPools: Money = 0
      let poolsChange: Money = 0
      for (const p of held) {
        // in the household's currency, as the whole Statement is; the virtual account itself is kept in its account's (X14)
        const pm = engine.pools[p.id].months[month]
        const own = engine.pools[p.id].currency
        // what it changed by in the household's currency: against the month before, so the rate's move is part of it,
        // as it is for the account that holds it
        const before = engine.pools[p.id].months[prevMonth]
        const poolChange = pm.balanceBase - (before ? before.balanceBase : pm.startBase)
        const poolLine: StatementLine = {
          id: `pool:${p.id}`, kind: 'pool', label: p.name, amount: pm.balanceBase, change: poolChange, children: [], poolId: p.id,
          native: own !== base ? { amount: pm.balance, currency: own } : undefined,
        }
        if (!p.archivedMonth) poolLine.rule = ruleOfRows(engine.rows.filter((row) => row.id === p.allocationRowId && !row.archivedMonth))
        else poolLine.archived = true
        if (pm.short > 0) Object.assign(poolLine, { short: pm.shortBase, shortFrom: acc.name })
        poolLines.set(p.id, poolLine)
        line.children.push(poolLine)
        inPools += pm.balanceBase
        // what the balance changed by: in a month that ran short, less than what was asked of it
        poolsChange += poolChange
      }
      const free = r.balanceBase - inPools
      // below zero the virtual accounts claim more than the account holds: said on the line, where the red figure is
      line.children.push({ id: `free:${acc.id}`, kind: 'figure', label: 'Not set aside', amount: free, change: change - poolsChange, children: [], note: free < 0 ? 'more is set aside than the account holds' : undefined })
      line.open = true
      // "Set aside" is a part of net worth, so the virtual accounts of an account left out of it are not in it either
      if (!s.outside) {
        setAsideTotal += inPools
        setAsideChange += poolsChange
      }
    }
    const kind = accountGroup(acc)
    assetsOf[kind === 'savings' || kind === 'investment' ? kind : 'other'].push(line)
  }
  // a kind the household has nothing of gets no heading
  for (const [id, label, lines] of [
    ['savings-accounts', 'Savings accounts', assetsOf.savings], ['investment-accounts', 'Investment accounts', assetsOf.investment], ['other-assets', 'Other assets', assetsOf.other],
  ] as const) {
    if (lines.length) assets.push({ ...group(id, label, 'worth', lines), change: lines.reduce((s, l) => (l.memo ? s : s + (l.change ?? 0)), 0) })
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
  type Way = 'fills' | 'takes' | 'pays'
  const ends = new Map<StatementLine, Array<{ line: StatementLine; way: Way }>>()
  const linkRows = (lines: StatementLine[], incoming: boolean) => {
    for (const line of lines) {
      linkRows(line.children, incoming)
      const row = line.kind === 'row' && line.rowId ? rowsById.get(line.rowId) : undefined
      if (!row) continue
      const pool = poolOfRow.get(row.id)
      // pocket money is linked to the account it lands in, which is one that net worth leaves out
      const lands = row.accountId ? pocketLandsIn(row, accountsById.get(row.accountId)) : false
      // a row that moves money is linked to the account it moves it into
      const moves = row.accountId ? movesInto(row, accountsById.get(row.accountId)) : false
      const target = row.kind === 'pool-allocation' ? (pool ? poolLines.get(pool.id) : undefined)
        : fills.includes(row.kind) || takes.includes(row.kind) || pays.includes(row.kind) || lands || moves ? (row.accountId ? accountLines.get(row.accountId) : undefined)
        : undefined
      if (!target) continue
      // a payment brings down what is owed. A month that overruns takes money back out of the account the row usually fills.
      const way: Way = pays.includes(row.kind) ? 'pays' : incoming || takes.includes(row.kind) ? 'takes' : 'fills'
      line.link = { to: [target.id], text: `${way === 'pays' ? 'Pays off' : way === 'takes' ? 'Comes from' : row.kind === 'pool-allocation' ? 'Fills' : lands ? 'Lands in' : 'Goes into'} ${target.label}` }
      ends.set(target, [...(ends.get(target) ?? []), { line, way }])
    }
  }
  linkRows(moneyIn.lines, true)
  linkRows(moneyOut.lines, false)
  // by the row's own name: under "From accounts" a line is labelled after its account
  const named = (list: StatementLine[]) => list.map((l) => rowsById.get(l.rowId ?? '')?.name ?? l.label).join(', ')
  for (const [target, list] of ends) {
    const by = (way: Way) => list.filter((e) => e.way === way).map((e) => e.line)
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
    month, currency: base, rule: household.closingRule,
    flow: { left: moneyIn, right: moneyOut, difference: moneyIn.total - moneyOut.total },
    position: { left: assetsSide, right: claimsSide, difference: assetsSide.total - claimsSide.total },
    warnings,
  }
}
