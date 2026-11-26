/**
 * What the calculation says outside the Statement's lines: its warnings, why a goal cannot be measured, why an amount
 * would count across three currencies, and the names it gives to what the household has not named.
 */

/** An end of an amount: the account it comes out of, or the one it goes into. */
type Way = 'out-of' | 'into'
const does = (way: Way) => (way === 'out-of' ? 'comes out of' : 'goes into')
const can = (way: Way) => (way === 'out-of' ? 'come out of' : 'go into')

export const engine = {
  warning: {
    followsMissingRow: (row: string) => `"${row}" follows a row that no longer exists.`,
    deductedFromMissingRow: (row: string) => `"${row}" is deducted from a row that no longer exists.`,
    /** `month` is a month key ("2026-09"), `name` the row or account the amount belongs to. */
    noRate: (from: string, to: string, month: string, name: string) => `No ${from}→${to} rate for ${month} (${name})`,
    ownIncomeWithoutAdult: (row: string) => `"${row}" takes a percentage of its adult's own income, but it does not belong to an adult.`,
    shareOfMissingIncome: (row: string, month: string) => `"${row}" takes a percentage of an income line that is no longer there (${month}).`,
    sharesOfRestOver100: 'The percentages of what is left add up to more than 100%.',
  },
  goal: {
    virtualAccountGone: 'The virtual account this goal watched is gone. Edit the goal and pick another.',
    virtualAccountArchived: (name: string) => `The virtual account "${name}" is archived. Restore it under Household or edit the goal.`,
    accountGone: 'The account this goal watched is gone. Edit the goal and pick another.',
    accountArchived: (name: string) => `"${name}" is archived. Restore it under Household or edit the goal.`,
    accountNotTracked: (name: string) => `"${name}" is not tracked. Turn on "Track the balance" in its account settings.`,
  },
  /** The line of what stays in the main account, while no account names it. */
  mainAccount: 'Main account',
  mainAccounts: 'Main accounts',
  /** On the Payments page: an amount with a day and no method, and what nobody in particular pays. */
  noMethod: 'No method',
  household: 'Household',
  /**
   * Why a change would make an amount count across three currencies (rule X15). `row` is the row's name, `home` the
   * household's currency; an account is named with the way the amount meets it.
   */
  thirdCurrency: {
    /** The account's own currency is what changed. */
    accountMoved: (p: { row: string; currency: string; way: Way; account: string; home: string }) =>
      `"${p.row}" is in ${p.currency} and ${does(p.way)} "${p.account}", so "${p.account}" can be in ${p.currency} or in ${p.home}.`,
    /** The amount follows a row in another currency. */
    followedRow: (p: { row: string; way: Way; account: string; accountCurrency: string; home: string; followed: string; currency: string }) =>
      `"${p.row}" ${does(p.way)} "${p.account}", in ${p.accountCurrency}, so it can follow a row in ${p.accountCurrency} or in ${p.home}. "${p.followed}" is in ${p.currency}.`,
    /** The amount's currency is what changed. */
    amountMoved: (p: { row: string; way: Way; account: string; accountCurrency: string; home: string }) =>
      `"${p.row}" ${does(p.way)} "${p.account}", in ${p.accountCurrency}, so it can be in ${p.accountCurrency} or in ${p.home}.`,
    /** The account is new to an amount in another currency. */
    accountNew: (p: { row: string; currency: string; way: Way; home: string; account: string; accountCurrency: string }) =>
      `"${p.row}" is in ${p.currency}, so it can ${can(p.way)} an account in ${p.currency} or in ${p.home}. "${p.account}" is in ${p.accountCurrency}.`,
    /** Between two accounts in other currencies: the second one's currency changed. */
    betweenMoved: (p: { row: string; keptWay: Way; kept: string; keptCurrency: string; way: Way; account: string; home: string }) =>
      `"${p.row}" ${does(p.keptWay)} "${p.kept}", in ${p.keptCurrency}, and ${does(p.way)} "${p.account}", so "${p.account}" can be in ${p.keptCurrency} or in ${p.home}.`,
    /** Between two accounts in other currencies: the second one is new. */
    betweenNew: (p: { row: string; keptWay: Way; kept: string; keptCurrency: string; way: Way; home: string; account: string; accountCurrency: string }) =>
      `"${p.row}" ${does(p.keptWay)} "${p.kept}", in ${p.keptCurrency}, so it can ${can(p.way)} an account in ${p.keptCurrency} or in ${p.home}. "${p.account}" is in ${p.accountCurrency}.`,
  },
}
