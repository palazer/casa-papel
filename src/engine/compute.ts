import {
  cardIsItemized, compareMonths, fromMinor, isOldPocketShare, isShareRule, isTakenFromAccount, monthRange, poolIdOf, resolveRules, scaleMoney, toMinor,
  type Account, type Category, type Cell, type Money, type MonthKey, type Row, type RuleState, type Section,
} from '@/model'
import { buildFxIndex, convertMoney } from './fx'
import { mainAccountSeries } from './mainAccount'
import {
  cellKey,
  type AccountSeries, type CellResult, type CellStatus, type EngineInput, type EngineOutput,
  type Funding, type MonthTotals, type PoolSeries, type ResolvedItem, type RowTotals,
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

const zeroFunding = (): Funding => ({ cash: 0, savings: 0, pools: {} })

function addFunding(f: Funding, fundedBy: string, amount: Money): void {
  if (fundedBy === 'cash') f.cash += amount
  else if (fundedBy === 'savings') f.savings += amount
  else {
    const pid = poolIdOf(fundedBy as `pool:${string}`)
    if (pid) f.pools[pid] = (f.pools[pid] ?? 0) + amount
    else f.cash += amount
  }
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

  const states = new Map(tables.monthStates.map((s) => [s.month, s]))
  const isClosed = (m: MonthKey) => states.get(m)?.closed ?? false
  const pocketTotalFor = (m: MonthKey) => states.get(m)?.pocketTotalOverride ?? household.pocketTotal
  const bufferFor = (m: MonthKey) => states.get(m)?.cashBufferOverride ?? household.cashBuffer

  const accounts = tables.accounts.filter((a) => !a.deletedAt)
  const accountsById = new Map(accounts.map((a) => [a.id, a]))
  const pools = tables.pools.filter((p) => !p.deletedAt)
  const adultIds = new Set(tables.entities.filter((e) => !e.deletedAt && e.kind === 'adult').map((e) => e.id))
  const poolByAllocationRow = new Map(pools.filter((p) => p.allocationRowId).map((p) => [p.allocationRowId as string, p]))
  const rows = sortRows(tables.rows.filter((r) => !r.deletedAt), tables.categories)
  const rowsById = new Map(rows.map((r) => [r.id, r]))
  /** Rows that follow another row mirror its cells, so they are computed after everything else. */
  const pass1Order = [...rows.filter((r) => !r.followsRowId), ...rows.filter((r) => r.followsRowId)]
  const fx = buildFxIndex(tables.fxRates, { driftMode: household.fxDriftMode ?? 'fixed', fixedDrift: household.fxDriftDefault ?? 0, pairDrift: household.fxPairDrift ?? {}, base })
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
      let currency = cell?.currencyOverride ?? row.currency ?? base
      const closed = isClosed(m)
      let value: Money = 0
      let source: CellResult['source'] = 'empty'
      let baseStatus: CellStatus = row.defaultStatus
      let items: ResolvedItem[] = []
      const funding = zeroFunding()
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
        source = 'derived'
        baseStatus = 'derived'
        addFunding(funding, row.defaultFundedBy, value)
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
          addFunding(funding, row.defaultFundedBy, value)
        }
      } else if (cell.mode === 'value') {
        value = cell.value ?? 0
        source = 'value'
        everSet = true
        addFunding(funding, row.defaultFundedBy, value)
      } else {
        source = 'items'
        everSet = true
        let anyProjected = false
        let allDone = true
        for (const it of cell.items) {
          const effectiveAmount = it.kind === 'carry' ? prev : it.amount
          items.push({ ...it, effectiveAmount })
          if (it.skipped) continue
          value += effectiveAmount
          addFunding(funding, it.fundedBy, effectiveAmount)
          if (it.status === 'projected') anyProjected = true
          if (it.status !== 'done') allDone = false
        }
        const live = cell.items.filter((i) => !i.skipped)
        baseStatus = live.length === 0 ? row.defaultStatus : anyProjected ? 'projected' : allDone ? 'done' : 'committed'
      }

      // an automatic amount is done once the month is closed or the user ticked it as moved (`markedDone`)
      const status: CellStatus = baseStatus === 'derived' ? (closed || cell?.markedDone ? 'done' : 'derived') : closed || archived ? 'done' : baseStatus

      const conv = convertMoney(fx, value, currency, base, m)
      if (conv.missingRate) warnOnce(row.id, `No ${currency}→${base} rate for ${m} (${row.name})`)
      // scale funding split into base currency proportionally
      const fundingBase = zeroFunding()
      if (value !== 0) {
        const f = conv.value / value
        fundingBase.cash = Math.round(funding.cash * f)
        fundingBase.savings = Math.round(funding.savings * f)
        for (const [pid, amt] of Object.entries(funding.pools)) fundingBase.pools[pid] = Math.round(amt * f)
      }

      const result: CellResult = {
        rowId: row.id, month: m, value, valueBase: conv.value, deductionsBase: 0, netBase: conv.value, currency, source, status, items,
        funding: fundingBase, missingRate: conv.missingRate, rateProjected: conv.projected, cell,
      }
      cells[cellKey(row.id, m)] = result
      if (byRule && rule && rule.kind !== 'idle') {
        const list = ruled.get(m)
        if (list) list.push({ row, rule, c: result })
        else ruled.set(m, [{ row, rule, c: result }])
      }
      if (!byRule && !archived) {
        prev = value
        if (baseStatus !== 'derived') prevBase = baseStatus
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
    const siblings = cat ? rows.filter((r) => r.id !== row.id && r.section === 'expense' && (r.kind === 'plain' || r.kind === 'salary') && categoryOf(r, liveCats)?.id === cat.id) : []
    for (const m of months) {
      const c = cells[cellKey(row.id, m)]
      if (!c || c.source === 'archived') continue
      let explained: Money = 0
      for (const s of siblings) {
        const sc = cells[cellKey(s.id, m)]
        if (!sc || sc.source === 'archived') continue
        // an expense counts by its funding parts, as the month's totals do
        explained += sc.funding.cash + sc.funding.savings + Object.values(sc.funding.pools).reduce((a, b) => a + b, 0)
      }
      // an estimate whose category is gone counts nothing
      const restBase: Money = cat ? Math.max(0, c.valueBase - explained) : 0
      c.estimate = c.value
      c.estimateBase = c.valueBase
      c.value = c.currency === base ? restBase : c.valueBase > 0 ? Math.round(c.value * (restBase / c.valueBase)) : 0
      c.valueBase = restBase
      c.netBase = restBase
      c.funding = { cash: restBase, savings: 0, pools: {} }
      if (c.source !== 'empty') {
        c.source = 'derived'
        c.status = isClosed(m) || c.cell?.markedDone ? 'done' : 'derived'
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
  const toSavingsRows = rows.filter((r) => r.kind === 'to-savings')
  for (const m of months) {
    const t: MonthTotals = {
      month: m, closed: isClosed(m), income: 0, cashExpense: 0, savingsFunded: 0, poolFunded: 0, poolFundedByPool: {},
      allocations: 0, allocationsByPool: {}, toInvestment: 0, pocket: 0, debt: 0,
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
          } else {
            // plain transfer rows behave like outflows the user controls
            t.debt += 0
            t.cashExpense += v
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
    t.fromSavingsDerived = t.savingsFunded + t.poolFunded
    t.expensesTotal = t.cashExpense + t.savingsFunded + t.poolFunded + t.pocket + t.debt
    t.transfersTotal = t.allocations + t.toInvestment + t.toSavings
    totals[m] = t
  }

  // ---------- pools ----------
  const poolSeries: Record<string, PoolSeries> = {}
  for (const pool of pools) {
    const series: PoolSeries = { poolId: pool.id, months: {} }
    let bal = pool.openingBalance
    for (const m of months) {
      // an archived virtual account's series stops at its archive month; net worth and later months no longer see it
      if (pool.archivedMonth && compareMonths(m, pool.archivedMonth) >= 0) break
      const allocation = totals[m].allocationsByPool[pool.id] ?? 0
      const spend = totals[m].poolFundedByPool[pool.id] ?? 0
      // A virtual account never holds less than nothing. What is taken beyond what it holds comes out of the unassigned
      // part of its savings account: that account's balance already falls by the whole amount, so only the split
      // inside it changes. `short` names the month's shortfall until a top-up covers it.
      const after: Money = bal + allocation - spend
      const short: Money = after < 0 ? -after : 0
      bal = after < 0 ? 0 : after
      series.months[m] = { balance: bal, allocation, spend, short }
    }
    poolSeries[pool.id] = series
  }

  /** A balance in the base currency; a missing rate leaves it 1:1 and warns once per account. */
  const inBase = (acc: Account, balance: Money, m: MonthKey): { balanceBase: Money; missingRate: boolean } => {
    const conv = convertMoney(fx, balance, acc.currency, base, m)
    if (conv.missingRate) warnOnce(acc.id, `No ${acc.currency}→${base} rate for ${m} (${acc.name})`)
    return { balanceBase: conv.value, missingRate: conv.missingRate }
  }

  // ---------- savings accounts ----------
  const accountSeries: Record<string, AccountSeries> = {}
  // Spending "from savings" comes out of the first savings account a "to savings" row feeds. Deliberately not the
  // account that takes the rest: moving the rest would then move past spending between accounts.
  const primarySavingsId =
    toSavingsRows.map((r) => r.accountId).find((id) => id && accountsById.get(id)?.type === 'savings') ??
    accounts.find((a) => a.type === 'savings')?.id ?? null
  for (const acc of accounts) {
    if (acc.type !== 'savings' || !acc.tracked) continue
    const series: AccountSeries = { accountId: acc.id, currency: acc.currency, liability: false, months: {} }
    let prevBalance: Money | null = null
    for (const m of months) {
      if (compareMonths(m, acc.openingMonth) < 0) continue
      if (acc.archivedMonth && compareMonths(m, acc.archivedMonth) >= 0) break
      const start: Money = prevBalance ?? acc.openingBalance
      const inflow = savingsInflow(acc, m, rows, cells, pools, totals[m])
      const outflow = savingsOutflow(acc, m, rows, cells, pools, totals[m], acc.id === primarySavingsId)
      const computed: Money = start + inflow - outflow
      const actual = actuals.get(`${acc.id}|${m}`)?.actualBalance ?? null
      const balance: Money = actual ?? computed
      series.months[m] = { computed, balance, adjustment: actual != null ? actual - computed : 0, inflow, outflow, ...inBase(acc, balance, m) }
      prevBalance = balance
    }
    accountSeries[acc.id] = series
  }

  // ---------- investment accounts ----------
  for (const acc of accounts) {
    if (acc.type !== 'investment' || !acc.tracked) continue
    const inv = acc.investment ?? { projectionMode: 'fixed-rate' as const, annualRate: 0, depositTiming: 'start' as const, depositFxMode: 'monthly-rate' as const, fixedRate: null }
    const series: AccountSeries = { accountId: acc.id, currency: acc.currency, liability: false, months: {} }
    const fixedMonthly = Math.pow(1 + (inv.annualRate ?? 0), 1 / 12) - 1
    const realised: number[] = []
    let prevValue: Money | null = null
    let capital: Money = acc.openingBalance
    /** Row amount in the account's currency: at the month's rate, or at the account's fixed rate from the base currency. */
    const toAccountCurrency = (c: CellResult, m: MonthKey): Money => {
      if (inv.depositFxMode === 'fixed' && inv.fixedRate) return toMinor(fromMinor(c.valueBase, base) * inv.fixedRate, acc.currency)
      const conv = convertMoney(fx, c.value, c.currency, acc.currency, m)
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
        if (row.kind === 'to-investment') {
          // a negative deposit is money taken out: the rest in a month that overran, or a typed correction
          const v = toAccountCurrency(c, m)
          if (v >= 0) deposit += v
          else withdrawal -= v
        } else if (row.kind === 'from-investment') withdrawal += toAccountCurrency(c, m)
      }
      if (am?.actualDeposit != null) deposit = am.actualDeposit
      const rate = inv.projectionMode === 'historical-average' && realised.length > 0 ? realised.reduce((a, b) => a + b, 0) / realised.length : fixedMonthly
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
        computed, balance, adjustment: actual != null ? actual - computed : 0, inflow: deposit, outflow: withdrawal,
        capital, startValue, monthlyReturn, totalReturn: capital !== 0 ? balance / capital - 1 : 0, projected: actual == null, ...inBase(acc, balance, m),
      }
      prevValue = balance
    }
    accountSeries[acc.id] = series
  }

  // ---------- cards, loans, other assets ----------
  /** A row's base-currency amount in the account's currency. */
  const inAccountCurrency = (acc: Account, c: CellResult, m: MonthKey): Money => {
    const conv = convertMoney(fx, c.value, c.currency, acc.currency, m)
    if (conv.missingRate) warnOnce(`${acc.id}|${c.currency}`, `No ${c.currency}→${acc.currency} rate for ${m} (${acc.name})`)
    return conv.value
  }
  for (const acc of accounts) {
    if (!acc.tracked || !['credit-card', 'loan', 'other-asset'].includes(acc.type)) continue
    const liability = acc.type !== 'other-asset'
    const series: AccountSeries = { accountId: acc.id, currency: acc.currency, liability, months: {} }
    let prevBalance: Money | null = null
    for (const m of months) {
      if (compareMonths(m, acc.openingMonth) < 0) continue
      if (acc.archivedMonth && compareMonths(m, acc.archivedMonth) >= 0) break
      const prev: Money = prevBalance ?? acc.openingBalance
      let inflow: Money = 0
      let outflow: Money = 0
      if (acc.type === 'credit-card') {
        const itemized = cardIsItemized(acc)
        for (const row of rows) {
          if (row.accountId !== acc.id) continue
          const c = cells[cellKey(row.id, m)]
          if (!c || c.value === 0 || c.source === 'archived') continue
          if (row.kind === 'card-payment') outflow += inAccountCurrency(acc, c, m)
          else if (itemized && row.section === 'expense') inflow += inAccountCurrency(acc, c, m)
        }
      } else if (acc.type === 'loan') {
        for (const row of rows) {
          if (row.accountId !== acc.id || row.kind !== 'debt-payment') continue
          const c = cells[cellKey(row.id, m)]
          if (!c || c.value === 0 || c.source === 'archived') continue
          outflow += inAccountCurrency(acc, c, m)
        }
      }
      // owed grows with spending and shrinks with payments; an asset just carries until a real value is entered
      const computed: Money = liability ? prev + inflow - outflow : prev
      const actual = actuals.get(`${acc.id}|${m}`)?.actualBalance ?? null
      const balance: Money = actual ?? computed
      series.months[m] = { computed, balance, adjustment: actual != null ? actual - computed : 0, inflow, outflow, projected: actual == null, ...inBase(acc, balance, m) }
      prevBalance = balance
    }
    accountSeries[acc.id] = series
  }

  // ---------- the main account, and net worth ----------
  // What stays in the current accounts is money the household has, so it counts: the Statement's lower half would
  // not balance without it, and every other screen shows the same figure.
  const main = mainAccountSeries({ months, rows, cells, totals, accounts, actuals, fx, base })
  const netWorth: Record<MonthKey, Money> = {}
  for (const m of months) {
    let nw = main.months[m]?.balance ?? 0
    for (const s of Object.values(accountSeries)) {
      const r = s.months[m]
      if (!r) continue
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

function savingsInflow(acc: Account, m: MonthKey, rows: Row[], cells: Record<string, CellResult>, pools: EngineInput['tables']['pools'], t: MonthTotals): Money {
  let inflow = 0
  for (const row of rows) {
    if (row.kind === 'to-savings' && row.accountId === acc.id) inflow += cells[cellKey(row.id, m)]?.valueBase ?? 0
  }
  for (const pool of pools) if (pool.accountId === acc.id) inflow += t.allocationsByPool[pool.id] ?? 0
  return inflow
}

function savingsOutflow(acc: Account, m: MonthKey, rows: Row[], cells: Record<string, CellResult>, pools: EngineInput['tables']['pools'], t: MonthTotals, isPrimary: boolean): Money {
  let out = isPrimary ? t.savingsFunded : 0
  for (const pool of pools) if (pool.accountId === acc.id) out += t.poolFundedByPool[pool.id] ?? 0
  // money taken out of this account into the month by hand
  for (const row of rows) {
    if (row.kind !== 'from-savings' || row.accountId !== acc.id) continue
    const c = cells[cellKey(row.id, m)]
    if (c && c.source !== 'archived') out += c.valueBase
  }
  return out
}

function dedupe(list: string[]): string[] {
  return [...new Set(list)]
}
