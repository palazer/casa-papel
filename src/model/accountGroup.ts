import type { Account } from './schema'

/**
 * Which part of the Statement's lower half an account belongs to: the current accounts are one calculated line, the
 * savings accounts, the investment accounts and the other assets each stand under a heading of their own, and what
 * is owed stands under Debts. An account moves up and down among those of its own part.
 */
export type AccountGroup = 'current' | 'savings' | 'investment' | 'other' | 'debt'

export function accountGroup(account: Pick<Account, 'type'>): AccountGroup {
  switch (account.type) {
    case 'checking':
    case 'joint':
    case 'cash':
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
 * account or an other asset. A current account is the month's income itself, and a card or a loan is named on the
 * row ("Paid with").
 */
export function paysExpenses(account: Pick<Account, 'type'>): boolean {
  const group = accountGroup(account)
  return group === 'savings' || group === 'investment' || group === 'other'
}

/** What such an account is called beside its name: "savings account", "investment account", "other asset". */
export function payingKind(account: Pick<Account, 'type'>): string {
  const group = accountGroup(account)
  return group === 'savings' ? 'savings account' : group === 'investment' ? 'investment account' : 'other asset'
}
