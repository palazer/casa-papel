import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { TipLabel } from '@/components/InfoTip'
import { Segmented } from '@/components/Segmented'
import { amountToInput, formatAmount, formatMonth, parseAmount } from '@/app/format'
import { useStore } from '@/app/store'
import type { Category, Household, Money, MonthKey } from '@/model'
import { setCategoryEstimate, type EditScope } from '@/store'

interface Props {
  category: Category
  month: MonthKey
  household: Household
  /** The estimate the month shows now, in the household currency; 0 when the category has none. */
  current: Money
  /** What the category's rows add up to this month. */
  rows: Money
  closed: boolean
  onClose: () => void
}

/**
 * What a category is expected to come to in a month, typed before its rows are known (DESIGN.md §8). The dialog shows
 * what the rows already explain and what would be left, so the number typed is never a surprise on the page.
 */
export function EstimateDialog({ category, month, household, current, rows, closed, onClose }: Props) {
  const store = useStore()
  const { locale, baseCurrency: ccy } = household
  const [text, setText] = useState(current > 0 ? amountToInput(current, ccy, locale) : '')
  const [scope, setScope] = useState<EditScope>('from-now-on')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const typed = text.trim() === '' ? null : parseAmount(text, ccy, locale)
  const left = typed != null ? Math.max(0, typed - rows) : null

  async function save(amount: Money) {
    setBusy(true)
    setError(null)
    try {
      await setCategoryEstimate(store, category.id, month, amount, scope)
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save.')
    } finally {
      setBusy(false)
    }
  }
  function submit() {
    if (typed == null) return setError(text.trim() === '' ? 'Type what the category should come to.' : 'That is not a number I can read.')
    if (typed < 0) return setError('An estimate cannot be below zero.')
    void save(typed)
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="sm:max-w-md" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>Estimate for {category.name} · {formatMonth(month, locale, 'long')}</DialogTitle>
          <DialogDescription>
            What {category.name} should come to in a month, before you know every row. Its rows are taken off it and the rest shows as &quot;Not broken down yet&quot;.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <TipLabel htmlFor="category-estimate" help="row.categoryEstimate">Estimate per month in {ccy}</TipLabel>
          <Input id="category-estimate" autoFocus inputMode="decimal" value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') submit() }} placeholder="e.g. 1450" disabled={closed} />
          {closed && <p className="text-xs text-muted-foreground">This month is closed. Reopen it to change the estimate.</p>}
        </div>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
          <dt className="text-muted-foreground">Rows this month</dt><dd className="text-right tabular-nums">{formatAmount(rows, ccy, locale)}</dd>
          <dt className="text-muted-foreground">Not broken down yet</dt><dd className="text-right tabular-nums" data-testid="estimate-left">{left != null ? formatAmount(left, ccy, locale) : '—'}</dd>
        </dl>
        {typed != null && typed > 0 && typed < rows && <p className="text-xs text-muted-foreground">The rows already add up to more, so {category.name} will show their sum.</p>}
        <fieldset className="space-y-1.5" disabled={closed}>
          <legend className="text-sm font-medium">Applies to</legend>
          <Segmented value={scope} onChange={(v) => setScope(v as EditScope)} options={[{ value: 'from-now-on', label: 'This month and onwards' }, { value: 'this-month', label: 'Only this month' }]} />
        </fieldset>
        {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
        <DialogFooter className="flex-row flex-wrap gap-2 sm:justify-between">
          <div>{current > 0 && <Button variant="ghost" onClick={() => void save(0)} disabled={busy || closed}>Remove estimate</Button>}</div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
            <Button onClick={submit} disabled={busy || closed}>Save</Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
