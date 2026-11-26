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
import { txt } from '@/i18n'

const T = txt.grid.currentBalance

interface Props {
  /** The line's name: the main account's. */
  title: string
  month: MonthKey
  tables: Tables
  household: Household
  onClose: () => void
}

/**
 * What the plan knows about the main accounts of a month where two were open (an archived one and the one that
 * replaced it): their amounts together, in the household currency. Said wherever their fields stand, because one of
 * them alone has no calculated amount.
 */
export function CurrentTogether({ form, base }: { form: MonthBalancesForm; base: string }) {
  const { main, locale } = form
  if (!main) return null
  return <>{T.calculatedTogetherAtThe(formatAmount(main.start, base, locale), formatAmount(main.computed, base, locale))}</>
}

/**
 * What the main account really held when a month began and when it ended (DESIGN.md §8): the real number takes the
 * place of the calculated amount, the line shows the difference and later months continue from it. In a month where
 * an archived main account and the one that replaced it were both open, the plan only knows the two together, so each
 * moment takes both or neither.
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
      form.setError(saveError(e, txt.common.couldNotSave))
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
            {T.whatTheyHeld(several)}
          </DialogDescription>
        </DialogHeader>
        {!alone && main && <p className="text-sm text-muted-foreground" data-testid="current-together"><CurrentTogether form={form} base={base} /></p>}
        <BalanceFields form={form} groups={[{ lines }]} month={month} base={base} named={several} onEnter={() => void submit()} />
        {lines.some((l) => l.account.currency !== base) && <p className="text-xs text-muted-foreground">{T.anAccountInAnother(base)}</p>}
        {together != null && main && several && (
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm" data-testid="current-balance-sum">
            <dt className="text-muted-foreground">{T.togetherAtTheEnd}</dt><dd className="text-right tabular-nums">{formatAmount(together, base, locale)}</dd>
            <dt className="text-muted-foreground">{T.difference}</dt><dd className="text-right tabular-nums">{formatAmount(together - main.computed, base, locale, { sign: 'exceptZero' })}</dd>
          </dl>
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
