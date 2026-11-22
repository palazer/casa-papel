import { methodNote, type PaymentMethod, type Tables } from '@/model'

/** What the screens say about a payment method: the words after its name, and where it is offered. */

const byOrder = <T extends { order: string }>(a: T, b: T) => (a.order < b.order ? -1 : a.order > b.order ? 1 : 0)

/** What a method says after its name: its note, and whose it is. Empty where it has neither. */
export function methodDetail(method: Pick<PaymentMethod, 'note' | 'accountId' | 'ownerEntityId'>, tables: Pick<Tables, 'accounts' | 'entities'>): string {
  const note = methodNote(method, tables.accounts).trim()
  const owner = method.ownerEntityId ? tables.entities.find((e) => e.id === method.ownerEntityId && !e.deletedAt)?.name : null
  return [note, owner].filter(Boolean).join(' · ')
}

/** The methods that can be chosen now, in the list's own order: the ones that are not archived. `keep` stays offered whatever it is. */
export function methodChoices(tables: Pick<Tables, 'paymentMethods'>, keep: string | null = null): PaymentMethod[] {
  return tables.paymentMethods.filter((m) => !m.deletedAt && (m.id === keep || !m.archived)).sort(byOrder)
}

/** A method as one choice of a list: its name, and its note where it has one ("PayPal · main account"). */
export function methodOption(method: PaymentMethod, tables: Pick<Tables, 'accounts'>): string {
  const note = methodNote(method, tables.accounts).trim()
  return `${method.name}${note ? ` · ${note}` : ''}${method.archived ? ' (archived)' : ''}`
}
