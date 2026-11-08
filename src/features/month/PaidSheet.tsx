import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Segmented } from '@/components/Segmented'
import { cn } from '@/lib/utils'
import { amountToInput, formatAmount, formatMonth, parseAmount } from '@/app/format'
import { useStore } from '@/app/store'
import type { CellResult } from '@/engine'
import { isoDateOfToday, monthOfDate, type Household, type ItemStatus, type MonthKey, type Row } from '@/model'
import { markPaid } from '@/store'

interface Props {
  household: Household
  row: Row
  cell: CellResult
  month: MonthKey
  /** One item of an itemized line, or null for the line's single amount. */
  itemId: string | null
  onClose: () => void
  onOpenEditor: () => void
}

const STATUS: Array<{ value: ItemStatus; label: string }> = [
  { value: 'projected', label: 'Estimate' },
  { value: 'committed', label: 'Certain' },
  { value: 'done', label: 'Done' },
]

/** Under 640 px the dialog docks to the bottom edge like a sheet, above the home indicator (DESIGN.md §8). */
export const SHEET_CLASS = 'max-sm:top-auto max-sm:bottom-0 max-sm:left-0 max-sm:max-w-none max-sm:translate-x-0 max-sm:translate-y-0 max-sm:rounded-b-none max-sm:rounded-t-2xl max-sm:pb-[max(1rem,env(safe-area-inset-bottom))]'

/**
 * "Paid…": record what actually moved for one line this month. The amount is prefilled, the date is today when the
 * month is the current one, Done is preselected. Saving changes this month only; the full editor is one tap away.
 */
export function PaidSheet({ household, row, cell, month, itemId, onClose, onOpenEditor }: Props) {
  const store = useStore()
  const { locale } = household
  const currency = row.currency ?? household.baseCurrency
  const item = itemId ? cell.items.find((i) => i.id === itemId) ?? null : null
  const current = item ? item.effectiveAmount : cell.value
  const [amount, setAmount] = useState(() => amountToInput(current, currency, locale))
  const [date, setDate] = useState(() => item?.date ?? (month === monthOfDate() ? isoDateOfToday() : ''))
  const [status, setStatus] = useState<ItemStatus>('done')
  const [note, setNote] = useState(item?.note ?? '')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  function save() {
    const minor = amount.trim() === '' ? 0 : parseAmount(amount, currency, locale)
    if (minor == null) {
      setError('That is not a number I can read.')
      return
    }
    setBusy(true)
    setError(null)
    markPaid(store, row.id, month, itemId, { amount: minor, status, date: date || null, note: note.trim() || null })
      .then(onClose)
      .catch((e) => setError(e instanceof Error ? e.message : 'Could not save.'))
      .finally(() => setBusy(false))
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className={cn('sm:max-w-sm', SHEET_CLASS)}>
        <DialogHeader>
          <DialogTitle>{item?.label ? `${row.name} · ${item.label}` : row.name}</DialogTitle>
          <DialogDescription>{formatMonth(month, locale, 'long')} · currently {formatAmount(current, currency, locale)}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="paid-amount">Amount in {currency}</Label>
            <Input id="paid-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') save() }} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="paid-date">Date</Label>
            <Input id="paid-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <fieldset className="space-y-1.5">
            <legend className="text-sm font-medium">How sure</legend>
            <Segmented value={status} onChange={(v) => setStatus(v as ItemStatus)} options={STATUS} label="How sure" />
            <p className="text-xs text-muted-foreground">Done means the money has moved. Only this month changes; months that already show an amount keep it.</p>
          </fieldset>
          <div className="space-y-1.5">
            <Label htmlFor="paid-note">Note</Label>
            <Input id="paid-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional" />
          </div>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter className="sm:justify-between">
          <Button variant="ghost" className="max-sm:order-last" onClick={() => { onClose(); onOpenEditor() }} disabled={busy}>Open full editor</Button>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
            <Button onClick={save} disabled={busy}>Save</Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
