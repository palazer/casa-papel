import {
  accountIdOf, accountRef, buysOnCard, cardIsItemized, cardOf, compareMonths, conversionOf, fromMinor, growthIn, isOldPocketShare, isOutsideNetWorth, isShareRule, isTakenFromAccount, movesInto, monthRange, ownBalance, payContext, paysAsExpense, paysExpenses, pocketLandsIn, poolIdOf, poolRef, resolveRules, scaleMoney, toMinor,
  type Account, type Category, type Cell, type FundedBy, type Money, type MonthKey, type Row, type RuleState, type Section, type Tables,
} from '@/model'
import { convertMoney, householdFx } from './fx'
import { mainAccountSeries } from './mainAccount'
import {
  cellKey, fundingTotal,
  type AccountSeries, type CellResult, type CellStatus, type EngineInput, type EngineOutput,
  type Funding, type MonthTotals, type PoolSeries, type RecordedPart, type ResolvedItem, type RowTotals,
} from './types'

const SECTION_ORDER: Record<Section, number> = { income: 0, expense: 1, transfer: 2 }

/** Sorts after every category of the section. */
const NO_CATEGORY = '￿'

/** A row's live category in its own section, or null: a category of another section or a removed one counts as none. */
function categoryOf(row: Row, cats: Map<string, Category>): Category | null {
  const c = row.categoryId ? cats.get(row.categoryId) : undefined
  return c && c.section === row.section ? c : null
}

const liveCategories = (categories: Category[]) => new Map(categories.filter((c) => !c.deletedAt).map((c) => [c.id, c]))

/** Display order: section, then the category's order (rows without one last), then the row's own order. */
export function sortRows(rows: Row[], categories: Category[] = []): Row[] {
  const cats = liveCategories(categories)
  const key = (r: Row) => categoryOf(r, cats)?.order ?? NO_CATEGORY
  return [...rows].sort((a, b) => {
    const s = SECTION_ORDER[a.section] - SECTION_ORDER[b.section]
    if (s !== 0) return s
    const ka = key(a)
    const kb = key(b)
    if (ka !== kb) return ka < kb ? -1 : 1
    return a.order < b.order ? -1 : a.order > b.order ? 1 : 0
  })
}

export interface RowGroup {
  category: Category | null
  rows: Row[]
  /** Every other named group carries the section's faint band; rows without a category never do. */
  band: boolean
}

/** One section's rows (already sorted) cut into category groups, in order; rows without a category come last. */
export function groupRowsByCategory(rows: Row[], categories: Category[]): RowGroup[] {
  const cats = liveCategories(categories)
  const groups: RowGroup[] = []
  let named = 0
  for (const r of rows) {
    const cat = categoryOf(r, cats)
    const last = groups[groups.length - 1]
    if (last && (last.category?.id ?? null) === (cat?.id ?? null)) {
      last.rows.push(r)
      continue
    }
    groups.push({ category: cat, rows: [r], band: cat ? named++ % 2 === 0 : false })
  }
  return groups
}

const zeroFunding = (): Funding => ({ cash: 0, savings: 0, pools: {}, accounts: {} })

/** What each source paid, less its recorded parts: what is left to convert at the month's rate. */
function withoutRecorded(f: Funding, parts: RecordedPart[]): Funding {
  const out: Funding = { cash: f.cash, savings: f.savings, pools: { ...f.pools }, accounts: { ...f.accounts } }
  for (const p of parts) {
    const pid = poolIdOf(p.source)
    const aid = accountIdOf(p.source)
    if (p.source === 'savings') out.savings -= p.amount
    else if (pid && pid in out.pools) out.pools[pid] -= p.amount
    else if (aid && aid in out.accounts) out.accounts[aid] -= p.amount
    else out.cash -= p.amount
  }
  return out
}

/** A recorded part scaled by `f`: a row's share of the part in the row it follows, or a payment cut to what is owed. The rate stays. */
function scalePart(p: RecordedPart, f: number, source: FundedBy = p.source): RecordedPart {
  const { conversion: c } = p
  return { ...p, source, amount: scaleMoney(p.amount, f), conversion: { ...c, foreignAmount: scaleMoney(c.foreignAmount, f), homeAmount: scaleMoney(c.homeAmount, f) } }
}

/**
 * Counts an amount under where it comes out of. `paying` are the accounts an expense can come out of: one that is
 * gone, or that became a current account, a card or a loan since, counts as the month's income, so the money still
 * shows up somewhere.
 */
function addFunding(f: Funding, fundedBy: FundedBy, amount: Money, paying: ReadonlySet<string>): void {
  if (fundedBy === 'cash') f.cash += amount
  else if (fundedBy === 'savings') f.savings += amount
  else {
    const pid = poolIdOf(fundedBy)
    const aid = accountIdOf(fundedBy)
    if (pid) f.pools[pid] = (f.pools[pid] ?? 0) + amount
    else if (aid && paying.has(aid)) f.accounts[aid] = (f.accounts[aid] ?? 0) + amount
    else f.cash += amount
  }
}

/**
 * The account the old "Savings balance" comes out of: the first savings account a "to savings" row feeds, else the
 * first savings account. Deliberately not the account that takes the rest: moving the rest would then move past
 * spending between accounts. `rows` in display order, both lists without what was deleted.
 */
function firstSavingsAccount(rows: Row[], accounts: Account[]): string | null {
  // the household's own savings: an account left out of net worth is a person's, and never stands for them
  const own = accounts.filter((a) => a.type === 'savings' && !isOutsideNetWorth(a))
  const savings = new Set(own.map((a) => a.id))
  return rows.filter((r) => r.kind === 'to-savings').map((r) => r.accountId).find((id) => id != null && savings.has(id))
    ?? own[0]?.id ?? null
}

/** The same for the screens that offer "Comes out of" (`EngineOutput.primarySavingsId` when the engine's output is at hand). */
export function primarySavingsOf(tables: Pick<Tables, 'rows' | 'accounts' | 'categories'>): string | null {
  return firstSavingsAccount(sortRows(tables.rows.filter((r) => !r.deletedAt), tables.categories), tables.accounts.filter((a) => !a.deletedAt))
}

function emptyOutput(months: MonthKey[]): EngineOutput {
  return { months, rows: [], cells: {}, totals: {}, accounts: {}, pools: {}, rowTotals: {}, incomeTotal: 0, main: null, netWorth: {}, recurringRowIds: [], primarySavingsId: null, warnings: [] }
}

/**
 * Recompute everything from the tables. Deterministic and allocation-light:
 * a household of 60 rows × 60 months resolves in well under a millisecond.
 */
export function computeEngine(input: EngineInput): EngineOutput {
  const { tables } = input
  const household = tables.household.find((h) => !h.deletedAt)
  if (!household || input.months.length === 0) return emptyOutput(input.months)

  const requested = input.months
  const first = compareMonths(household.startMonth, requested[0]) < 0 ? household.startMonth : requested[0]
  const months = monthRange(first, requested[requested.length - 1])
  const requestedSet = new Set(requested)
  const base = household.baseCurrency
  const warnings: string[] = []
  // one line per thing without a rate (a row, an account's balance, an account's deposits), naming the first month
  const warned = new Set<string>()
  const warnOnce = (key: string, message: string) => { if (!warned.has(key)) { warned.add(key); warnings.push(message) } }

  // what a month keeps for itself: the cash buffer and the old pocket total it was given. A month has no state
  // beyond that: the mark of a month that an older version of the app had closed is not read (the store turns it
  // into ticks once, `planHousekeeping`)
  const states = new Map(tables.monthStates.map((s) => [s.month, s]))
  const pocketTotalFor = (m: MonthKey) => states.get(m)?.pocketTotalOverride ?? household.pocketTotal
  const bufferFor = (m: MonthKey) => states.get(m)?.cashBufferOverride ?? household.cashBuffer

  const accounts = tables.accounts.filter((a) => !a.deletedAt)
  const accountsById = new Map(accounts.map((a) => [a.id, a]))
  /** The accounts an expense can come straight out of ("Comes out of"). */
  const paying: ReadonlySet<string> = new Set(accounts.filter(paysExpenses).map((a) => a.id))
  const pools = tables.pools.filter((p) => !p.deletedAt)
  const adultIds = new Set(tables.entities.filter((e) => !e.deletedAt && e.kind === 'adult').map((e) => e.id))
  const poolByAllocationRow = new Map(pools.filter((p) => p.allocationRowId).map((p) => [p.allocationRowId as string, p]))
  const rows = sortRows(tables.rows.filter((r) => !r.deletedAt), tables.categories)
  const rowsById = new Map(rows.map((r) => [r.id, r]))
  /** Rows that follow another row mirror its cells, so they are computed after everything else. */
  const pass1Order = [...rows.filter((r) => !r.followsRowId), ...rows.filter((r) => r.followsRowId)]
  const fx = householdFx(tables.fxRates, household)
  /**
   * A recorded part in a currency: as typed in the cell's own, as recorded in the household's or in the conversion's
   * other one. A third currency (an amount stored before rule X15) goes through the household's at the month's rate.
   */
  const partIn = (p: RecordedPart, cellCurrency: string, to: string, m: MonthKey): Money => {
    if (to === cellCurrency) return p.amount
    if (to === base) return p.conversion.homeAmount
    if (to === p.conversion.foreign) return p.conversion.foreignAmount
    return convertMoney(fx, p.conversion.homeAmount, base, to, m).value
  }
  /** A month's amount in a currency: its recorded parts as recorded, the rest at the month's rate. */
  const amountIn = (c: CellResult, to: string, m: MonthKey): { value: Money; missingRate: boolean } => {
    if (!c.recorded) {
      const conv = convertMoney(fx, c.value, c.currency, to, m)
      return { value: conv.value, missingRate: conv.missingRate }
    }
    let rest = c.value
    let value: Money = 0
    for (const p of c.recorded) {
      rest -= p.amount
      value += partIn(p, c.currency, to, m)
    }
    if (rest === 0) return { value, missingRate: false }
    const conv = convertMoney(fx, rest, c.currency, to, m)
    return { value: value + conv.value, missingRate: conv.missingRate }
  }
  /** Rows driven by recurring items never carry forward: a month without items is 0. */
  const recurringRowIds = new Set(tables.recurringItems.filter((r) => !r.deletedAt).map((r) => r.rowId))

  const cellsByRow = new Map<string, Map<MonthKey, Cell>>()
  for (const c of tables.cells) {
    let m = cellsByRow.get(c.rowId)
    if (!m) cellsByRow.set(c.rowId, (m = new Map()))
    m.set(c.month, c)
  }
  const actuals = new Map(tables.accountMonths.map((a) => [`${a.accountId}|${a.month}`, a]))

  const cells: Record<string, CellResult> = {}
  const savingsPlug = household.closingRule === 'savings-plug'
  /** Which rows a rule works out (a share of income, a share of what is left, the rest); see `model/rules.ts`. */
  const rules = resolveRules(rows, household.closingRule)
  warnings.push(...rules.warnings)
  /** The cells pass 2 fills from a rule, per month, in row order. */
  const ruled = new Map<MonthKey, { row: Row; rule: RuleState; c: CellResult }[]>()

  // ---------- pass 1: user rows ----------
  for (const row of pass1Order) {
    const rule = rules.byRow.get(row.id)
    // pocket money from before pocket rows had rules: a share of the household's pocket total, until the row gets a rule
    const derivedPocket = isOldPocketShare(row)
    const follows = row.followsRowId && !rule ? row.followsRowId : null
    if (follows && !rowsById.has(follows)) warnings.push(`"${row.name}" follows a row that no longer exists.`)
    const rowCells = cellsByRow.get(row.id)
    let prev: Money = 0
    let everSet = false
    /** Certainty carried into inheriting months; 'done' hands the row default forward. */
    let prevBase: CellStatus = row.defaultStatus

    for (const m of months) {
      const archived = row.archivedMonth != null && compareMonths(m, row.archivedMonth) >= 0
      const cell = rowCells?.get(m) ?? null
      /** What the month before hands to this one; nothing while the row has had no amount yet. */
      const given: Money | null = everSet ? prev : null
      let currency = cell?.currencyOverride ?? row.currency ?? base
      let value: Money = 0
      let source: CellResult['source'] = 'empty'
      let baseStatus: CellStatus = row.defaultStatus
      let items: ResolvedItem[] = []
      const funding = zeroFunding()
      /** The parts whose conversion was recorded (rule X10): done items that carry one. */
      let recorded: RecordedPart[] | undefined
      /** The month's own amount is this month's alone (`Cell.once`): the month hands on what it was given. */
      let alone = false
      // A rule fills the month unless an amount was typed into it (the months before the rule started keep theirs
      // that way). The rest row and the idle ones beside it are worked out even when archived, as they always were;
      // a share stops with its row.
      const byRule = rule != null
        && !(rule.typedCounts && cell != null && cell.mode !== 'inherit')
        && !(archived && isShareRule(rule.kind))

      if (byRule) {
        source = 'derived'
        baseStatus = 'derived'
        // worked out in the household currency, whatever the row is kept in
        currency = base
      } else if (archived) {
        source = 'archived'
        baseStatus = 'done'
      } else if (follows) {
        const target = cells[cellKey(follows, m)]
        value = scaleMoney(target?.value ?? 0, row.followShare ?? 1)
        if (target) currency = target.currency
        // what the followed row recorded counts here as recorded too, by the same share (rule X10)
        if (target?.recorded) recorded = target.recorded.map((p) => scalePart(p, row.followShare ?? 1, row.defaultFundedBy))
        source = 'derived'
        baseStatus = 'derived'
        addFunding(funding, row.defaultFundedBy, value, paying)
      } else if (derivedPocket) {
        value = scaleMoney(pocketTotalFor(m), row.pocketShare ?? 0)
        source = 'derived'
        baseStatus = 'derived'
      } else if (!cell || cell.mode === 'inherit') {
        if (recurringRowIds.has(row.id)) {
          value = 0
          source = 'empty'
        } else {
          value = prev
          source = everSet ? 'inherit' : 'empty'
          if (everSet) baseStatus = prevBase === 'done' ? row.defaultStatus : prevBase
          addFunding(funding, row.defaultFundedBy, value, paying)
        }
      } else if (cell.mode === 'value') {
        value = cell.value ?? 0
        source = 'value'
        alone = !!cell.once
        if (!alone) everSet = true
        addFunding(funding, row.defaultFundedBy, value, paying)
      } else {
        source = 'items'
        alone = !!cell.once
        if (!alone) everSet = true
        let anyProjected = false
        let allDone = true
        for (const it of cell.items) {
          const effectiveAmount = it.kind === 'carry' ? prev : it.amount
          items.push({ ...it, effectiveAmount })
          if (it.skipped) continue
          value += effectiveAmount
          addFunding(funding, it.fundedBy, effectiveAmount, paying)
          const held = it.conversion ? conversionOf(it, currency, base) : null
          if (held) (recorded ??= []).push({ source: it.fundedBy, amount: it.amount, conversion: held, itemId: it.id })
          if (it.status === 'projected') anyProjected = true
          if (it.status !== 'done') allDone = false
        }
        const live = cell.items.filter((i) => !i.skipped)
        baseStatus = live.length === 0 ? row.defaultStatus : anyProjected ? 'projected' : allDone ? 'done' : 'committed'
      }

      // an automatic amount is done once the user ticked it as moved (`markedDone`)
      const status: CellStatus = baseStatus === 'derived' ? (cell?.markedDone ? 'done' : 'derived') : archived ? 'done' : baseStatus

      // what was recorded counts as recorded; the rest is converted at the month's rate as one amount, as before
      const recordedAmount = recorded ? recorded.reduce((sum, p) => sum + p.amount, 0) : 0
      const conv = recorded && value === recordedAmount ? { value: 0, missingRate: false, projected: false } : convertMoney(fx, value - recordedAmount, currency, base, m)
      if (conv.missingRate) warnOnce(row.id, `No ${currency}→${base} rate for ${m} (${row.name})`)
      const valueBase = recorded ? conv.value + recorded.reduce((sum, p) => sum + partIn(p, currency, base, m), 0) : conv.value
      // scale funding split into base currency proportionally
      const fundingBase = zeroFunding()
      if (value !== 0 && !recorded) {
        const f = conv.value / value
        fundingBase.cash = Math.round(funding.cash * f)
        fundingBase.savings = Math.round(funding.savings * f)
        for (const [pid, amt] of Object.entries(funding.pools)) fundingBase.pools[pid] = Math.round(amt * f)
        for (const [aid, amt] of Object.entries(funding.accounts)) fundingBase.accounts[aid] = Math.round(amt * f)
      } else if (value !== 0 && recorded) {
        // per source: its recorded parts as recorded, what is left of it at the month's rate
        const rest = value - recordedAmount
        const f = rest !== 0 ? conv.value / rest : 0
        const own = zeroFunding()
        const inBase = zeroFunding()
        for (const p of recorded) {
          addFunding(own, p.source, p.amount, paying)
          addFunding(inBase, p.source, partIn(p, currency, base, m), paying)
        }
        const mix = (all: Money, part: Money, partBase: Money): Money => partBase + Math.round((all - part) * f)
        fundingBase.cash = mix(funding.cash, own.cash, inBase.cash)
        fundingBase.savings = mix(funding.savings, own.savings, inBase.savings)
        for (const [pid, amt] of Object.entries(funding.pools)) fundingBase.pools[pid] = mix(amt, own.pools[pid] ?? 0, inBase.pools[pid] ?? 0)
        for (const [aid, amt] of Object.entries(funding.accounts)) fundingBase.accounts[aid] = mix(amt, own.accounts[aid] ?? 0, inBase.accounts[aid] ?? 0)
      }

      const result: CellResult = {
        rowId: row.id, month: m, value, valueBase, deductionsBase: 0, netBase: valueBase, currency, source, status, items,
        funding: fundingBase, fundingOwn: funding, missingRate: conv.missingRate, rateProjected: conv.projected, given, handsOn: given, cell,
        ...(recorded ? { recorded } : {}),
      }
      cells[cellKey(row.id, m)] = result
      if (byRule && rule && rule.kind !== 'idle') {
        const list = ruled.get(m)
        if (list) list.push({ row, rule, c: result })
        else ruled.set(m, [{ row, rule, c: result }])
      }
      // an amount that is this month's alone leaves no trace in the months after it: not the amount, not how sure it is
      if (!byRule && !archived && !alone) {
        prev = value
        if (baseStatus !== 'derived') prevBase = baseStatus
      }
      result.handsOn = everSet ? prev : null
    }
  }

  /** A balance in the base currency; a missing rate leaves it 1:1 and warns once per account. */
  const inBase = (acc: Account, balance: Money, m: MonthKey): { balanceBase: Money; missingRate: boolean } => {
    const conv = convertMoney(fx, balance, acc.currency, base, m)
    if (conv.missingRate) warnOnce(acc.id, `No ${acc.currency}→${base} rate for ${m} (${acc.name})`)
    return { balanceBase: conv.value, missingRate: conv.missingRate }
  }

  // An account's balance is kept in the account's own currency, so whatever moves it is counted in that currency:
  // as it was typed when the amount is in it already, at the month's rate otherwise. An account in the base currency
  // takes the base figures, the ones the Statement shows.

  /** A row's amount of a month in an account's currency. */
  const inAccountCurrency = (acc: Account, c: CellResult, m: MonthKey): Money => {
    const conv = amountIn(c, acc.currency, m)
    if (conv.missingRate) warnOnce(`${acc.id}|${c.currency}`, `No ${c.currency}→${acc.currency} rate for ${m} (${acc.name})`)
    return conv.value
  }

  // ---------- bought on a card (rule C2) ----------
  // An amount is bought on a card where its row is on that card, or where the item names a payment method that
  // draws on it (`cardOf`). A month in which no item names a method of its own is the row's amount as a whole, on
  // the row's card: what the months held before items could say how they are paid, to the cent.
  const pay = payContext(tables)
  interface CardPart {
    cardId: string
    /** In the cell's currency. */
    amount: Money
    /** The recorded parts among it (rule X10). */
    recorded?: RecordedPart[]
    /** The month's whole amount: its figures are the cell's own. */
    whole: boolean
  }
  const cardPartsByCell = new Map<string, CardPart[]>()
  const cardParts = (row: Row, c: CellResult): CardPart[] => {
    const key = cellKey(row.id, c.month)
    const known = cardPartsByCell.get(key)
    if (known) return known
    let parts: CardPart[] = []
    if (buysOnCard(row) && c.value !== 0 && c.source !== 'archived') {
      const live = c.source === 'items' ? c.items.filter((i) => !i.skipped) : []
      const named = live.some((i) => i.methodId != null || (i.recurringItemId != null && pay.schedules.get(i.recurringItemId)?.methodId != null))
      if (!named) {
        const cardId = cardOf(null, row, pay)
        if (cardId) parts = [{ cardId, amount: c.value, recorded: c.recorded, whole: true }]
      } else {
        // the items give what they count for; where the month counts for another amount than they add up to (an
        // estimate's rest), each keeps its share of it
        const sum = live.reduce((s, i) => s + i.effectiveAmount, 0)
        const f = sum !== 0 && sum !== c.value ? c.value / sum : 1
        const by = new Map<string, CardPart>()
        for (const it of live) {
          const cardId = cardOf(it, row, pay)
          if (!cardId) continue
          const part = by.get(cardId) ?? { cardId, amount: 0, whole: false }
          part.amount += f === 1 ? it.effectiveAmount : Math.round(it.effectiveAmount * f)
          const held = f === 1 ? c.recorded?.filter((p) => p.itemId === it.id) : undefined
          if (held?.length) (part.recorded ??= []).push(...held)
          by.set(cardId, part)
        }
        parts = [...by.values()]
      }
    }
    cardPartsByCell.set(key, parts)
    return parts
  }
  /** Such a part in a currency: what was recorded of it as recorded, the rest at the month's rate. */
  const partAmountIn = (c: CellResult, part: CardPart, to: string, m: MonthKey): { value: Money; missingRate: boolean } => {
    if (part.whole) return amountIn(c, to, m)
    let rest = part.amount
    let value: Money = 0
    for (const p of part.recorded ?? []) {
      rest -= p.amount
      value += partIn(p, c.currency, to, m)
    }
    if (rest === 0) return { value, missingRate: false }
    const conv = convertMoney(fx, rest, c.currency, to, m)
    return { value: value + conv.value, missingRate: conv.missingRate }
  }

  // ---------- loans: a payment stops at what is owed ----------
  // Before the month's sums, because they, the estimates and the rest of the month all read the payment. A loan's
  // balance needs nothing from the sums: what was owed, its payments, and the real balances typed for it. Month by
  // month the payments take what is still owed, in the Grid's order; what does not fit is cut from the cell, which
  // keeps what was planned in `asked`. The stored amounts stay as they are, so when a real balance raises what is
  // owed, the payments count again by themselves.
  const loanSeries: Record<string, AccountSeries> = {}
  {
    const loans = accounts.filter((a) => a.type === 'loan' && a.tracked)
    /** Put another amount into a cell, with everything that follows from it scaled the same way. */
    const setAmount = (c: CellResult, value: Money): void => {
      const f = c.value !== 0 ? value / c.value : 0
      const scale = (x: Money): Money => Math.round(x * f)
      const scaleFunding = (fu: Funding): Funding => ({
        cash: scale(fu.cash), savings: scale(fu.savings),
        pools: Object.fromEntries(Object.entries(fu.pools).map(([k, v]) => [k, scale(v)])),
        accounts: Object.fromEntries(Object.entries(fu.accounts).map(([k, v]) => [k, scale(v)])),
      })
      c.valueBase = c.currency === base ? value : scale(c.valueBase)
      c.netBase = c.valueBase - c.deductionsBase
      c.funding = scaleFunding(c.funding)
      c.fundingOwn = scaleFunding(c.fundingOwn)
      if (c.recorded) c.recorded = c.recorded.map((p) => scalePart(p, f))
      // the items give way in their order: the first ones count, the later ones are what no longer fits
      let left = value
      c.items = c.items.map((it) => {
        if (it.skipped || it.effectiveAmount <= 0) return it
        const counts = Math.max(0, Math.min(it.effectiveAmount, left))
        left -= counts
        return counts === it.effectiveAmount ? it : { ...it, effectiveAmount: counts }
      })
      c.value = value
    }
    const paymentsOf = new Map(loans.map((a) => [a.id, rows.filter((r) => r.kind === 'debt-payment' && r.accountId === a.id)]))
    const followersOf = (rowId: string) => rows.filter((r) => r.followsRowId === rowId && !rules.byRow.get(r.id))
    const owed = new Map<string, Money>()
    for (const acc of loans) loanSeries[acc.id] = { accountId: acc.id, currency: acc.currency, liability: true, ...(isOutsideNetWorth(acc) ? { outside: true as const } : {}), months: {} }
    for (const m of months) {
      const open = loans.filter((a) => compareMonths(m, a.openingMonth) >= 0 && !(a.archivedMonth && compareMonths(m, a.archivedMonth) >= 0))
      const paid = new Map<string, Money>()
      const room = new Map<string, Money>()
      const live = (acc: Account, follower: boolean) => (paymentsOf.get(acc.id) ?? []).flatMap((row) => {
        const c = cells[cellKey(row.id, m)]
        const follows = row.followsRowId != null && !rules.byRow.get(row.id)
        return c && c.value !== 0 && c.source !== 'archived' && follows === follower ? [{ row, c }] : []
      })
      // an amount below zero is money drawn again: it raises what is owed, and is never cut
      for (const acc of open) {
        const start = owed.get(acc.id) ?? acc.openingBalance
        let drawn: Money = 0
        for (const follower of [false, true]) for (const { c } of live(acc, follower)) if (c.value < 0) drawn += inAccountCurrency(acc, c, m)
        paid.set(acc.id, drawn)
        room.set(acc.id, Math.max(0, start - drawn))
      }
      // rows that follow another row are read after it, so one that mirrors a payment mirrors what counted
      for (const follower of [false, true]) {
        for (const acc of open) {
          for (const { row, c } of live(acc, follower)) {
            if (c.value < 0) continue
            const asked = inAccountCurrency(acc, c, m)
            const left = room.get(acc.id) ?? 0
            const counts = Math.min(asked, left)
            room.set(acc.id, left - counts)
            paid.set(acc.id, (paid.get(acc.id) ?? 0) + counts)
            if (counts === asked) continue
            c.asked = c.value
            c.askedBase = c.valueBase
            setAmount(c, c.currency === acc.currency ? counts : Math.round(c.value * (counts / asked)))
            for (const f of followersOf(row.id)) {
              const fc = cells[cellKey(f.id, m)]
              if (fc && fc.source === 'derived') setAmount(fc, scaleMoney(c.value, f.followShare ?? 1))
            }
          }
        }
      }
      for (const acc of open) {
        const start = owed.get(acc.id) ?? acc.openingBalance
        const outflow = paid.get(acc.id) ?? 0
        const computed: Money = start - outflow
        const actual = actuals.get(`${acc.id}|${m}`)?.actualBalance ?? null
        const balance: Money = actual ?? computed
        loanSeries[acc.id].months[m] = { start, computed, entered: actual != null, balance, adjustment: actual != null ? actual - computed : 0, inflow: 0, outflow, projected: actual == null, ...inBase(acc, balance, m) }
        owed.set(acc.id, balance)
      }
    }
  }

  // ---------- category estimates: what a category's rows have not explained yet ----------
  // After pass 1 as a whole, so every row of the category has its amount. The typed estimate keeps carrying forward
  // (pass 1 did that); what counts this month is the estimate minus the category's spending rows, never below zero:
  // once the rows add up to more, they are the category. It always comes out of the month's income.
  const liveCats = liveCategories(tables.categories)
  for (const row of rows) {
    if (row.kind !== 'category-estimate') continue
    const cat = row.section === 'expense' ? categoryOf(row, liveCats) : null
    // a loan's payment (and a card's, where the payment is the spending) stands in its category like any expense, so it explains its part
    const paysOff = (r: Row): boolean => paysAsExpense(r, r.accountId ? accountsById.get(r.accountId) : undefined)
    const siblings = cat ? rows.filter((r) => r.id !== row.id && r.section === 'expense' && (r.kind === 'plain' || r.kind === 'salary' || paysOff(r)) && categoryOf(r, liveCats)?.id === cat.id) : []
    for (const m of months) {
      const c = cells[cellKey(row.id, m)]
      if (!c || c.source === 'archived') continue
      let explained: Money = 0
      for (const s of siblings) {
        const sc = cells[cellKey(s.id, m)]
        if (!sc || sc.source === 'archived') continue
        // an expense counts by its funding parts, as the month's totals do; a payment by its amount
        explained += paysOff(s) ? sc.valueBase : fundingTotal(sc.funding)
      }
      // an estimate whose category is gone counts nothing
      const restBase: Money = cat ? Math.max(0, c.valueBase - explained) : 0
      c.estimate = c.value
      c.estimateBase = c.valueBase
      c.value = c.currency === base ? restBase : c.valueBase > 0 ? Math.round(c.value * (restBase / c.valueBase)) : 0
      c.valueBase = restBase
      c.netBase = restBase
      c.funding = { ...zeroFunding(), cash: restBase }
      c.fundingOwn = { ...zeroFunding(), cash: c.value }
      // what the estimate leaves is no transaction: nothing of it was recorded
      delete c.recorded
      if (c.source !== 'empty') {
        c.source = 'derived'
        c.status = c.cell?.markedDone ? 'done' : 'derived'
      }
    }
  }

  // ---------- deductions: expense rows taken out of an income row lower its net ----------
  // After pass 1 as a whole, so a deduction that follows its income row (a 25 % tax) already has its amount.
  // Totals stay gross: the deduction row is still an expense in its own section.
  for (const row of rows) {
    if (row.section !== 'expense' || !row.deductedFromRowId) continue
    const target = rowsById.get(row.deductedFromRowId)
    if (!target || target.section !== 'income') {
      warnings.push(`"${row.name}" is deducted from a row that no longer exists.`)
      continue
    }
    for (const m of months) {
      const c = cells[cellKey(row.id, m)]
      const t = cells[cellKey(target.id, m)]
      if (!c || !t || c.source === 'archived' || t.source === 'archived') continue
      t.deductionsBase += c.valueBase
      t.netBase = t.valueBase - t.deductionsBase
    }
  }

  // ---------- pass 2: month totals ----------
  const totals: Record<MonthKey, MonthTotals> = {}
  for (const m of months) {
    const t: MonthTotals = {
      month: m, income: 0, cashExpense: 0, savingsFunded: 0, poolFunded: 0, poolFundedByPool: {}, accountFunded: 0, accountFundedByAccount: {}, fundedOwn: {},
      allocations: 0, allocationsByPool: {}, toInvestment: 0, pocket: 0, debt: 0, moved: 0, movedToAccounts: 0,
      buffer: bufferFor(m), toSavings: 0, leftover: 0, fromSavingsDerived: 0, expensesTotal: 0, transfersTotal: 0,
      fromAccounts: 0, takeHome: 0, takeHomeBy: {}, leftForShares: 0, rest: null,
    }
    /** Every "to savings" amount except the rest: typed ones here, shares below. */
    let userToSavings = 0
    for (const row of rows) {
      const c = cells[cellKey(row.id, m)]
      if (!c || c.source === 'archived') continue
      const v = c.valueBase
      if (isTakenFromAccount(row)) {
        // money taken out of savings or investments is cash in wherever the row sits, but not income to take a share of
        t.income += v
        t.fromAccounts += v
        continue
      }
      if (row.section === 'income') {
        t.income += v
        t.takeHome += c.netBase
        if (row.scope !== 'shared') t.takeHomeBy[row.scope] = (t.takeHomeBy[row.scope] ?? 0) + c.netBase
        continue
      }
      switch (row.kind) {
        case 'to-savings':
          userToSavings += v
          break
        case 'to-investment':
          t.toInvestment += v
          break
        case 'pocket-money':
          t.pocket += v
          break
        case 'pool-allocation': {
          t.allocations += v
          const pool = poolByAllocationRow.get(row.id)
          if (pool) t.allocationsByPool[pool.id] = (t.allocationsByPool[pool.id] ?? 0) + v
          break
        }
        case 'debt-payment':
          t.debt += v
          break
        case 'card-payment': {
          const acc = row.accountId ? accountsById.get(row.accountId) : undefined
          if (!acc || !cardIsItemized(acc)) t.debt += v
          break
        }
        default: {
          if (row.section === 'expense') {
            t.cashExpense += c.funding.cash
            t.savingsFunded += c.funding.savings
            for (const [pid, amt] of Object.entries(c.funding.pools)) {
              t.poolFunded += amt
              t.poolFundedByPool[pid] = (t.poolFundedByPool[pid] ?? 0) + amt
            }
            for (const [aid, amt] of Object.entries(c.funding.accounts)) {
              t.accountFunded += amt
              t.accountFundedByAccount[aid] = (t.accountFundedByAccount[aid] ?? 0) + amt
            }
            // the same per source as it was typed, for the accounts kept in another currency
            const own = (source: FundedBy, amount: Money, currency = c.currency): void => {
              if (amount === 0) return
              const by = (t.fundedOwn[source] ??= {})
              by[currency] = (by[currency] ?? 0) + amount
            }
            // a recorded part is filed as recorded: in the conversion's other currency where the amount is in the
            // household's, so an account kept in that currency moves by exactly what was recorded (rule X10)
            const typed = c.recorded ? withoutRecorded(c.fundingOwn, c.recorded) : c.fundingOwn
            for (const p of c.recorded ?? []) {
              const aid = accountIdOf(p.source)
              if (p.source !== 'savings' && !poolIdOf(p.source) && !(aid && paying.has(aid))) continue
              if (p.conversion.foreign !== c.currency) own(p.source, p.conversion.foreignAmount, p.conversion.foreign)
              else own(p.source, p.amount)
            }
            own('savings', typed.savings)
            for (const [pid, amt] of Object.entries(typed.pools)) own(poolRef(pid), amt)
            for (const [aid, amt] of Object.entries(typed.accounts)) own(accountRef(aid), amt)
          } else {
            // A row that moves money is an outflow the user controls, and no expense. Named an account with a
            // balance, the money arrives there; named none, it leaves the plan.
            t.cashExpense += v
            if (movesInto(row, row.accountId ? accountsById.get(row.accountId) : undefined)) t.movedToAccounts += v
            else t.moved += v
          }
        }
      }
    }
    // ---------- rules, in their order: shares of income, the buffer, shares of what is left, the rest ----------
    // The sweep above counted every typed amount; a cell a rule fills was still zero in it.
    const open = ruled.get(m) ?? []
    /** Put a worked-out amount into its cell and into the month's sums. */
    const fill = (e: { row: Row; c: CellResult }, amount: Money): void => {
      e.c.value = amount
      e.c.valueBase = amount
      e.c.netBase = amount
      if (e.row.kind === 'to-savings') userToSavings += amount
      else if (e.row.kind === 'to-investment') t.toInvestment += amount
      else if (e.row.kind === 'pocket-money') t.pocket += amount
      else if (e.row.kind === 'pool-allocation') {
        t.allocations += amount
        const pool = poolByAllocationRow.get(e.row.id)
        if (pool) t.allocationsByPool[pool.id] = (t.allocationsByPool[pool.id] ?? 0) + amount
      }
    }
    for (const e of open) {
      if (e.rule.kind === 'share-of-income') fill(e, Math.max(0, scaleMoney(t.takeHome, e.rule.share)))
      else if (e.rule.kind === 'share-of-own-income') {
        // pocket money as a share of what its adult brings home; a row that belongs to no adult has nothing to take it of
        if (!adultIds.has(e.row.scope)) warnOnce(`own-income|${e.row.id}`, `"${e.row.name}" takes a percentage of its adult's own income, but it does not belong to an adult.`)
        fill(e, Math.max(0, scaleMoney(adultIds.has(e.row.scope) ? t.takeHomeBy[e.row.scope] ?? 0 : 0, e.rule.share)))
      } else if (e.rule.kind === 'share-of-row') {
        // a share of one income line's take-home (its amount minus what is deducted from it); a line that is gone,
        // archived by this month or not an income has nothing to take it of
        const of = e.rule.ofRowId ? rowsById.get(e.rule.ofRowId) : undefined
        const ofCell = of && of.section === 'income' && !isTakenFromAccount(of) ? cells[cellKey(of.id, m)] : undefined
        const there = ofCell != null && ofCell.source !== 'archived'
        if (!there) warnOnce(`share-of-row|${e.row.id}`, `"${e.row.name}" takes a percentage of an income line that is no longer there (${m}).`)
        fill(e, Math.max(0, scaleMoney(there ? ofCell.netBase : 0, e.rule.share)))
      }
    }
    const restCell = open.find((e) => e.rule.kind === 'rest')
    // The rest is taken this month when its row is open for it. A savings-plug household without any row for it still
    // works the rest out (the Statement shows it without a home); a typed month on the rest row means no rest then.
    const plugged = restCell != null || (savingsPlug && rules.restRowId === null)
    const outflows = () => t.cashExpense + t.allocations + t.toInvestment + t.pocket + t.debt
    t.leftForShares = Math.max(0, t.income - outflows() - userToSavings - (plugged ? t.buffer : 0))
    let shareOfRest = 0
    for (const e of open) {
      if (e.rule.kind !== 'share-of-rest') continue
      shareOfRest += e.rule.share
      fill(e, scaleMoney(t.leftForShares, e.rule.share))
    }
    if (shareOfRest > 1.000001) warnOnce('share-of-rest', 'The percentages of what is left add up to more than 100%.')
    if (plugged) {
      const rest = t.income - outflows() - userToSavings - t.buffer
      t.rest = rest
      t.leftover = t.buffer
      if (restCell && restCell.row.kind !== 'to-savings') {
        // the rest goes to an investment or a virtual account: it joins that row's own sum, also when it is negative
        fill(restCell, rest)
        t.toSavings = userToSavings
      } else {
        t.toSavings = userToSavings + rest
        if (restCell) {
          restCell.c.value = rest
          restCell.c.valueBase = rest
          restCell.c.netBase = rest
        }
      }
    } else {
      t.toSavings = userToSavings
      t.leftover = t.income - outflows() - userToSavings
    }
    t.fromSavingsDerived = t.savingsFunded + t.poolFunded + t.accountFunded
    // what the month costs: the expense rows, whatever they come out of, and the payments to loans and cards. Pocket
    // money and what is moved between the household's own accounts are transfers, not expenses.
    t.expensesTotal = t.cashExpense - t.moved - t.movedToAccounts + t.savingsFunded + t.poolFunded + t.accountFunded + t.debt
    t.transfersTotal = t.allocations + t.toInvestment + t.toSavings + t.movedToAccounts
    totals[m] = t
  }

  /** What one source paid in a month (`MonthTotals.fundedOwn`), in an account's currency: a dollar expense lowers a dollar account by exactly its dollars. */
  const ownIn = (acc: Account, source: FundedBy, m: MonthKey): Money => {
    let paid: Money = 0
    for (const [currency, amount] of Object.entries(totals[m].fundedOwn[source] ?? {})) {
      const conv = convertMoney(fx, amount, currency, acc.currency, m)
      if (conv.missingRate) warnOnce(`${acc.id}|${currency}`, `No ${currency}→${acc.currency} rate for ${m} (${acc.name})`)
      paid += conv.value
    }
    return paid
  }
  /** What expenses took straight out of an account in a month ("Comes out of" naming it), in the account's own currency. */
  const paidFrom = (acc: Account, m: MonthKey): Money =>
    acc.currency === base ? totals[m].accountFundedByAccount[acc.id] ?? 0 : ownIn(acc, accountRef(acc.id), m)

  // ---------- pools ----------
  // A virtual account is kept in the currency of the savings account that holds it (rule X14): what is set aside
  // arrives as the account receives it, what is paid out of it leaves as the account pays it, so the two always agree.
  // In an account kept in the household's currency these are the household's figures, as they always were.
  const poolSeries: Record<string, PoolSeries> = {}
  for (const pool of pools) {
    const acc = accountsById.get(pool.accountId)
    const currency = acc?.currency ?? base
    const series: PoolSeries = { poolId: pool.id, currency, months: {} }
    const allocationRow = pool.allocationRowId ? rowsById.get(pool.allocationRowId) : undefined
    /** A figure of the month in the household's currency; a missing rate is warned about once, with the account. */
    const toBase = (v: Money, m: MonthKey): Money => (currency === base || v === 0 ? v : convertMoney(fx, v, currency, base, m).value)
    let bal = pool.openingBalance
    for (const m of months) {
      // an archived virtual account's series stops at its archive month; net worth and later months no longer see it
      if (pool.archivedMonth && compareMonths(m, pool.archivedMonth) >= 0) break
      let allocation: Money
      let spend: Money
      if (!acc || currency === base) {
        allocation = totals[m].allocationsByPool[pool.id] ?? 0
        spend = totals[m].poolFundedByPool[pool.id] ?? 0
      } else {
        const c = allocationRow ? cells[cellKey(allocationRow.id, m)] : undefined
        allocation = c && c.source !== 'archived' ? inAccountCurrency(acc, c, m) : 0
        spend = ownIn(acc, poolRef(pool.id), m)
      }
      // A virtual account never holds less than nothing. What is taken beyond what it holds comes out of the unassigned
      // part of its savings account: that account's balance already falls by the whole amount, so only the split
      // inside it changes. `short` names the month's shortfall until a top-up covers it.
      const start = bal
      const after: Money = bal + allocation - spend
      const short: Money = after < 0 ? -after : 0
      bal = after < 0 ? 0 : after
      series.months[m] = { start, balance: bal, allocation, spend, short, startBase: toBase(start, m), balanceBase: toBase(bal, m), shortBase: toBase(short, m) }
    }
    poolSeries[pool.id] = series
  }

  // ---------- savings accounts ----------
  const accountSeries: Record<string, AccountSeries> = {}
  /** The mark of an account that net worth leaves out, for its series. */
  const outsideOf = (acc: Account): { outside?: true } => (isOutsideNetWorth(acc) ? { outside: true } : {})
  const primarySavingsId = firstSavingsAccount(rows, accounts)
  /** What a month puts into a savings account: its "to savings" rows and what its virtual accounts set aside. */
  const savingsInflow = (acc: Account, m: MonthKey): Money => {
    const home = acc.currency === base
    let inflow: Money = 0
    for (const row of rows) {
      const c = cells[cellKey(row.id, m)]
      if (!c) continue
      // pocket money that lands here counts like a deposit: the account is its adult's own, outside net worth
      // and so does money moved into it by a row that names it
      if ((row.kind === 'to-savings' && row.accountId === acc.id) || pocketLandsIn(row, acc) || movesInto(row, acc)) inflow += home ? c.valueBase : inAccountCurrency(acc, c, m)
      // what a virtual account sets aside arrives in the account's currency, and so does the virtual account (X14)
      else if (!home && row.kind === 'pool-allocation' && c.source !== 'archived' && poolByAllocationRow.get(row.id)?.accountId === acc.id) inflow += inAccountCurrency(acc, c, m)
    }
    if (home) for (const pool of pools) if (pool.accountId === acc.id) inflow += totals[m].allocationsByPool[pool.id] ?? 0
    return inflow
  }
  /**
   * What a month takes out of a savings account: the old "Savings balance" (the first savings account only), what
   * its virtual accounts paid, what a "from savings" row takes by hand, and the expenses that name the account.
   */
  const savingsOutflow = (acc: Account, m: MonthKey): Money => {
    const home = acc.currency === base
    const t = totals[m]
    let out: Money = acc.id !== primarySavingsId ? 0 : home ? t.savingsFunded : ownIn(acc, 'savings', m)
    for (const pool of pools) if (pool.accountId === acc.id) out += home ? t.poolFundedByPool[pool.id] ?? 0 : ownIn(acc, poolRef(pool.id), m)
    for (const row of rows) {
      if (row.kind !== 'from-savings' || row.accountId !== acc.id) continue
      const c = cells[cellKey(row.id, m)]
      if (c && c.source !== 'archived') out += home ? c.valueBase : inAccountCurrency(acc, c, m)
    }
    return out + paidFrom(acc, m)
  }
  for (const acc of accounts) {
    if (acc.type !== 'savings' || !acc.tracked) continue
    const series: AccountSeries = { accountId: acc.id, currency: acc.currency, liability: false, ...outsideOf(acc), months: {} }
    let prevBalance: Money | null = null
    for (const m of months) {
      if (compareMonths(m, acc.openingMonth) < 0) continue
      if (acc.archivedMonth && compareMonths(m, acc.archivedMonth) >= 0) break
      const start: Money = prevBalance ?? acc.openingBalance
      const inflow = savingsInflow(acc, m)
      const outflow = savingsOutflow(acc, m)
      const computed: Money = start + inflow - outflow
      const actual = actuals.get(`${acc.id}|${m}`)?.actualBalance ?? null
      const balance: Money = actual ?? computed
      series.months[m] = { start, computed, entered: actual != null, balance, adjustment: actual != null ? actual - computed : 0, inflow, outflow, ...inBase(acc, balance, m) }
      prevBalance = balance
    }
    accountSeries[acc.id] = series
  }

  // ---------- investment accounts ----------
  for (const acc of accounts) {
    if (acc.type !== 'investment' || !acc.tracked) continue
    const inv = acc.investment ?? { projectionMode: 'fixed-rate' as const, annualRate: 0, depositTiming: 'start' as const, depositFxMode: 'monthly-rate' as const, fixedRate: null }
    const series: AccountSeries = { accountId: acc.id, currency: acc.currency, liability: false, ...outsideOf(acc), months: {} }
    /** The month's growth from the yearly one: the account's, or a change from a month on (rule T4). */
    const fixedMonthly = (m: MonthKey) => Math.pow(1 + growthIn(inv, m), 1 / 12) - 1
    const realised: number[] = []
    let prevValue: Money | null = null
    let capital: Money = acc.openingBalance
    /** Row amount in the account's currency: at the month's rate, or at the account's fixed rate from the base currency. */
    const toAccountCurrency = (c: CellResult, m: MonthKey): Money => {
      if (inv.depositFxMode === 'fixed' && inv.fixedRate) {
        // what was recorded arrived as recorded; the rest at the account's fixed rate
        if (!c.recorded) return toMinor(fromMinor(c.valueBase, base) * inv.fixedRate, acc.currency)
        let restBase = c.valueBase
        let value: Money = 0
        for (const p of c.recorded) {
          restBase -= partIn(p, c.currency, base, m)
          value += partIn(p, c.currency, acc.currency, m)
        }
        return value + toMinor(fromMinor(restBase, base) * inv.fixedRate, acc.currency)
      }
      const conv = amountIn(c, acc.currency, m)
      if (conv.missingRate) warnOnce(`${acc.id}|${c.currency}`, `No ${c.currency}→${acc.currency} rate for ${m} (${acc.name})`)
      return conv.value
    }
    for (const m of months) {
      if (compareMonths(m, acc.openingMonth) < 0) continue
      if (acc.archivedMonth && compareMonths(m, acc.archivedMonth) >= 0) break
      const prev: Money = prevValue ?? acc.openingBalance
      const am = actuals.get(`${acc.id}|${m}`)
      let deposit: Money = 0
      let withdrawal: Money = 0
      for (const row of rows) {
        if (row.accountId !== acc.id) continue
        const c = cells[cellKey(row.id, m)]
        if (!c || c.value === 0) continue
        // pocket money that lands here is a deposit like any other
        if (row.kind === 'to-investment' || pocketLandsIn(row, acc) || movesInto(row, acc)) {
          // a negative deposit is money taken out: the rest in a month that overran, or a typed correction
          const v = toAccountCurrency(c, m)
          if (v >= 0) deposit += v
          else withdrawal -= v
        } else if (row.kind === 'from-investment') withdrawal += toAccountCurrency(c, m)
      }
      // what expenses took straight out of the account, at the rate its deposits use
      const spent = totals[m].accountFundedByAccount[acc.id] ?? 0
      if (spent !== 0) withdrawal += inv.depositFxMode === 'fixed' && inv.fixedRate ? toMinor(fromMinor(spent, base) * inv.fixedRate, acc.currency) : paidFrom(acc, m)
      if (am?.actualDeposit != null) deposit = am.actualDeposit
      const rate = inv.projectionMode === 'historical-average' && realised.length > 0 ? realised.reduce((a, b) => a + b, 0) / realised.length : fixedMonthly(m)
      const startValue: Money = inv.depositTiming === 'start' ? prev + deposit - withdrawal : prev
      const grown = Math.round(startValue * (1 + rate))
      const computed: Money = inv.depositTiming === 'start' ? grown : grown + deposit - withdrawal
      const actual = am?.actualBalance ?? null
      const balance: Money = actual ?? computed
      capital = capital + deposit - withdrawal
      const monthlyReturn = inv.depositTiming === 'start'
        ? (startValue !== 0 ? balance / startValue - 1 : 0)
        : (prev !== 0 ? (balance - deposit + withdrawal) / prev - 1 : 0)
      if (actual != null) realised.push(monthlyReturn)
      series.months[m] = {
        start: prev, computed, entered: actual != null, balance, adjustment: actual != null ? actual - computed : 0, inflow: deposit, outflow: withdrawal,
        capital, startValue, monthlyReturn, totalReturn: capital !== 0 ? balance / capital - 1 : 0, projected: actual == null, ...inBase(acc, balance, m),
      }
      prevValue = balance
    }
    accountSeries[acc.id] = series
  }

  // ---------- cards, loans, other assets, cash, other current accounts ----------
  for (const acc of accounts) {
    const liability = acc.type === 'credit-card' || acc.type === 'loan'
    if (!liability && acc.type !== 'other-asset' && acc.type !== 'cash' && acc.type !== 'joint') continue
    // Cash and an other current account always have a balance: while they counted with the current accounts they
    // were stored as untracked, with no say in it, so their flag says nothing (`ownBalance`).
    if (!ownBalance(acc)) continue
    // a loan's months were worked out before the month's sums, with its payments cut at what was owed
    if (acc.type === 'loan') {
      accountSeries[acc.id] = loanSeries[acc.id]
      continue
    }
    const series: AccountSeries = { accountId: acc.id, currency: acc.currency, liability, ...outsideOf(acc), months: {} }
    let prevBalance: Money | null = null
    for (const m of months) {
      if (compareMonths(m, acc.openingMonth) < 0) continue
      if (acc.archivedMonth && compareMonths(m, acc.archivedMonth) >= 0) break
      const prev: Money = prevBalance ?? acc.openingBalance
      let inflow: Money = 0
      let outflow: Money = 0
      // A card whose purchases are recorded grows with them and shrinks with its payment. On a card that records
      // only its payments the payment is the spending itself: nothing says what was bought, so nothing here can say
      // what is owed. It stays as it is until a real balance is entered.
      if (cardIsItemized(acc)) {
        for (const row of rows) {
          const c = cells[cellKey(row.id, m)]
          if (!c || c.value === 0 || c.source === 'archived') continue
          if (row.kind === 'card-payment') {
            if (row.accountId === acc.id) outflow += inAccountCurrency(acc, c, m)
            continue
          }
          for (const part of cardParts(row, c)) {
            if (part.cardId !== acc.id) continue
            const conv = partAmountIn(c, part, acc.currency, m)
            if (conv.missingRate) warnOnce(`${acc.id}|${c.currency}`, `No ${c.currency}→${acc.currency} rate for ${m} (${acc.name})`)
            inflow += conv.value
          }
        }
      }
      // an other asset (an other current account among them) falls by what expenses took straight out of it, and
      // rises by pocket money that lands in it and by money a row moves into it
      if (!liability) {
        outflow += paidFrom(acc, m)
        for (const row of rows) {
          if (!pocketLandsIn(row, acc) && !movesInto(row, acc)) continue
          const c = cells[cellKey(row.id, m)]
          if (c && c.source !== 'archived') inflow += inAccountCurrency(acc, c, m)
        }
      }
      // owed grows with spending and shrinks with payments; an asset carries, plus what landed in it and less what was paid from it, until a real value is entered
      const computed: Money = prev + inflow - outflow
      const actual = actuals.get(`${acc.id}|${m}`)?.actualBalance ?? null
      const balance: Money = actual ?? computed
      series.months[m] = { start: prev, computed, entered: actual != null, balance, adjustment: actual != null ? actual - computed : 0, inflow, outflow, projected: actual == null, ...inBase(acc, balance, m) }
      prevBalance = balance
    }
    accountSeries[acc.id] = series
  }

  // ---------- the main account, and net worth ----------
  // What stays in the main account is money the household has, so it counts: the Statement's lower half would
  // not balance without it, and every other screen shows the same figure.
  // bought on the cards whose purchases are recorded, in the household's currency: the cash for it is still in the
  // main account
  const cardBought: Record<MonthKey, Money> = {}
  for (const m of months) {
    let bought: Money = 0
    for (const row of rows) {
      const c = cells[cellKey(row.id, m)]
      if (!c) continue
      for (const part of cardParts(row, c)) bought += part.whole ? c.valueBase : partAmountIn(c, part, base, m).value
    }
    cardBought[m] = bought
  }
  const main = mainAccountSeries({ months, rows, cells, totals, accounts, actuals, fx, base, cardBought })
  const netWorth: Record<MonthKey, Money> = {}
  for (const m of months) {
    let nw = main.months[m]?.balance ?? 0
    for (const s of Object.values(accountSeries)) {
      const r = s.months[m]
      // an account left out of net worth has its balance and is counted nowhere
      if (!r || s.outside) continue
      nw += s.liability ? -r.balanceBase : r.balanceBase
    }
    netWorth[m] = nw
  }

  // ---------- row totals ----------
  const rowTotals: Record<string, RowTotals> = {}
  let incomeTotal = 0
  for (const m of requested) incomeTotal += totals[m]?.income ?? 0
  for (const row of rows) {
    let total = 0
    for (const m of requested) total += cells[cellKey(row.id, m)]?.valueBase ?? 0
    rowTotals[row.id] = { total, shareOfIncome: incomeTotal !== 0 ? total / incomeTotal : 0 }
  }

  // ---------- filter to requested months ----------
  const outCells: Record<string, CellResult> = {}
  for (const [k, c] of Object.entries(cells)) if (requestedSet.has(c.month)) outCells[k] = c
  const outTotals: Record<MonthKey, MonthTotals> = {}
  for (const m of requested) if (totals[m]) outTotals[m] = totals[m]
  for (const s of Object.values(poolSeries)) for (const m of Object.keys(s.months)) if (!requestedSet.has(m)) delete s.months[m]
  for (const s of Object.values(accountSeries)) for (const m of Object.keys(s.months)) if (!requestedSet.has(m)) delete s.months[m]
  const outNetWorth: Record<MonthKey, Money> = {}
  for (const m of requested) if (netWorth[m] != null) outNetWorth[m] = netWorth[m]
  for (const m of Object.keys(main.months)) if (!requestedSet.has(m)) delete main.months[m]

  return { months: requested, rows, cells: outCells, totals: outTotals, accounts: accountSeries, pools: poolSeries, rowTotals, incomeTotal, main, netWorth: outNetWorth, recurringRowIds: [...recurringRowIds], primarySavingsId, warnings: dedupe(warnings) }
}

function dedupe(list: string[]): string[] {
  return [...new Set(list)]
}
