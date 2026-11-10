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
  savings: Money
  pools: Record<string, Money>
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
  missingRate: boolean
  /** The base-currency value used a projected (drifted) rate. */
  rateProjected: boolean
  /**
   * A category's estimate row only: what was typed for the whole category, in the row's currency and in the base
   * currency. `value` and `valueBase` are what its other rows have not explained yet.
   */
  estimate?: Money
  estimateBase?: Money
  cell: Cell | null
}

export interface MonthTotals {
  month: MonthKey
  closed: boolean
  income: Money
  cashExpense: Money
  savingsFunded: Money
  poolFunded: Money
  poolFundedByPool: Record<string, Money>
  allocations: Money
  allocationsByPool: Record<string, Money>
  toInvestment: Money
  pocket: Money
  pocketTotal: Money
  debt: Money
  buffer: Money
  /** Positive = into savings, negative = drawn from savings. */
  toSavings: Money
  leftover: Money
  /** Derived "From savings" row: savings- and pool-funded spend. */
  fromSavingsDerived: Money
  expensesTotal: Money
  transfersTotal: Money
  /** The part of `income` that was taken out of your own accounts by hand (savings, investments): money in, not earned. */
  fromAccounts: Money
  /** Income minus what is deducted from it, without money taken out of accounts: what a share of income counts. */
  takeHome: Money
  /** What the month had left for the shares of what is left: after spending, typed amounts, shares of income and the buffer; never below zero. */
  leftForShares: Money
  /** The rest of the month as worked out for the rest row (negative = drawn back); null when nothing takes the rest this month. */
  rest: Money | null
}

export interface AccountMonthResult {
  /** What the engine expects at month end, in the account's currency. */
  computed: Money
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
  months: Record<MonthKey, AccountMonthResult>
}

export interface PoolMonthResult {
  balance: Money
  allocation: Money
  spend: Money
}

export interface PoolSeries {
  poolId: string
  months: Record<MonthKey, PoolMonthResult>
}

export interface RowTotals {
  total: Money
  shareOfIncome: number
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
  /** Tracked assets minus tracked debts, in the base currency. */
  netWorth: Record<MonthKey, Money>
  /** Rows whose months are filled by recurring items instead of carry-forward. */
  recurringRowIds: string[]
  warnings: string[]
}

export const cellKey = (rowId: string, month: MonthKey): string => `${rowId}|${month}`
