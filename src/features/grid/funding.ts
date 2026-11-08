import { poolRef, type FundedBy, type Pool } from '@/model'

/** The choices for "Comes out of": income, savings, then one entry per live pool account. */
export function fundingOptions(pools: Pool[]): Array<{ value: FundedBy; label: string }> {
  return [
    { value: 'cash', label: "This month's income" },
    { value: 'savings', label: 'Savings balance' },
    ...pools.filter((p) => !p.deletedAt).map((p) => ({ value: poolRef(p.id), label: `Pool account: ${p.name}` })),
  ]
}
