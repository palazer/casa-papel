/**
 * Names the app writes into a household: they are stored, so they read in the language the device had when they were
 * made, and a later change of language leaves them alone.
 */
export const names = {
  /** The six expense categories most households use, in grid order. */
  category: {
    housing: 'Housing',
    living: 'Living',
    transport: 'Transport',
    family: 'Family & pets',
    fun: 'Fun',
    personal: 'Personal',
  },
  /** The row that fills a virtual account. */
  poolRow: (pool: string) => `To ${pool}`,
  /** A row that was given no name: after the account it takes from, pays off or goes into. */
  rowFrom: (account: string) => `From ${account}`,
  rowPaysOff: (account: string) => `${account} – Payment`,
  rowTo: (account: string) => `To ${account}`,
  /** What is left of a category's estimate. */
  estimateRow: (category: string) => `${category} – Not broken down yet`,
  /** The account and the rows a household starts with when it is made in one step. */
  starter: { savings: 'Savings', salary: 'Salary', otherIncome: 'Other income', rent: 'Rent', groceries: 'Groceries', other: 'Other', toSavings: 'To savings' },
  /** The payment methods a household is offered to start with; one per credit card is named after the card. */
  starterMethod: { directDebit: 'Direct debit', standingOrder: 'Standing order', transfer: 'Transfer by hand', cash: 'Cash' },
  /** The accounts the Statement suggests to a household that has none. */
  suggested: { mainAccount: 'Main account', savings: 'Savings' },
  /** The items a top-up writes: into the row that takes the money out, and into the row that fills the virtual account. */
  topUp: {
    forPool: (pool: string) => `Top-up for ${pool}`,
    fromAccount: (account: string) => `Top-up from ${account}`,
    fromIncome: 'Top-up from this month\'s income',
  },
}
