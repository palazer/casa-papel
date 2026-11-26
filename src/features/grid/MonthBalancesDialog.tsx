import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Check } from '@/components/Check'
import { formatMonth } from '@/app/format'
import { useStore } from '@/app/store'
import type { EngineOutput } from '@/engine'
import { isPastMonth, type AccountGroup, type Household, type MonthKey, type Tables } from '@/model'
import { setMonthBalances } from '@/store'
import { monthProgress } from '@/features/statement/progress'
import { BalanceFields, type BalanceGroup } from './BalanceFields'
import { CurrentTogether } from './CurrentBalanceDialog'
import { useMonthBalances } from './useMonthBalances'
import { saveError } from '@/app/saveError'
import { txt } from '@/i18n'

const T = txt.grid.monthBalances

/** The headings of the list, as on the Statement's lower half. */
const HEADINGS: Array<[AccountGroup, string]> = [
  ['savings', T.savingsAccounts], ['investment', T.investmentAccounts], ['other', T.otherAssets], ['debt', T.debts],
]

/**
 * "Balances for <Month>" (DESIGN.md §8): every account that has a balance in the month, with what it held at the
 * start and at the end; a field left empty keeps the calculated amount. Under them the tick "Count everything in
 * <Month> as done", offered while something in the month is not ticked, and set when the month is over: the month's
 * balances are typed when it has ended, and then all of it has happened. The balances and the ticks are saved as one
 * step, and no amount changes with the tick.
 */
export function MonthBalancesDialog({ month, tables, engine, household, onClose }: { month: MonthKey; tables: Tables; engine: EngineOutput; household: Household; onClose: () => void }) {
  const store = useStore()
  const form = useMonthBalances(tables, household, month)
  const [busy, setBusy] = useState(false)
  const { locale, lines } = form
  const base = household.baseCurrency
  const long = formatMonth(month, locale, 'long')
  const name = new Intl.DateTimeFormat(locale, { month: 'long' }).format(new Date(Number(month.slice(0, 4)), Number(month.slice(5)) - 1, 1))
  const progress = monthProgress(engine.rows, engine.cells, month)
  const open = progress.total - progress.done
  const [countDone, setCountDone] = useState(() => isPastMonth(month))
  const current = lines.filter((l) => l.group === 'current')
  // the main account carries the plan's figure in its own fields; two that were open together (an archived one and
  // the one that replaced it) share it
  const together = current.length > 0 && !(current.length === 1 && current[0].endCalculated != null)
  const groups: BalanceGroup[] = [
    { heading: current.length > 1 ? T.mainAccounts : undefined, note: together ? <span data-testid="current-together"><CurrentTogether form={form} base={base} /> {T.fillInBothOr}</span> : undefined, lines: current },
    ...HEADINGS.map(([group, heading]) => ({ heading, note: group === 'debt' ? T.whatTheStatementSays : undefined, lines: lines.filter((l) => l.group === group) })),
  ]

  async function submit() {
    const entry = form.entry()
    if (!entry) return
    setBusy(true)
    try {
      await setMonthBalances(store, month, entry, { done: open > 0 && countDone })
      onClose()
    } catch (e) {
      form.setError(saveError(e, T.couldNotSaveThe))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="sm:max-w-xl" aria-describedby={undefined} data-testid="month-balances-dialog">
        <DialogHeader>
          <DialogTitle>{T.balancesFor(long)}</DialogTitle>
          <DialogDescription>
            {T.whatEveryAccountReally}
          </DialogDescription>
        </DialogHeader>
        {lines.length > 0
          ? <BalanceFields form={form} groups={groups} month={month} base={base} named onEnter={() => void submit()} />
          : <p className="text-sm text-muted-foreground">{T.noAccountKeepsA}</p>}
        {lines.some((l) => l.account.currency !== base) && <p className="text-xs text-muted-foreground">{T.anAccountInAnother(base)}</p>}
        {open > 0 && (
          <div className="space-y-0.5">
            <Check label={T.countEverythingInAs(name)} checked={countDone} onChange={(e) => setCountDone(e.target.checked)} />
            <p className="pl-6 text-xs text-muted-foreground">{T.ticksEveryLineOf}</p>
          </div>
        )}
        {form.error && <p className="text-sm text-destructive" role="alert">{form.error}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>{txt.common.cancel}</Button>
          <Button onClick={() => void submit()} disabled={busy}>{txt.common.save}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
