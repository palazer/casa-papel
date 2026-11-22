import { buysOnCard, cardIsItemized, paymentKindInfo, sourceForMethod, type Account, type PaymentMethod, type Row, type Tables } from '@/model'

/** What the screens say about a payment method: its words, where it is offered, what follows from choosing it. */

const byOrder = <T extends { order: string }>(a: T, b: T) => (a.order < b.order ? -1 : a.order > b.order ? 1 : 0)

/** What a method says after its name: the account it draws on, and whose it is. */
export function methodDetail(method: Pick<PaymentMethod, 'accountId' | 'ownerEntityId'>, tables: Pick<Tables, 'accounts' | 'entities'>): string {
  const account = tables.accounts.find((a) => a.id === method.accountId)
  const owner = method.ownerEntityId ? tables.entities.find((e) => e.id === method.ownerEntityId)?.name : null
  return `${account && !account.deletedAt ? account.name : 'no account'}${owner ? ` · ${owner}` : ''}`
}

/** The methods that can be chosen now, under the account each draws on: not archived, and on an account that is still open. `keep` stays offered whatever it is. */
export function methodGroups(tables: Pick<Tables, 'paymentMethods' | 'accounts'>, keep: string | null = null): Array<{ account: string; methods: PaymentMethod[] }> {
  const accounts = tables.accounts.filter((a) => !a.deletedAt).sort((a, b) => (a.type === 'checking' ? 0 : 1) - (b.type === 'checking' ? 0 : 1) || byOrder(a, b))
  const groups: Array<{ account: string; methods: PaymentMethod[] }> = []
  for (const account of accounts) {
    const methods = tables.paymentMethods
      .filter((m) => !m.deletedAt && m.accountId === account.id && (m.id === keep || (!m.archived && !account.archivedMonth)))
      .sort(byOrder)
    if (methods.length) groups.push({ account: account.name, methods })
  }
  return groups
}

/** A method as a few words: its name, and what kind it is where the name does not say. */
export const methodWords = (m: PaymentMethod): string => {
  const kind = paymentKindInfo(m.kind).label
  return m.name.toLowerCase().includes(kind.toLowerCase()) ? m.name : `${m.name} (${kind.toLowerCase()})`
}

/** What follows from paying a row's amounts with a method, in a sentence each: the card it is then bought on, the account it then comes out of. */
export function methodEffects(method: PaymentMethod | null, row: Pick<Row, 'section' | 'kind'>, accounts: ReadonlyMap<string, Account>): string[] {
  const account = method ? accounts.get(method.accountId) : undefined
  if (!account || !buysOnCard(row)) return []
  if (account.type === 'credit-card') {
    return [cardIsItemized(account)
      ? `Bought on "${account.name}": the amount is owed there until the card is paid.`
      : `"${account.name}" records only its payments, so what is owed on it does not move.`]
  }
  return sourceForMethod(method, accounts) ? [`Paid from "${account.name}", so the amount comes out of that account too.`] : []
}
