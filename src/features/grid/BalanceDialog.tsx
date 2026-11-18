import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { formatAmount, formatMonth, formatPercent } from '@/app/format'
import { useStore } from '@/app/store'
import type { Account, Household, MonthKey, Tables } from '@/model'
import { setMonthBalances } from '@/store'
import { BalanceFields } from './BalanceFields'
import { useMonthBalances } from './useMonthBalances'

interface Props {
  account: Account
  month: MonthKey
  tables: Tables
  household: Household
  onClose: () => void
}

/**
 * What an account really held when a month began and when it ended (DESIGN.md §8). The start is the end of the month
 * before, so changing it corrects that month too; the engine shows the gap and continues from the real
 * numbers. For a card whose purchases are expense rows, owing more than the plan expects means spending that was
 * never typed: the dialog offers to count the difference as that month's spending, so expenses and the debt agree.
 */
export function BalanceDialog({ account, month, tables, household, onClose }: Props) {
  const store = useStore()
  const form = useMonthBalances(tables, household, month, (l) => l.account.id === account.id)
  const [busy, setBusy] = useState(false)
  const { locale } = form
  const line = form.lines[0]
  if (!line) return null
  const ccy = account.currency
  const isInvestment = account.type === 'investment'
  const owed = line.group === 'debt'

  async function submit() {
    const entry = form.entry()
    if (!entry) return
    setBusy(true)
    try {
      await setMonthBalances(store, month, entry)
      onClose()
    } catch (e) {
      form.setError(e instanceof Error ? e.message : 'Could not save.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="sm:max-w-md" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>{account.name} · {formatMonth(month, locale, 'long')}</DialogTitle>
          <DialogDescription>
            {isInvestment ? 'What the account was worth when the month began and when it ended, from your broker.'
              : owed ? 'What was really owed when the month began and when it ended, from your bank.'
              : 'What the account really held when the month began and when it ended, from your bank.'}
            {' '}An empty field keeps the calculated amount. The start is the end of the month before: changing it corrects that month too.
          </DialogDescription>
        </DialogHeader>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
          <dt className="text-muted-foreground">Calculated for the end</dt><dd className="text-right tabular-nums">{formatAmount(line.endCalculated ?? 0, ccy, locale)}</dd>
          {isInvestment && <><dt className="text-muted-foreground">Deposited so far</dt><dd className="text-right tabular-nums">{formatAmount(line.result?.capital ?? 0, ccy, locale)}</dd></>}
          {isInvestment && <><dt className="text-muted-foreground">Return so far</dt><dd className="text-right tabular-nums">{formatPercent(line.result?.totalReturn ?? 0, locale)}</dd></>}
        </dl>
        <BalanceFields form={form} groups={[{ lines: [line] }]} month={month} base={household.baseCurrency} named={false} onEnter={() => void submit()} />
        {form.error && <p className="text-sm text-destructive" role="alert">{form.error}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={() => void submit()} disabled={busy}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
