import type { Row } from './schema'

/**
 * A row that pays a loan or a card off, whichever of the two it was made for (the two kinds are stored apart, and read
 * alike). It brings down what is owed on the account it names, counts as an expense of its month, and stands with the
 * expenses in a category like any of them (rule C1). A card is a debt and nothing else: what is bought with a card is
 * an expense row like any other, and that it was paid with the card is a payment method's label.
 */
export const isPayOffRow = (row: Pick<Row, 'kind'>): boolean => row.kind === 'debt-payment' || row.kind === 'card-payment'
