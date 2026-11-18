import type { Cell, CellItem, ItemStatus, Money, MonthKey, Row, Tables } from '@/model'

export interface EngineInput {
  tables: Tables
  /** Months to report on. The engine always computes from the household's start month. */
  months: MonthKey[]
}

export type CellSource = 'empty' | 'inherit' | 'value' | 'items' | 'derived' | 'archived'
export type CellStatus = ItemStatus | 'derived'

export interface ResolvedItem extends CellItem {
  /** Amount after resolving a carry item to the previous month's value. */
  effectiveAmount: Money
}

export interface Funding {
  cash: Money
  /** The old "Savings balance": comes out of the first savings account (`EngineOutput.primarySavingsId`). */
  savings: Money
  pools: Record<string, Money>
  /** Per account the expense names: a savings account, an investment account or an other asset. */
  accounts: Record<string, Money>
}

/** An expense's whole amount in the base currency: its funding parts added up, as the month's totals count it. */
export function fundingTotal(f: Funding): Money {
  let total = f.cash + f.savings
  for (const amount of Object.values(f.pools)) total += amount
  for (const amount of Object.values(f.accounts)) total += amount
  return total
}

export interface CellResult {
  rowId: string
  month: MonthKey
  /** Effective amount in the row's currency, minor units, positive magnitude. */
  value: Money
  /** Same amount in the household base currency. */
  valueBase: Money
  /** Income rows: base-currency sum of the expense rows deducted from this one (tax, a pension contribution); 0 elsewhere. */
  deductionsBase: Money
  /** valueBase − deductionsBase: what the shares and the per-person views count as income. */
  netBase: Money
  currency: string
  source: CellSource
  status: CellStatus
  items: ResolvedItem[]
  /** Base-currency split of an expense by where the cash comes from. */
  funding: Funding
  /**
   * The same split in the row's own currency (`currency`), before conversion: an account kept in that currency moves
   * by exactly what was typed, not by the amount converted to the base currency and back.
   */
  fundingOwn: Funding
  missingRate: boolean
  /** The base-currency value used a projected (drifted) rate. */
  rateProjected: boolean
  /**
   * A category's estimate row only: what was typed for the whole category, in the row's currency and in the base
   * currency. `value` and `valueBase` are what its other rows have not explained yet.
   */
  estimate?: Money
  estimateBase?: Money
  /**
   * A payment to a loan that was cut because less was still owed: what was planned (typed, carried or scheduled), in
   * the row's currency and in the base currency. `value` and `valueBase` are what counts: what was still owed, or
   * nothing once the loan is paid off. Left out when the payment counts in full.
   */
  asked?: Money
  askedBase?: Money
  /**
   * What the month before hands to this month, in the row's currency: the amount this month shows while nothing is
   * typed into it, and what a carried item in it is worth. null while the row has had no amount yet. (A row on a
   * schedule shows nothing in a month without items, whatever it is given.)
   */
  given: Money | null
  /**
   * What this month hands to the next one: its own amount as it was typed or carried (before a paid-off loan or a
   * category's rows made it count for less), or what it was given where a rule works the month out, the row is
   * archived, or the month's amount is this month's alone (`Cell.once`). null while the row has had no amount yet.
   */
  handsOn: Money | null
  cell: Cell | null
}

/**
 * What a cell was given: typed, carried from the month before, or scheduled. The engine makes two kinds of cell count
 * for less than that: a category's estimate (by what its rows explain) and a payment to a loan (by what is still
 * owed). Whoever copies a month's amount into a stored cell copies this, so the cut stays the engine's to make again:
 * a payment written down as what counted would never count in full again.
 */
export const typedAmount = (c: Pick<CellResult, 'value' | 'estimate' | 'asked'>): Money => c.estimate ?? c.asked ?? c.value

export interface MonthTotals {
  month: MonthKey
  income: Money
  cashExpense: Money
  savingsFunded: Money
  poolFunded: Money
  poolFundedByPool: Record<string, Money>
  /** Spending that comes straight out of a named account (base currency), in all and per account. */
  accountFunded: Money
  accountFundedByAccount: Record<string, Money>
  /**
   * What each source other than the month's income paid, as it was typed: source → currency → amount in that
   * currency. The source is written as it is stored: `savings`, `pool:<id>`, `account:<id>`.
   */
  fundedOwn: Record<string, Record<string, Money>>
  allocations: Money
  allocationsByPool: Record<string, Money>
  toInvestment: Money
  pocket: Money
  /** Paid to loans, and to cards whose payment is the spending. */
  debt: Money
  /**
   * Moved out of the plan by "moves money" rows that name no account with a balance: an outflow of the month that is
   * no expense, and that no account of the household receives. Counted in `cashExpense` too.
   */
  moved: Money
  /**
   * Moved into another of the household's accounts by "moves money" rows that name one (`movesInto`): it leaves the
   * current accounts and arrives there. An outflow of the month, no expense. Counted in `cashExpense` too.
   */
  movedToAccounts: Money
  buffer: Money
  /** Positive = into savings, negative = drawn from savings. */
  toSavings: Money
  leftover: Money
  /** Derived "From savings" row: spending paid from savings, from virtual accounts and from named accounts. */
  fromSavingsDerived: Money
  /** What the month costs: the expense rows, whatever they come out of, and `debt`. Neither `pocket`, `moved` nor `movedToAccounts`. */
  expensesTotal: Money
  transfersTotal: Money
  /** The part of `income` that was taken out of your own accounts by hand (savings, investments): money in, not earned. */
  fromAccounts: Money
  /** Income minus what is deducted from it, without money taken out of accounts: what a share of income counts. */
  takeHome: Money
  /** The same per person or thing the income rows belong to (entity id → amount); a shared income is in nobody's. */
  takeHomeBy: Record<string, Money>
  /** What the month had left for the shares of what is left: after spending, typed amounts, shares of income and the buffer; never below zero. */
  leftForShares: Money
  /** The rest of the month as worked out for the rest row (negative = drawn back); null when nothing takes the rest this month. */
  rest: Money | null
}

export interface AccountMonthResult {
  /** What the month began with, in the account's currency: what the month before ended on, or the opening amount in the account's first month. */
  start: Money
  /** What the engine expects at month end, in the account's currency. */
  computed: Money
  /** A real balance is stored for the end of this month. */
  entered: boolean
  /** Real balance when one was entered, else computed. */
  balance: Money
  adjustment: Money
  /** `balance` in the household base currency at the month's rate; equals `balance` (and warns) when the rate is missing. */
  balanceBase: Money
  missingRate: boolean
  inflow: Money
  outflow: Money
  /** Investment accounts only. */
  capital?: Money
  startValue?: Money
  monthlyReturn?: number
  totalReturn?: number
  /** No real value entered for this month: the number is a projection. */
  projected?: boolean
}

export interface AccountSeries {
  accountId: string
  currency: string
  /** Cards and loans: the balance is money owed. */
  liability: boolean
  /** Left out of net worth (`isOutsideNetWorth`): it has its balance, and no sum of what the household has counts it. */
  outside?: boolean
  months: Record<MonthKey, AccountMonthResult>
}

export interface PoolMonthResult {
  /** What it held when the month began: the month before's balance, or what it was opened with. */
  start: Money
  /** Never below zero: a virtual account that is asked for more than it holds stops at nothing. */
  balance: Money
  allocation: Money
  spend: Money
  /** What the month took beyond what the virtual account held; it came out of the unassigned part of its savings account. */
  short: Money
}

export interface PoolSeries {
  poolId: string
  months: Record<MonthKey, PoolMonthResult>
}

export interface RowTotals {
  total: Money
  shareOfIncome: number
}

export interface MainAccountMonth {
  /** Balance when the month began, in the base currency. */
  start: Money
  /** What the month left in the account: the cash buffer or the leftover. Negative when the month overran. */
  kept: Money
  /** Bought on an itemized card this month: spent on paper, the cash is still here. */
  cardBought: Money
  /** Paid to an itemized card this month. */
  cardPaid: Money
  /** What the plan works out for the end of the month: start + kept + bought on the card − paid to it. */
  computed: Money
  /** Every current account open this month has a real balance: `balance` is their sum, not `computed`. */
  entered: boolean
  /** With `entered`: the real balances together minus `computed`. Zero otherwise. */
  adjustment: Money
  balance: Money
  /** With `entered`: what each account really held, in its own currency and in the base currency. The only month figures the plan has per account. */
  real?: Record<string, { own: Money; base: Money }>
}

/** The current and joint accounts together, as one calculated balance (see `mainAccount.ts`). */
export interface MainAccountSeries {
  /** The current and joint accounts counted, in their own order. */
  accountIds: string[]
  /** An opening balance in another currency had no rate and was taken 1:1. */
  missingRate: boolean
  months: Record<MonthKey, MainAccountMonth>
}

export interface EngineOutput {
  months: MonthKey[]
  /** Visible rows in display order. */
  rows: Row[]
  cells: Record<string, CellResult>
  totals: Record<MonthKey, MonthTotals>
  accounts: Record<string, AccountSeries>
  pools: Record<string, PoolSeries>
  rowTotals: Record<string, RowTotals>
  incomeTotal: Money
  /**
   * What stays in the main account (the current and joint accounts together), worked out from the household's
   * first month on. Null only when there is no household or no month.
   */
  main: MainAccountSeries | null
  /** Tracked assets and the main account's calculated balance, minus tracked debts, in the base currency. */
  netWorth: Record<MonthKey, Money>
  /** Rows whose months are filled by recurring items instead of carry-forward. */
  recurringRowIds: string[]
  /** The savings account that spending "from savings" comes out of; null without a savings account. */
  primarySavingsId: string | null
  warnings: string[]
}

export const cellKey = (rowId: string, month: MonthKey): string => `${rowId}|${month}`
