import { isOutsideNetWorth, ownBalance, type Account, type Row } from '@/model'
import { accountTypeForRow } from '@/store'

/**
 * An ordinary expense row names no account. Which account its money comes out of is "Comes out of", the main account
 * is the month's income itself, and that it is paid with a card is a payment method's label ("Usually paid…"). One
 * that still names an account (a card it was bought on before schema 23, or an account kept for the overview) can
 * only have it taken off.
 */
export function namesNoAccount(row: Pick<Row, 'kind' | 'section'>): boolean {
  return row.section === 'expense' && accountTypeForRow(row) == null
}

/** Whether the row menu has anything to offer under a row's account: an ordinary expense only while it still names one. */
export function hasAccountChoice(row: Row): boolean {
  return !namesNoAccount(row) || row.accountId != null
}

/** A row that "moves money between your accounts": a typed transfer row. The account it names receives the money. */
export function movesMoney(row: Pick<Row, 'kind' | 'section'>): boolean {
  return row.section === 'transfer' && row.kind === 'plain'
}

/** Menu and dialog wording for a row's account, by what the row does. */
export function accountVerb(row: Row): string {
  switch (row.kind) {
    case 'to-savings':
    case 'to-investment':
      return 'Goes into'
    case 'from-investment':
    case 'from-savings':
      return 'Comes from'
    case 'debt-payment':
    case 'card-payment':
      return 'Pays off'
    case 'pocket-money':
      return 'Lands in'
    default:
      return movesMoney(row) ? 'Goes into' : row.section === 'income' ? 'Paid into' : 'Paid from'
  }
}

export function accountHelp(row: Row): string {
  switch (row.kind) {
    case 'to-savings':
      return 'The savings account this amount lands in. Its balance under Balances moves with this row.'
    case 'to-investment':
      return 'The investment account the deposits go to. Its value, deposited total and return follow this row.'
    case 'from-investment':
      return 'The investment account the money is taken out of.'
    case 'from-savings':
      return 'The savings account the money is taken out of. Its balance under Balances falls by the amount.'
    case 'debt-payment':
    case 'card-payment':
      return 'The loan or card this row pays down. What is still owed falls by the amount, and the payment stops at what is owed.'
    case 'pocket-money':
      return 'An account of this adult\'s own that net worth leaves out. The pocket money raises its balance each month; it still leaves the month, and "Per person" still counts it. With "Nowhere" the app does not follow it.'
    default:
      if (movesMoney(row)) return 'The account the money goes into: its balance rises by the amount, and net worth stays as it is. With no account the money leaves the plan, and net worth falls by it. The main account is not listed: the money comes out of it.'
      if (row.section === 'income') return 'Which of your accounts receives it. For your overview only; the sums do not change.'
      return 'An account this expense still names, for your overview only: the sums do not change, and it can only be taken off. Where the money comes out of is "Comes out of…", and that it is paid with a card is said under "Usually paid…".'
  }
}

/** The accounts a pocket money row can land in: those that net worth leaves out and that have a balance of their own. */
export function landingAccounts(accounts: Account[]): Account[] {
  return accounts.filter((a) => !a.deletedAt && !a.archivedMonth && isOutsideNetWorth(a) && ownBalance(a))
}
