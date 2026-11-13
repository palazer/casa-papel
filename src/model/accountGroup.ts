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
