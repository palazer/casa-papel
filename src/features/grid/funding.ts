import { primarySavingsOf } from '@/engine'
import { accountGroup, accountRef, paysExpenses, poolRef, type Account, type FundedBy, type Tables } from '@/model'
import { txt } from '@/i18n'

const T = txt.grid.funding

const KINDS = [['savings', T.savingsAccount], ['investment', T.investmentAccount], ['other', T.otherAsset]] as const
const byOrder = (a: Account, b: Account) => (a.order < b.order ? -1 : a.order > b.order ? 1 : 0)

/**
 * The choices for "Comes out of": this month's income, then every account an expense can come straight out of
 * (savings accounts, investment accounts, other assets and cash, each in its own order), then the virtual accounts. An
 * archived one stays only while `keep` (what the row and its items say now) still names it.
 *
 * The old "Savings balance" has always meant the first savings account. While something in `keep` still says it,
 * that account's entry carries the old value, so the choice reads under the account's name and nothing is rewritten
 * until another one is picked; in a household without a savings account it keeps its old name.
 */
export function fundingOptions(tables: Pick<Tables, 'accounts' | 'pools' | 'rows' | 'categories'>, keep: FundedBy[] = []): Array<{ value: FundedBy; label: string }> {
  const old = keep.includes('savings')
  const first = old ? primarySavingsOf(tables) : null
  const accounts = tables.accounts
    .filter((a) => !a.deletedAt && paysExpenses(a) && (!a.archivedMonth || keep.includes(accountRef(a.id)) || a.id === first))
    .sort(byOrder)
  const options: Array<{ value: FundedBy; label: string }> = [{ value: 'cash', label: T.thisMonthsIncome }]
  if (old && !first) options.push({ value: 'savings', label: T.savingsBalance })
  for (const [kind, said] of KINDS) {
    for (const a of accounts) {
      if (accountGroup(a) !== kind) continue
      const ref = accountRef(a.id)
      // cash and an other current account stand with the other assets and are named as what they are
      const label = T.sourceLabel(a.type, said, a.name)
      if (a.id !== first) options.push({ value: ref, label })
      else {
        // both ways of saying the same account in one dialog: each keeps an entry, so neither choice is lost
        const both = keep.includes(ref)
        options.push({ value: 'savings', label: both ? T.savingsBalance2(a.name) : label })
        if (both) options.push({ value: ref, label })
      }
    }
  }
  for (const p of tables.pools) {
    if (!p.deletedAt && (!p.archivedMonth || keep.includes(poolRef(p.id)))) options.push({ value: poolRef(p.id), label: T.virtualAccountNamed(p.name) })
  }
  return options
}
