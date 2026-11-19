import type { Account, Row } from './schema'

/**
 * Which part of the Statement's lower half an account belongs to: the main account is one calculated line (rule B9),
 * the savings accounts, the investment accounts and the other assets each stand under a heading of their own, and
 * what is owed stands under Debts. Cash and the other current accounts (type `joint`: a joint account, a partner's
 * own, one in another currency) are other assets: money held, with a balance of its own. An account moves up and down
 * among those of its own part.
 */
export type AccountGroup = 'current' | 'savings' | 'investment' | 'other' | 'debt'

export function accountGroup(account: Pick<Account, 'type'>): AccountGroup {
  switch (account.type) {
    case 'checking':
      return 'current'
    case 'savings':
      return 'savings'
    case 'investment':
      return 'investment'
    case 'credit-card':
    case 'loan':
      return 'debt'
    default:
      return 'other'
  }
}

/**
 * Whether an expense can come straight out of this account ("Comes out of"): a savings account, an investment
 * account or an other asset, an other current account among them. The main account is the month's income itself, and
 * a card or a loan is named on the row ("Paid with").
 */
export function paysExpenses(account: Pick<Account, 'type'>): boolean {
  const group = accountGroup(account)
  return group === 'savings' || group === 'investment' || group === 'other'
}

/**
 * Whether net worth leaves the account out ("Leave out of net worth" in its form): money that is a person's own. Only
 * an account that holds money with a balance of its own can be left out; the main account is the month's own money,
 * and a debt is owed whoever it is counted for. A record stored before the setting existed has none.
 */
export function isOutsideNetWorth(account: Pick<Account, 'type' | 'outsideNetWorth'>): boolean {
  return (account.outsideNetWorth ?? false) && paysExpenses(account)
}

/**
 * Whether a pocket money row's amount lands in the account it names ("Lands in"). Pocket money is the adult's own, so
 * it lands only where net worth does not count it; any other account a pocket money row names is for the overview.
 */
export function pocketLandsIn(row: Pick<Row, 'kind' | 'accountId'>, account: Pick<Account, 'id' | 'type' | 'outsideNetWorth'> | undefined): boolean {
  return row.kind === 'pocket-money' && !!account && row.accountId === account.id && isOutsideNetWorth(account)
}

/**
 * Whether the plan follows the account's balance month by month: an account whose balance is tracked, and cash and
 * an other current account, which always have one. Both counted with the current accounts once and were stored as
 * untracked then, with no say in it, so their flag says nothing.
 */
export function ownBalance(account: Pick<Account, 'type' | 'tracked'>): boolean {
  return account.tracked || account.type === 'cash' || account.type === 'joint'
}

/**
 * Whether an account holds money with a balance of its own that the plan follows month by month: a savings account,
 * an investment account or an other asset with its own balance (`ownBalance`). The main account is the month's money
 * (its line is worked out from it), and a card or a loan is what is owed.
 */
export function holdsBalance(account: Pick<Account, 'type' | 'tracked'>): boolean {
  return paysExpenses(account) && ownBalance(account)
}

/**
 * Whether a row that "moves money between your accounts" sends its amount into the account it names ("Goes into"):
 * a typed transfer row, and an account with a balance of its own. The money then leaves the main account and
 * arrives there, so net worth stays as it is. A row of this kind that names no such account moves its money out of
 * the plan: no account of the household receives it.
 */
export function movesInto(row: Pick<Row, 'kind' | 'section' | 'accountId'>, account: Pick<Account, 'id' | 'type' | 'tracked'> | undefined): boolean {
  return row.section === 'transfer' && row.kind === 'plain' && !!account && row.accountId === account.id && holdsBalance(account)
}
