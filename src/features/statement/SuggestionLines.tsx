import { useState } from 'react'
import { X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { parseAmount } from '@/app/format'
import { useStore } from '@/app/store'
import { InfoTip } from '@/components/InfoTip'
import { AddLead } from './AddLead'
import type { MonthKey, Row } from '@/model'
import { addSuggestion, dismissSuggestion, type AccountSuggestion, type RowSuggestion } from '@/store'

type Need = NonNullable<RowSuggestion['needs']>
/** A suggested row that needs an account says so with the way to make it. */
const NEEDS: Record<Need, string> = {
  savings: 'Add a savings account…',
  investment: 'Add an investment account…',
  loan: 'Add a loan…',
}
const LINE = 'flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs'
const CONTROLS = 'ml-auto flex shrink-0 items-center gap-1.5'
const DISMISS = 'inline-flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring pointer-coarse:size-8'

/**
 * The rows a household is likely to need, offered where they will appear (DESIGN.md §7). A suggestion is not a row:
 * it takes an optional monthly amount, and "Add" (or Enter) makes the row with that amount from the month on screen
 * on. Every suggestion of the place is listed, each a short line: its name, an (i) that says what it is for, the
 * amount field, "Add", and "×" for "not for us", which takes it off the page. A row that needs an account the
 * household does not have offers that account first (`onNeed`); once it is saved the suggestion takes its amount like
 * the others and links to the account by itself.
 */
export function SuggestionLines({ suggestions, label, month, currency, locale, onAdded, onError, onNeed, ticks }: {
  suggestions: RowSuggestion[]
  /** The part of the page they belong to ("Income", "Housing"), for the group's name. */
  label: string
  month: MonthKey
  currency: string
  locale: string
  /** The row a suggestion made, and the amount typed with it (null when the field was left empty). */
  onAdded: (row: Row, amount: number | null) => void
  onError: (message: string) => void
  /** Open the form of the account a suggested row needs. */
  onNeed: (type: Need) => void
  /** The lines above carry ticks, so the "+" stands in the tick's column; otherwise in the arrow's. */
  ticks: boolean
}) {
  if (suggestions.length === 0) return null
  return (
    <div className="basis-full space-y-1" role="group" aria-label={`Suggestions for ${label}`} data-testid="suggestions">
      {suggestions.map((s) => <SuggestionLine key={s.id} suggestion={s} month={month} currency={currency} locale={locale} onAdded={onAdded} onError={onError} onNeed={onNeed} ticks={ticks} />)}
    </div>
  )
}

function SuggestionLine({ suggestion: s, month, currency, locale, onAdded, onError, onNeed, ticks }: {
  suggestion: RowSuggestion; month: MonthKey; currency: string; locale: string
  onAdded: (row: Row, amount: number | null) => void; onError: (message: string) => void; onNeed: (type: Need) => void; ticks: boolean
}) {
  const store = useStore()
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const amount = text.trim() === '' ? null : parseAmount(text, currency, locale)
  const unreadable = text.trim() !== '' && (amount == null || amount < 0)
  const fail = (e: unknown) => onError(e instanceof Error ? e.message : 'That did not work.')

  function add() {
    if (unreadable || busy || s.needs) return
    setBusy(true)
    addSuggestion(store, s.id, { amount, month }).then((row) => onAdded(row, amount)).catch(fail).finally(() => setBusy(false))
  }

  return (
    <div className={LINE} data-suggestion={s.id}>
      <AddLead ticks={ticks} />
      <span className="min-w-0 truncate font-medium text-muted-foreground" data-lead="text">{s.title}</span>
      <InfoTip help="statement.suggestions" title={s.title} text={s.pool ? `${s.description} The amount is what you set aside each month.` : s.description} />
      {/* the field and its buttons stay together: on a narrow screen they move under the name as one */}
      <span className={CONTROLS}>
        {s.needs ? <Button size="xs" variant="outline" aria-label={`${NEEDS[s.needs].replace('…', '')} for ${s.title}`} onClick={() => onNeed(s.needs!)}>{NEEDS[s.needs]}</Button> : (
          <>
            <Input
              aria-label={`${s.pool ? 'Set aside per month' : 'Amount per month'} for ${s.title}`} aria-invalid={unreadable || undefined}
              className="h-7 w-28 text-right" inputMode="decimal" placeholder="per month"
              value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') add() }}
            />
            <Button size="xs" variant="outline" aria-label={`Add ${s.title}`} disabled={busy || unreadable} onClick={add}>Add</Button>
          </>
        )}
        <button type="button" className={DISMISS} aria-label={`Dismiss ${s.title}`} title="Not for us" onClick={() => void dismissSuggestion(store, s.id).catch(fail)}>
          <X className="size-3.5" aria-hidden />
        </button>
      </span>
      {unreadable && <p role="alert" className="basis-full text-destructive">That is not an amount I can read.</p>}
    </div>
  )
}

/** Accounts most households have and this one does not yet. "Add" opens the account dialog with the name and type filled in. */
export function AccountSuggestionLines({ suggestions, onAdd, onError }: {
  suggestions: AccountSuggestion[]
  onAdd: (suggestion: AccountSuggestion) => void
  onError: (message: string) => void
}) {
  const store = useStore()
  if (suggestions.length === 0) return null
  return (
    <div className="basis-full space-y-1" role="group" aria-label="Suggested accounts" data-testid="account-suggestions">
      {suggestions.map((s) => (
        <div key={s.id} className={LINE} data-suggestion={s.id}>
          <AddLead ticks={false} />
          <span className="min-w-0 truncate font-medium text-muted-foreground" data-lead="text">{s.name}</span>
          <InfoTip help="statement.suggestions" title={s.name} text={s.description} />
          <span className={CONTROLS}>
            <Button size="xs" variant="outline" aria-label={`Add ${s.name}`} onClick={() => onAdd(s)}>Add</Button>
            <button
              type="button" className={DISMISS} aria-label={`Dismiss ${s.name}`} title="Not for us"
              onClick={() => void dismissSuggestion(store, s.id).catch((e) => onError(e instanceof Error ? e.message : 'That did not work.'))}
            >
              <X className="size-3.5" aria-hidden />
            </button>
          </span>
        </div>
      ))}
    </div>
  )
}
