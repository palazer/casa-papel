import type { Row } from '@/model'

/** Menu and dialog wording for a row's account, by what the row does. */
export function accountVerb(row: Row): string {
  switch (row.kind) {
    case 'to-savings':
    case 'to-investment':
      return 'Goes into'
    case 'from-investment':
      return 'Comes from'
    case 'debt-payment':
    case 'card-payment':
      return 'Pays off'
    default:
      return row.section === 'income' ? 'Paid into' : 'Paid from'
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
    case 'debt-payment':
      return 'The loan this row pays down. What is still owed falls by the amount.'
    case 'card-payment':
      return 'The card this row pays off.'
    default:
      return row.section === 'income'
        ? 'Which of your accounts receives it. For your overview only; the sums do not change.'
        : 'Which of your accounts the money leaves. For your overview only, except a credit card in itemized mode: then this spending adds to what the card owes until it is paid.'
  }
}
