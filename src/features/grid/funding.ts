import { poolRef, type FundedBy, type Pool } from '@/model'

/** The choices for "Comes out of": income, savings, then one entry per live virtual account. An archived one stays only while `keep` still names it. */
export function fundingOptions(pools: Pool[], keep: FundedBy[] = []): Array<{ value: FundedBy; label: string }> {
  return [
    { value: 'cash', label: "This month's income" },
    { value: 'savings', label: 'Savings balance' },
    ...pools.filter((p) => !p.deletedAt && (!p.archivedMonth || keep.includes(poolRef(p.id)))).map((p) => ({ value: poolRef(p.id), label: `Virtual account: ${p.name}` })),
  ]
}
