import { useState, type KeyboardEvent, type ReactNode } from 'react'
import { Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useStore } from '@/app/store'
import type { Account, AccountType, Category, Household, MonthKey, Row, Section, Tables } from '@/model'
import { addRow, addRowOfKind, payOffKind, rowNameFor, rowTargets, type AccountRowInput, type ExpenseRowKind, type TransferRowKind } from '@/store'
import { NativeSelect } from '@/components/NativeSelect'
import { cn } from '@/lib/utils'
import { HouseholdAccountDialog } from '@/features/household/HouseholdAccountDialog'
import { PoolDialog } from '@/features/household/PoolsCard'

type Choice = TransferRowKind | ExpenseRowKind
type Targets = ReturnType<typeof rowTargets>
interface Target { id: string; name: string }
/** A place the row can go to that does not exist yet: the last entries of the target list. */
interface New { type: AccountType | 'pool'; label: string; thing: string }

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
  /** What can be made from the form, with the row, when nothing fits or another one is wanted. */
  create?: New[]
  /** What to add first when there is no target and none can be made here. */
  empty: (t: Targets) => string
  /** Offered only while it makes sense: a second plug row never does, a pool row only for a pool that lost its own. */
  offered?: (t: Targets) => boolean
}

const withType = (a: Account): Target => ({ id: a.id, name: `${a.name} · ${a.type === 'loan' ? 'Loan' : 'Credit card'}` })
const NEW = {
  savings: { type: 'savings', label: 'New savings account…', thing: 'savings account' },
  investment: { type: 'investment', label: 'New investment account…', thing: 'investment account' },
  loan: { type: 'loan', label: 'New loan…', thing: 'loan' },
  card: { type: 'credit-card', label: 'New credit card…', thing: 'credit card' },
  pool: { type: 'pool', label: 'New virtual account…', thing: 'virtual account' },
} satisfies Record<string, New>

const K = {
  moves: { key: 'plain', section: 'transfer', label: 'Moves money between your accounts', text: 'An amount you type each month. It is not spending, so it never counts as an expense.', targets: null, targetLabel: 'Account', field: 'accountId', empty: () => '' },
  toSavings: { key: 'to-savings', section: 'transfer', label: 'Goes into a savings account', text: 'An amount you type; that savings balance under Balances rises with it. Its rule can make it a percentage instead.', targets: (t) => t.savings, targetLabel: 'Account', field: 'accountId', create: [NEW.savings], empty: () => '' },
  toInvestment: { key: 'to-investment', section: 'transfer', label: 'Deposits into an investment account', text: 'The account\'s value, deposited total and return under Balances follow this row.', targets: (t) => t.investments, targetLabel: 'Account', field: 'accountId', create: [NEW.investment], empty: () => '' },
  pool: { key: 'pool-allocation', section: 'transfer', label: 'Fills a virtual account', text: 'For a virtual account that lost its row: the amount lands in the virtual account every month.', targets: (t) => t.orphanPools, targetLabel: 'Virtual account', field: 'poolId', empty: () => '', offered: (t) => t.orphanPools.length > 0 },
  pocket: { key: 'pocket-money', section: 'transfer', label: 'Pocket money for an adult', text: 'Money that adult spends freely each month: an amount you type, or a percentage through its rule.', targets: (t) => t.adults, targetLabel: 'Adult', field: 'adultId', empty: () => 'Add an adult under Household first.' },
  fromSavings: { key: 'from-savings', section: 'transfer', label: 'Taken from a savings account', text: 'Money you move out of that savings account into the month, to fill a gap or to top up a virtual account. Its balance falls by the amount, and the month has that much more.', targets: (t) => t.savings, targetLabel: 'Account', field: 'accountId', create: [NEW.savings], empty: () => '' },
  fromInvestment: { key: 'from-investment', section: 'transfer', label: 'Taken from an investment account', text: 'Money you take out of that investment account into the month. Its value falls by the amount, and the month has that much more.', targets: (t) => t.investments, targetLabel: 'Account', field: 'accountId', create: [NEW.investment], empty: () => '' },
  cardPayment: { key: 'card-payment', section: 'transfer', label: 'Pays off a credit card', text: 'For a card whose purchases are expense rows: the payment only moves money, and what is owed on the card falls by it.', targets: (t) => t.cardsItemized, targetLabel: 'Account', field: 'accountId', empty: () => '', offered: (t) => t.cardsItemized.length > 0 },
  expense: { key: 'plain', section: 'expense', label: 'A normal expense', text: 'Spending you type each month, as one amount or a list of items.', targets: null, targetLabel: 'Account', field: 'accountId', empty: () => '' },
  payOff: { key: 'pay-off', section: 'expense', label: 'Pays off a loan or card', text: 'Each payment brings down what is owed on the loan or card you pick; what is still owed shows under Balances.', targets: (t) => t.payoff.map(withType), targetLabel: 'Account', field: 'accountId', create: [NEW.loan, NEW.card], empty: () => '' },
} satisfies Record<string, Kind>

/** Every choice of the Grid, by section, in the order the select shows them. The store applies the same lists and rules in `addRowOfKind`. */
const KINDS: Kind[] = [K.moves, K.toSavings, K.toInvestment, K.pool, K.pocket, K.fromSavings, K.fromInvestment, K.cardPayment, K.expense, K.payOff]

/**
 * The Statement's "Set aside, pay off": what such a row can be for, the places money is put first. Every card and loan
 * is paid off from here, whichever section its row lives in, and a virtual account can be made on the spot once there
 * is a savings account to hold it.
 */
const SET_ASIDE: Kind[] = [
  K.toSavings,
  K.toInvestment,
  { ...K.pool, text: 'Money set aside inside a savings account for one purpose. A new virtual account comes with its own row.', create: [NEW.pool], offered: (t) => t.savings.length > 0 || t.orphanPools.length > 0 },
  { ...K.payOff, targets: (t) => [...t.payoff, ...t.cardsItemized].map(withType) },
  K.pocket,
  K.moves,
]

const newValue = (n: New) => `new:${n.type}`

/**
 * "Add row" at the foot of a section: a name, a category when the section has any, and under Transfers and Expenses what
 * the row does. The Statement also puts one inside each category: `defaultCategoryId` starts it there, `label` names
 * the button ("Add row to Housing"), and `onAdded` hands back the new row so the screen can open it. Where the place
 * says what the row does (the Statement's "From accounts"), `only` narrows the choices to those, and `without`
 * leaves out the ones that have a place of their own. `place="set-aside"` is the Statement's "Set aside, pay off":
 * the form asks first what the row is for.
 *
 * A row that names an account never dead-ends on a missing one: the list of accounts ends with "New loan…" (or the
 * type that fits), and Add then opens the account's form, which makes the account and the row in one step. Such a row
 * may also be left without a name; it is called after its account.
 *
 * On the Statement the control stands on the rows' own columns: `lead` takes the place of the button's "+" (it carries
 * the columns a row has before its name), and `formClassName` starts the open form on the names' column.
 */
export function AddRowInline({ section, categories, tables, household, onError, defaultCategoryId = '', label, onAdded, only, without, place, month, lead, leadClassName, formClassName }: {
  section: Section; categories: Category[]; tables: Tables; household: Household; onError: (msg: string) => void
  defaultCategoryId?: string; label?: string; onAdded?: (row: Row) => void
  only?: Choice[]; without?: Choice[]
  place?: 'set-aside'
  /** The month a new virtual account's monthly amount starts in; this month when left out. */
  month?: MonthKey
  lead?: ReactNode
  /** The button's classes when it carries a `lead`: its gap, and no padding of its own before the lead. */
  leadClassName?: string
  formClassName?: string
}) {
  const store = useStore()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [categoryId, setCategoryId] = useState(defaultCategoryId)
  const [choice, setChoice] = useState<Choice | null>(null)
  const [targetId, setTargetId] = useState('')
  /** The form of the account, or the virtual account, that is being made with the row. */
  const [making, setMaking] = useState<{ type: AccountType; row: AccountRowInput } | 'pool' | null>(null)

  // the lists and rules the store applies in addRowOfKind, so what is offered is what is accepted
  const t = rowTargets(tables, household)
  const list = place === 'set-aside' ? SET_ASIDE : KINDS.filter((k) => k.section === section && (!only || only.includes(k.key)) && !without?.includes(k.key))
  const kinds = list.filter((k) => k.offered?.(t) ?? true)
  // a choice that is no longer offered (the plug got its row, the pool was filled elsewhere) falls back to the first one
  const kind: Kind | undefined = kinds.find((k) => k.key === choice) ?? kinds[0]
  const targets = kind?.targets?.(t) ?? null
  const creates = kind?.create ?? []
  const creating = creates.find((n) => newValue(n) === targetId) ?? (targets?.length === 0 ? creates[0] : undefined)
  const chosen = targets && !creating ? (targets.find((x) => x.id === targetId) ?? targets[0]) : undefined
  const missing = kind && targets && targets.length === 0 && !creating ? kind.empty(t) : null
  // a row that names an account or a virtual account can do without a name of its own
  const named = !!kind && !!targets && kind.field !== 'adultId'
  const account = chosen && kind?.field === 'accountId' ? tables.accounts.find((a) => a.id === chosen.id) : undefined
  const fallbackName = !kind || !named ? null
    : creating ? `Named after the ${creating.thing}`
    : kind.field === 'poolId' && chosen ? rowNameFor(kind.key, chosen.name)
    : account ? rowNameFor(kind.key, account.name) : null
  // a virtual account names its own row in its form
  const showName = creating?.type !== 'pool'
  const sameSection = !kind || kind.section === section
  const text = !kind ? null : missing ?? (
    creating?.type === 'pool' ? 'Add opens the form of the new virtual account. Saving it makes the virtual account and its row, "To <name>".'
    : creating ? `Add opens the form of the new ${creating.thing}. Saving it makes the ${creating.thing} and this row together.`
    : kind.text)

  const reset = () => {
    setName('')
    setCategoryId(defaultCategoryId)
    setChoice(null)
    setTargetId('')
    setMaking(null)
    setOpen(false)
  }

  async function save() {
    const n = name.trim()
    if (missing) return
    if (kind && creating) {
      // the account's own form takes over: it makes the account and this row in one step
      if (creating.type === 'pool') return setMaking('pool')
      return setMaking({ type: creating.type, row: { kind: kind.key as AccountRowInput['kind'], name: n, categoryId: categoryId || null } })
    }
    if (!n && !fallbackName) return
    try {
      let row: Row
      if (kind) {
        const id = chosen?.id ?? null
        // a payment row lives where its account says: under Transfers for a card whose purchases are rows already
        const where = kind.key === 'pay-off' && account ? payOffKind(account) : { section: kind.section, kind: kind.key }
        row = await addRowOfKind(store, {
          ...where, name: n, categoryId: where.section === section ? categoryId || null : null,
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
      <Button variant="ghost" size="sm" className={cn('text-muted-foreground', lead && leadClassName)} onClick={() => setOpen(true)} aria-label={label ?? `Add ${section} row`}>
        {lead ?? <Plus />} <span data-lead={lead ? 'text' : undefined}>{label ?? 'Add row'}</span>
      </Button>
    )
  }
  const keys = (e: KeyboardEvent<HTMLInputElement>) => { if (e.key === 'Enter') void save(); if (e.key === 'Escape') reset() }
  const nameField = showName && (
    <Input
      autoFocus={place !== 'set-aside'} className="h-7 w-44" placeholder={fallbackName ?? 'Row name'} value={name} aria-label={`New ${section} row name`}
      onChange={(e) => setName(e.target.value)} onKeyDown={keys}
    />
  )
  const categoryField = categories.length > 0 && sameSection && showName && (
    <NativeSelect aria-label={`Category for the new ${section} row`} className="h-7" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
      <option value="">No category</option>
      {[...categories].sort((a, b) => (a.order < b.order ? -1 : a.order > b.order ? 1 : 0)).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
    </NativeSelect>
  )
  const whatSelect = kind && kinds.length > 1 && (
    <NativeSelect
      autoFocus={place === 'set-aside'} aria-label={place === 'set-aside' ? undefined : `What the new ${section} row does`} className="h-7 min-w-0" value={kind.key}
      onChange={(e) => { setChoice(e.target.value as Choice); setTargetId('') }}
    >
      {kinds.map((k) => <option key={k.key} value={k.key}>{k.label}</option>)}
    </NativeSelect>
  )
  const targetField = kind && targets && (targets.length > 0 || creates.length > 0) && (
    <NativeSelect
      aria-label={place === 'set-aside' ? 'Which one' : `${kind.targetLabel} for the new ${section} row`} className="h-7"
      value={creating ? newValue(creating) : chosen?.id ?? ''} onChange={(e) => setTargetId(e.target.value)}
    >
      {targets.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
      {creates.map((n) => <option key={n.type} value={newValue(n)}>{n.label}</option>)}
    </NativeSelect>
  )
  return (
    <div className={cn('flex flex-wrap items-center gap-1', formClassName)} data-testid="add-row-form">
      {place === 'set-aside' ? (
        <>
          {/* the question comes first here: the answer decides which account the row is linked to */}
          <label className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground"><span className="shrink-0">What is it for?</span>{whatSelect}</label>
          {targetField}
          {nameField}
          {categoryField}
        </>
      ) : (
        <>
          {nameField}
          {categoryField}
          {whatSelect}
          {targetField}
        </>
      )}
      <Button size="sm" onClick={() => void save()} disabled={!!missing}>Add</Button>
      <Button size="sm" variant="ghost" onClick={reset}>Cancel</Button>
      {kind && kinds.length > 1 && <p className="basis-full text-xs text-muted-foreground" data-testid="add-row-text">{text}</p>}
      {making && making !== 'pool' && (
        <HouseholdAccountDialog
          account={null} entities={tables.entities} baseCurrency={household.baseCurrency} locale={household.locale} startMonth={household.startMonth}
          preset={{ type: making.type, types: [making.type] }} withRow={making.row}
          onClose={() => setMaking(null)} onSaved={(_, row) => { reset(); if (row) onAdded?.(row) }}
        />
      )}
      {making === 'pool' && (
        <PoolDialog pool={null} savings={t.savings} baseCurrency={household.baseCurrency} locale={household.locale} fromMonth={month} onClose={() => setMaking(null)} onSaved={reset} />
      )}
    </div>
  )
}
