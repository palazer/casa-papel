import { useState } from 'react'
import { Plus, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Chip } from '@/components/ui/chip'
import { Input } from '@/components/ui/input'
import { parseAmount } from '@/app/format'
import { useStore } from '@/app/store'
import type { MonthKey, Row } from '@/model'
import { addSuggestion, dismissSuggestion, type AccountSuggestion, type RowSuggestion } from '@/store'

const NEEDS: Record<NonNullable<RowSuggestion['needs']>, string> = {
  savings: 'needs a savings account',
  investment: 'needs an investment account',
  loan: 'needs a loan account',
}
const LINE = 'flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs'
const CONTROLS = 'ml-auto flex shrink-0 items-center gap-1.5'
const DISMISS = 'inline-flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring pointer-coarse:size-8'

/**
 * The rows a household is likely to need, offered where they will appear (DESIGN.md §7). A suggestion is not a row:
 * it takes an optional monthly amount, and "Add" (or Enter) makes the row with that amount from the month on screen
 * on. "×" says "not for us"; the dismissed and the rarer ones wait behind "More suggestions".
 */
export function SuggestionLines({ suggestions, label, month, currency, locale, onAdded, onError }: {
  suggestions: RowSuggestion[]
  /** The part of the page they belong to ("Income", "Housing"), for the group's name. */
  label: string
  month: MonthKey
  currency: string
  locale: string
  /** The row a suggestion made, and the amount typed with it (null when the field was left empty). */
  onAdded: (row: Row, amount: number | null) => void
  onError: (message: string) => void
}) {
  const [more, setMore] = useState(false)
  const usual = suggestions.filter((s) => s.usual)
  const others = suggestions.filter((s) => !s.usual)
  if (suggestions.length === 0) return null
  return (
    <div className="basis-full space-y-1" role="group" aria-label={`Suggestions for ${label}`} data-testid="suggestions">
      {usual.map((s) => <SuggestionLine key={s.id} suggestion={s} month={month} currency={currency} locale={locale} onAdded={onAdded} onError={onError} dismissable />)}
      {others.length > 0 && (
        <button
          type="button" aria-expanded={more} onClick={() => setMore((v) => !v)}
          className="rounded text-xs text-muted-foreground underline decoration-dotted underline-offset-2 outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
        >
          {more ? 'Fewer suggestions' : `More suggestions (${others.length})`}
        </button>
      )}
      {more && others.map((s) => <SuggestionLine key={s.id} suggestion={s} month={month} currency={currency} locale={locale} onAdded={onAdded} onError={onError} dismissable={false} />)}
    </div>
  )
}

function SuggestionLine({ suggestion: s, month, currency, locale, onAdded, onError, dismissable }: {
  suggestion: RowSuggestion; month: MonthKey; currency: string; locale: string
  onAdded: (row: Row, amount: number | null) => void; onError: (message: string) => void; dismissable: boolean
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
      <Plus className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
      <span className="font-medium text-muted-foreground">{s.title}</span>
      <span className="min-w-0 flex-1 basis-40 text-[11px] text-muted-foreground">{s.pool ? `${s.description} The amount is what you set aside each month.` : s.description}</span>
      {/* the field and its buttons stay together: on a narrow screen they move under the name as one */}
      <span className={CONTROLS}>
        {s.needs ? <Chip tone="zinc">{NEEDS[s.needs]}</Chip> : (
          <>
            <Input
              aria-label={`${s.pool ? 'Set aside per month' : 'Amount per month'} for ${s.title}`} aria-invalid={unreadable || undefined}
              className="h-7 w-28 text-right" inputMode="decimal" placeholder="per month"
              value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') add() }}
            />
            <Button size="xs" variant="outline" aria-label={`Add ${s.title}`} disabled={busy || unreadable} onClick={add}>Add</Button>
          </>
        )}
        {dismissable && (
          <button type="button" className={DISMISS} aria-label={`Dismiss ${s.title}`} title="Not for us" onClick={() => void dismissSuggestion(store, s.id).catch(fail)}>
            <X className="size-3.5" aria-hidden />
          </button>
        )}
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
          <Plus className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
          <span className="font-medium text-muted-foreground">{s.name}</span>
          <span className="min-w-0 flex-1 basis-40 text-[11px] text-muted-foreground">{s.description}</span>
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
