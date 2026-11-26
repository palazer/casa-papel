/**
 * What the Statement's calculation writes itself (`src/engine/statement.ts`): the headings of its two halves, the lines
 * it works out, the small words after a figure, and what a link between a row and its account says. Names of rows,
 * accounts and categories are the household's own and are not here.
 */
export const statement = {
  side: { in: 'Money in', out: 'Money out', assets: 'Assets', claims: 'Debts and net worth' },
  group: {
    income: 'Income', fromAccounts: 'From accounts', expenses: 'Expenses', moved: 'Moved elsewhere', fromWhatIsLeft: 'From what is left',
    savingsAccounts: 'Savings accounts', investmentAccounts: 'Investment accounts', otherAssets: 'Other assets', debts: 'Debts', netWorth: 'Net worth',
  },
  /** A line under "From accounts" leads with where the money comes from. */
  from: {
    named: (account: string) => `From ${account}`,
    savings: 'From savings',
    investments: 'From investments',
    removedVirtualAccount: 'From a removed virtual account',
    theAccount: 'From the account',
  },
  /** The kind of account, said in grey after a line's name where the name alone may not say it. */
  kind: { virtualAccount: 'virtual account', mainAccount: 'main account', currentAccount: 'current account' },
  /** An item that has no label of its own. */
  item: 'Amount',
  noCategory: 'No category',
  notBrokenDown: 'Not broken down yet',
  chip: {
    automatic: 'automatic', theRest: 'the rest', paidOff: 'paid off', leavesThePlan: 'leaves the plan',
    calculated: 'calculated', toCoverTheMonth: 'to cover the month', countedTogether: 'counted together',
  },
  toSavings: 'To savings',
  keptInAccount: 'Kept in account',
  leftover: 'Leftover',
  /** The parts under the main account's line, and under a debt's. */
  parts: {
    atTheStart: 'At the start of the month', keptThisMonth: 'Kept this month', shortThisMonth: 'Short this month', notInThePlan: 'Not in the plan',
    paid: 'Paid', drawnAgain: 'Drawn again',
  },
  notChecked: 'not checked against the statement',
  notSetAside: 'Not set aside',
  moreSetAsideThanHeld: 'more is set aside than the account holds',
  setAside: 'Set aside',
  free: 'Free',
  /** What the link symbol says: on a row, where its money goes or comes from; on an account, the rows at its other end. */
  link: {
    paysOff: (target: string) => `Pays off ${target}`,
    comesFrom: (target: string) => `Comes from ${target}`,
    fills: (target: string) => `Fills ${target}`,
    landsIn: (target: string) => `Lands in ${target}`,
    goesInto: (target: string) => `Goes into ${target}`,
    paidOffBy: (rows: string) => `Paid off by ${rows}`,
    filledBy: (rows: string) => `Filled by ${rows}`,
    moneyTakenBy: (rows: string) => `Money taken by ${rows}`,
    noRowPaysOff: (account: string) => `No row pays off ${account} yet`,
  },
  warning: {
    shareOfMissingIncome: (row: string) => `"${row}" takes a percentage of an income line that is no longer there, so it gets nothing.`,
    restHasNoRow: 'The rest of the month has no "To savings" row to go to.',
  },
}
