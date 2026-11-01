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
  currency: string
  source: CellSource
  status: CellStatus
  items: ResolvedItem[]
  /** Base-currency split of an expense by where the cash comes from. */
  funding: Funding
  missingRate: boolean
  /** The base-currency value used a projected (drifted) rate. */
  rateProjected: boolean
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
}

export interface AccountMonthResult {
  /** What the engine expects at month end, in the account's currency. */
  computed: Money
  /** Real balance when one was entered, else computed. */
  balance: Money
  adjustment: Money
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
  /** Rows whose months are filled by recurring items instead of carry-forward. */
  recurringRowIds: string[]
  warnings: string[]
}

export const cellKey = (rowId: string, month: MonthKey): string => `${rowId}|${month}`
