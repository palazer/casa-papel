import type { Account } from './schema'

/**
 * A credit card whose purchases are expense rows paid from it (the account dialog's default). Its payment row only
 * moves money: the engine leaves it out of spending, the split charges nobody for it, and "Add row" offers it under
 * Transfers. A card in the other mode records only the payment, as an expense. One reading of the setting for every
 * caller, so the engine, the store and the grid never disagree.
 */
export const cardIsItemized = (acc: Pick<Account, 'type' | 'card'>): boolean => acc.type === 'credit-card' && (acc.card?.cardMode ?? 'itemized') === 'itemized'
