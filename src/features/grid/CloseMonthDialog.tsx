import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { formatMonth } from '@/app/format'
import { useStore } from '@/app/store'
import type { AccountGroup, Household, MonthKey, Tables } from '@/model'
import { closeMonth } from '@/store'
import { BalanceFields, type BalanceGroup } from './BalanceFields'
import { CurrentTogether } from './CurrentBalanceDialog'
import { useMonthBalances } from './useMonthBalances'

/** The headings of the list, as on the Statement's lower half. */
const HEADINGS: Array<[AccountGroup, string]> = [
  ['savings', 'Savings accounts'], ['investment', 'Investment accounts'], ['other', 'Other assets'], ['debt', 'Debts'],
]

/**
 * "Close month" asks first (DESIGN.md §8): every account that has a balance in the month, with what it held at the
 * start and at the end. What is typed is saved and the month is closed in one step; a field left empty keeps the
 * calculated amount, so closing with nothing typed is the closing it always was.
 */
export function CloseMonthDialog({ month, tables, household, onClose }: { month: MonthKey; tables: Tables; household: Household; onClose: () => void }) {
  const store = useStore()
  const form = useMonthBalances(tables, household, month)
  const [busy, setBusy] = useState(false)
  const { locale, lines } = form
  const base = household.baseCurrency
  const long = formatMonth(month, locale, 'long')
  const current = lines.filter((l) => l.group === 'current')
  // one current account in the household currency carries the plan's figure in its own fields
  const together = current.length > 0 && !(current.length === 1 && current[0].endCalculated != null)
  const groups: BalanceGroup[] = [
    { heading: current.length > 1 ? 'Current accounts' : undefined, note: together ? <span data-testid="current-together"><CurrentTogether form={form} base={base} /> Fill in every one of them or none.</span> : undefined, lines: current },
    ...HEADINGS.map(([group, heading]) => ({ heading, lines: lines.filter((l) => l.group === group) })),
  ]

  async function submit() {
    const entry = form.entry()
    if (!entry) return
    setBusy(true)
    try {
      await closeMonth(store, month, entry)
      onClose()
    } catch (e) {
      form.setError(e instanceof Error ? e.message : 'Could not close the month.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="sm:max-w-xl" aria-describedby={undefined} data-testid="close-month-dialog">
        <DialogHeader>
          <DialogTitle>Close {long}</DialogTitle>
          <DialogDescription>
            What every account really held, from your bank or broker. An empty field keeps the calculated amount. The start is the end of the month before: changing it corrects that month too.
          </DialogDescription>
        </DialogHeader>
        <BalanceFields form={form} groups={groups} month={month} base={base} named disabled={false} onEnter={() => void submit()} />
        {lines.some((l) => l.account.currency !== base) && <p className="text-xs text-muted-foreground">An account in another currency is typed in its own currency and counted in {base} at this month's rate.</p>}
        <p className="text-xs text-muted-foreground">Closing locks the month's rows and counts all of it as done. "Reopen month" unlocks it.</p>
        {form.error && <p className="text-sm text-destructive" role="alert">{form.error}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={() => void submit()} disabled={busy}>Close month</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
