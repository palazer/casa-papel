import { poolRef, type FundedBy, type Pool } from '@/model'

export const SOURCE_HELP =
  '"Comes out of" is the budget side: this month\'s income (the normal case), the savings balance, or a pool account. Savings and pool accounts do not reduce this month\'s leftover.'

/** The choices for "Comes out of": income, savings, then one entry per live pool account. */
export function fundingOptions(pools: Pool[]): Array<{ value: FundedBy; label: string }> {
  return [
    { value: 'cash', label: "This month's income" },
    { value: 'savings', label: 'Savings balance' },
    ...pools.filter((p) => !p.deletedAt).map((p) => ({ value: poolRef(p.id), label: `Pool account: ${p.name}` })),
  ]
}
