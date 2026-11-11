import { useState, type KeyboardEvent } from 'react'
import { Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useStore } from '@/app/store'
import type { Account, Category, Household, Row, Section, Tables } from '@/model'
import { addRow, addRowOfKind, rowTargets, type ExpenseRowKind, type TransferRowKind } from '@/store'
import { NativeSelect } from '@/components/NativeSelect'

type Choice = TransferRowKind | ExpenseRowKind
type Targets = ReturnType<typeof rowTargets>
interface Target { id: string; name: string }

/** One answer to "what does the new row do": its sentence, where its targets come from, what to say when there are none. */
interface Kind {
  key: Choice
  section: 'expense' | 'transfer'
  label: string
  text: string
  /** The accounts, virtual accounts or adults the row can point at; null when it points at nothing. */
  targets: ((t: Targets) => Target[]) | null
  targetLabel: 'Account' | 'Virtual account' | 'Adult'
  /** Which field of the store's input the target fills. */
  field: 'accountId' | 'poolId' | 'adultId'
  /** What to add first when there is no target. */
  empty: (t: Targets) => string
  /** Offered only while it makes sense: a second plug row never does, a pool row only for a pool that lost its own. */
  offered?: (t: Targets) => boolean
}

const withType = (a: Account): Target => ({ id: a.id, name: `${a.name} · ${a.type === 'loan' ? 'Loan' : 'Credit card'}` })

/** Every choice, by section, in the order the select shows them. The store applies the same lists and rules in `addRowOfKind`. */
const KINDS: Kind[] = [
  { key: 'plain', section: 'transfer', label: 'Moves money between your accounts', text: 'An amount you type each month. It is not spending, so it never counts as an expense.', targets: null, targetLabel: 'Account', field: 'accountId', empty: () => '' },
  { key: 'to-savings', section: 'transfer', label: 'Goes into a savings account', text: 'An amount you type; that savings balance under Balances rises with it. Its rule can make it a percentage instead.', targets: (t) => t.savings, targetLabel: 'Account', field: 'accountId', empty: () => 'Add a savings account under Household first.' },
  { key: 'to-investment', section: 'transfer', label: 'Deposits into an investment account', text: 'The account\'s value, deposited total and return under Balances follow this row.', targets: (t) => t.investments, targetLabel: 'Account', field: 'accountId', empty: () => 'Add an investment account under Household first.' },
  { key: 'pool-allocation', section: 'transfer', label: 'Fills a virtual account', text: 'For a virtual account that lost its row: the amount lands in the virtual account every month.', targets: (t) => t.orphanPools, targetLabel: 'Virtual account', field: 'poolId', empty: () => '', offered: (t) => t.orphanPools.length > 0 },
  { key: 'pocket-money', section: 'transfer', label: 'Pocket money for an adult', text: 'Money that adult spends freely each month: an amount you type, or a percentage through its rule.', targets: (t) => t.adults, targetLabel: 'Adult', field: 'adultId', empty: () => 'Add an adult under Household first.' },
  { key: 'from-savings', section: 'transfer', label: 'Taken from a savings account', text: 'Money you move out of that savings account into the month, to fill a gap or to top up a virtual account. Its balance falls by the amount, and the month has that much more.', targets: (t) => t.savings, targetLabel: 'Account', field: 'accountId', empty: () => 'Add a savings account under Household first.' },
  { key: 'from-investment', section: 'transfer', label: 'Taken from an investment account', text: 'Money you take out of that investment account into the month. Its value falls by the amount, and the month has that much more.', targets: (t) => t.investments, targetLabel: 'Account', field: 'accountId', empty: () => 'Add an investment account under Household first.' },
  { key: 'card-payment', section: 'transfer', label: 'Pays off a credit card', text: 'For a card whose purchases are expense rows: the payment only moves money, and what is owed on the card falls by it.', targets: (t) => t.cardsItemized, targetLabel: 'Account', field: 'accountId', empty: () => '', offered: (t) => t.cardsItemized.length > 0 },
  { key: 'plain', section: 'expense', label: 'A normal expense', text: 'Spending you type each month, as one amount or a list of items.', targets: null, targetLabel: 'Account', field: 'accountId', empty: () => '' },
  {
    key: 'pay-off', section: 'expense', label: 'Pays off a loan or card', text: 'Each payment brings down what is owed on the loan or card you pick; what is still owed shows under Balances.',
    targets: (t) => t.payoff.map(withType), targetLabel: 'Account', field: 'accountId',
    empty: (t) => (t.cardsItemized.length > 0
      ? 'Purchases on your card are recorded as expense rows, so its payment is a transfer: add it under Transfers with "Pays off a credit card".'
      : 'Add a loan or credit card account under Household first.'),
  },
]

/**
 * "Add row" at the foot of a section: a name, a category when the section has any, and under Transfers and Expenses what
 * the row does. The Statement also puts one inside each category: `defaultCategoryId` starts it there, `label` names
 * the button ("Add row to Housing"), and `onAdded` hands back the new row so the screen can open it. Where the place
 * says what the row does (the Statement's "Taken from accounts"), `only` narrows the choices to those, and `without`
 * leaves out the ones that have a place of their own.
 */
export function AddRowInline({ section, categories, tables, household, onError, defaultCategoryId = '', label, onAdded, only, without }: {
  section: Section; categories: Category[]; tables: Tables; household: Household; onError: (msg: string) => void
  defaultCategoryId?: string; label?: string; onAdded?: (row: Row) => void
  only?: Choice[]; without?: Choice[]
}) {
  const store = useStore()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [categoryId, setCategoryId] = useState(defaultCategoryId)
  const [choice, setChoice] = useState<Choice>('plain')
  const [targetId, setTargetId] = useState('')

  // the lists and rules the store applies in addRowOfKind, so what is offered is what is accepted
  const t = rowTargets(tables, household)
  const kinds = KINDS.filter((k) => k.section === section && (k.offered?.(t) ?? true) && (!only || only.includes(k.key)) && !without?.includes(k.key))
  // a choice that is no longer offered (the plug got its row, the pool was filled elsewhere) falls back to the first one
  const kind: Kind | undefined = kinds.find((k) => k.key === choice) ?? kinds[0]
  const targets = kind?.targets?.(t) ?? null
  const chosen = targets ? (targets.find((x) => x.id === targetId) ?? targets[0]) : undefined
  const missing = kind && targets && targets.length === 0 ? kind.empty(t) : null

  const reset = () => {
    setName('')
    setCategoryId(defaultCategoryId)
    setChoice('plain')
    setTargetId('')
    setOpen(false)
  }

  async function save() {
    const n = name.trim()
    if (!n || missing) return
    try {
      let row: Row
      if (kind) {
        const id = chosen?.id ?? null
        row = await addRowOfKind(store, {
          section: kind.section, name: n, categoryId: categoryId || null, kind: kind.key,
          accountId: kind.field === 'accountId' ? id : null,
          poolId: kind.field === 'poolId' ? id : null,
          adultId: kind.field === 'adultId' ? id : null,
        })
      } else {
        row = await addRow(store, { name: n, section, categoryId: categoryId || null })
      }
      reset()
      onAdded?.(row)
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Could not add row')
    }
  }

  if (!open) {
    return (
      <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={() => setOpen(true)} aria-label={label ?? `Add ${section} row`}>
        <Plus /> {label ?? 'Add row'}
      </Button>
    )
  }
  const keys = (e: KeyboardEvent<HTMLInputElement>) => { if (e.key === 'Enter') void save(); if (e.key === 'Escape') reset() }
  return (
    <div className="flex flex-wrap items-center gap-1">
      <Input autoFocus className="h-7 w-44" placeholder="Row name" value={name} aria-label={`New ${section} row name`} onChange={(e) => setName(e.target.value)} onKeyDown={keys} />
      {categories.length > 0 && (
        <NativeSelect aria-label={`Category for the new ${section} row`} className="h-7" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
          <option value="">No category</option>
          {[...categories].sort((a, b) => (a.order < b.order ? -1 : a.order > b.order ? 1 : 0)).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </NativeSelect>
      )}
      {kind && kinds.length > 1 && (
        <NativeSelect aria-label={`What the new ${section} row does`} className="h-7" value={kind.key} onChange={(e) => { setChoice(e.target.value as Choice); setTargetId('') }}>
          {kinds.map((k) => <option key={k.key} value={k.key}>{k.label}</option>)}
        </NativeSelect>
      )}
      {kind && targets && targets.length > 0 && (
        <NativeSelect aria-label={`${kind.targetLabel} for the new ${section} row`} className="h-7" value={chosen?.id ?? ''} onChange={(e) => setTargetId(e.target.value)}>
          {targets.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
        </NativeSelect>
      )}
      <Button size="sm" onClick={() => void save()} disabled={!!missing}>Add</Button>
      <Button size="sm" variant="ghost" onClick={reset}>Cancel</Button>
      {kind && kinds.length > 1 && <p className="basis-full text-xs text-muted-foreground">{missing ?? kind.text}</p>}
    </div>
  )
}
