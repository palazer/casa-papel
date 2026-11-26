/** The question about the one main account. */
export const main = {
  question: {
    whichIsYourMain: 'Which is your main account?',
    oneMainAccount: 'One main account',
    theMonthsMoneyNow: (base: string) => `The month's money now runs through one account, in ${base}. The others keep a balance of their own: money is moved to them with a transfer row, and expenses can come out of them.`,
    mainAccount: 'Main account',
    whatChanges: 'What changes',
    isTheMainAccount: (name: string) => `"${name}" is the main account.`,
    noneOfThemIs: (base: string) => `None of them is in ${base}: the month's money stays on the line "Main account" until you add one.`,
    isInItKeeps: (name: string, currency: string) => `"${name}" is in ${currency}: it keeps its own balance, and its worth moves with the rate.`,
    netWorthStays: (foreign: number) => `Net worth stays as it was${foreign ? ', but for what the rate does' : ''}.`,
    ok: 'OK',
  },
}
