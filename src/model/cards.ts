import type { Account, Row } from './schema'

/**
 * A credit card whose purchases are expense rows paid from it (the account dialog's default). Its payment row only
 * moves money: the engine leaves it out of spending, nobody's own spending counts it, and "Add row" offers it under
 * Transfers. A card in the other mode records only the payment, as an expense. One reading of the setting for every
 * caller, so the engine, the store and the grid never disagree.
 */
export const cardIsItemized = (acc: Pick<Account, 'type' | 'card'>): boolean => acc.type === 'credit-card' && (acc.card?.cardMode ?? 'itemized') === 'itemized'

/**
 * A payment that is part of what the month costs: a loan's, and a card's where only the payment is recorded. Such a
 * row stands with the expenses, in a category like any of them. (Paying a card whose purchases are expense rows only
 * moves money.) `account` is the loan or card the row pays; a row that names none counts as spending.
 */
export const paysAsExpense = (row: Pick<Row, 'kind'>, account: Pick<Account, 'type' | 'card'> | undefined): boolean =>
  row.kind === 'debt-payment' || (row.kind === 'card-payment' && !(account && cardIsItemized(account)))
