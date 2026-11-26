/**
 * What the store says that is not a refusal: the lines of the question about a past month, the steps of the guided
 * setup, the accounts it suggests, and the summary of a file that is about to be imported.
 */
export const store = {
  /** The guided setup's steps, as the bar at the top of the Statement names them. */
  setupStep: { income: 'Income', expenses: 'Expenses', savings: 'Savings', virtual: 'Virtual accounts', investments: 'Investments', debts: 'Loans and cards' },
  /** What a suggested account is for, under its name. */
  suggestedAccount: {
    main: 'The account your income lands in and your bills leave from: the month\'s money runs through it.',
    savings: 'Where the rest of the month can go. Virtual accounts live inside it.',
  },
  /**
   * A line of "This changes months that are over" and of the import preview: what a change does to an amount, a
   * balance or net worth. `span` is a month or a stretch of months, `figures` is `before`.
   */
  change: {
    nothing: 'nothing',
    figures: (before: string, after: string) => `${before} → ${after}`,
    amountChanges: (name: string, span: string, months: number) => `"${name}", ${span}: changes in ${months} months`,
    amountEach: (name: string, span: string, by: string, more: boolean, months: number) => `"${name}", ${span}: ${by} ${more ? 'more' : 'less'} in each of ${months} months`,
    amountFrom: (name: string, from: string, figures: string) => `"${name}" from ${from}: ${figures}`,
    amount: (name: string, span: string, figures: string) => `"${name}", ${span}: ${figures}`,
    balance: (name: string, span: string, figures: string) => `"${name}" at the end of ${span}: ${figures}`,
    netWorth: (span: string, figures: string) => `Net worth at the end of ${span}: ${figures}`,
    sums: (span: string) => `The month's sums, ${span}`,
    andMore: (n: number) => `and ${n} more`,
  },
  /** Under an import preview: the records a list of amounts does not show. */
  otherChanges: (n: number) => `and ${n} other ${n === 1 ? 'change' : 'changes'}: names, settings, notes or schedules`,
}
