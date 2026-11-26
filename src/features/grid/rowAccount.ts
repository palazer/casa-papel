import { isOutsideNetWorth, ownBalance, type Account, type Row } from '@/model'
import { accountTypeForRow } from '@/store'
import { txt } from '@/i18n'

const T = txt.grid.rowAccount

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
      return T.goesInto
    case 'from-investment':
    case 'from-savings':
      return T.comesFrom
    case 'debt-payment':
    case 'card-payment':
      return T.paysOff
    case 'pocket-money':
      return T.landsIn
    default:
      return movesMoney(row) ? T.goesInto : row.section === 'income' ? T.paidInto : T.paidFrom
  }
}

export function accountHelp(row: Row): string {
  switch (row.kind) {
    case 'to-savings':
      return T.theSavingsAccountThis
    case 'to-investment':
      return T.theInvestmentAccountThe
    case 'from-investment':
      return T.theInvestmentAccountThe2
    case 'from-savings':
      return T.theSavingsAccountThe
    case 'debt-payment':
    case 'card-payment':
      return T.theLoanOrCard
    case 'pocket-money':
      return T.anAccountOfThis
    default:
      if (movesMoney(row)) return T.theAccountTheMoney
      if (row.section === 'income') return T.whichOfYourAccounts
      return T.anAccountThisExpense
  }
}

/** The accounts a pocket money row can land in: those that net worth leaves out and that have a balance of their own. */
export function landingAccounts(accounts: Account[]): Account[] {
  return accounts.filter((a) => !a.deletedAt && !a.archivedMonth && isOutsideNetWorth(a) && ownBalance(a))
}
