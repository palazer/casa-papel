import type { Account, Row } from '@/model'
import { accountTypeForRow } from '@/store'

/**
 * An ordinary expense row names one thing: the credit card it is bought on. Which account its money comes out of is
 * "Comes out of", and a current account is the month's income itself, so no other account is offered here.
 */
export function paysByCard(row: Pick<Row, 'kind' | 'section'>): boolean {
  return row.section === 'expense' && accountTypeForRow(row) == null
}

/** Whether the row menu has anything to offer under a row's account: a row paid by card needs a card, or an account it still names. */
export function hasAccountChoice(row: Row, accounts: Account[]): boolean {
  return !paysByCard(row) || row.accountId != null || accounts.some((a) => !a.deletedAt && !a.archivedMonth && a.type === 'credit-card')
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
    default:
      return row.section === 'income' ? 'Paid into' : paysByCard(row) ? 'Paid by card' : 'Paid from'
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
      return 'The loan this row pays down. What is still owed falls by the amount.'
    case 'card-payment':
      return 'The card this row pays off.'
    default:
      if (row.section === 'income') return 'Which of your accounts receives it. For your overview only; the sums do not change.'
      return paysByCard(row)
        ? 'The credit card this is bought on. On a card where everything you buy is recorded, the spending adds to what you owe on it until it is paid. An expense that comes straight out of a savings account, an investment account or another asset is set under "Comes out of…" in the row menu instead.'
        : 'Which of your accounts the money leaves. For your overview only; the sums do not change.'
  }
}
