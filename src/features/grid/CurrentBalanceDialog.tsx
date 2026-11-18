import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { formatAmount, formatMonth } from '@/app/format'
import { useStore } from '@/app/store'
import type { Household, MonthKey, Tables } from '@/model'
import { setMonthBalances } from '@/store'
import { BalanceFields } from './BalanceFields'
import { useMonthBalances, type MonthBalancesForm } from './useMonthBalances'
import { saveError } from '@/app/saveError'

interface Props {
  /** The line's name: the one current account's, or "Current accounts". */
  title: string
  month: MonthKey
  tables: Tables
  household: Household
  onClose: () => void
}

/**
 * What the plan knows about the current accounts of a month: their amounts together, in the household currency. Said
 * wherever their fields stand, because one account alone has no calculated amount unless it is the only one.
 */
export function CurrentTogether({ form, base }: { form: MonthBalancesForm; base: string }) {
  const { main, locale } = form
  if (!main) return null
  return <>Calculated, together: {formatAmount(main.start, base, locale)} at the start, {formatAmount(main.computed, base, locale)} at the end.</>
}

/**
 * What the current accounts really held when a month began and when it ended (DESIGN.md §8). The plan only knows what
 * they hold together, so each moment takes every one of them or none: their sum takes the place of the calculated
 * amount, the line shows the difference and later months continue from the real numbers.
 */
export function CurrentBalanceDialog({ title, month, tables, household, onClose }: Props) {
  const store = useStore()
  const form = useMonthBalances(tables, household, month, (l) => l.group === 'current')
  const [busy, setBusy] = useState(false)
  const { locale, lines, main } = form
  const base = household.baseCurrency
  const several = lines.length > 1
  // the plan's own figure for one account in the household currency is in its fields already
  const alone = lines.length === 1 && lines[0].endCalculated != null
  // the sum as it is typed, while every account is in the household currency; another currency is converted on saving
  const ends = lines.map((l) => form.typed('end', l))
  const together = main && lines.length > 0 && lines.every((l) => l.account.currency === base) && ends.every((v) => v != null) ? ends.reduce<number>((sum, v) => sum + (v ?? 0), 0) : null

  async function submit() {
    const entry = form.entry()
    if (!entry) return
    setBusy(true)
    try {
      await setMonthBalances(store, month, entry)
      onClose()
    } catch (e) {
      form.setError(saveError(e, 'Could not save.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className={several ? 'sm:max-w-lg' : 'sm:max-w-md'} aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>{title} · {formatMonth(month, locale, 'long')}</DialogTitle>
          <DialogDescription>
            {several
              ? 'What they really held when the month began and when it ended, from your bank. The plan only knows them together, so fill in every account or none.'
              : 'What the account really held when the month began and when it ended, from your bank.'}
            {' '}An empty field keeps the calculated amount. The start is the end of the month before: changing it corrects that month too.
          </DialogDescription>
        </DialogHeader>
        {!alone && main && <p className="text-sm text-muted-foreground" data-testid="current-together"><CurrentTogether form={form} base={base} /></p>}
        <BalanceFields form={form} groups={[{ lines }]} month={month} base={base} named={several} onEnter={() => void submit()} />
        {lines.some((l) => l.account.currency !== base) && <p className="text-xs text-muted-foreground">An account in another currency is counted in {base} at this month's rate.</p>}
        {together != null && main && several && (
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm" data-testid="current-balance-sum">
            <dt className="text-muted-foreground">Together at the end</dt><dd className="text-right tabular-nums">{formatAmount(together, base, locale)}</dd>
            <dt className="text-muted-foreground">Difference</dt><dd className="text-right tabular-nums">{formatAmount(together - main.computed, base, locale, { sign: 'exceptZero' })}</dd>
          </dl>
        )}
        {form.error && <p className="text-sm text-destructive" role="alert">{form.error}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={() => void submit()} disabled={busy}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
