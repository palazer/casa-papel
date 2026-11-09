import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Check } from '@/components/Check'
import { amountToInput, formatAmount, formatMonth, formatPercent, parseAmount } from '@/app/format'
import { useStore } from '@/app/store'
import type { AccountMonthResult } from '@/engine'
import { cardIsItemized, type Account, type MonthKey } from '@/model'
import { setAccountActual, setCardBalanceBooked, unrecordedRowName } from '@/store'

interface Props {
  account: Account
  month: MonthKey
  result: AccountMonthResult
  locale: string
  closed: boolean
  onClose: () => void
}

/**
 * Pin what an account really held at the end of a month. The engine shows the gap and continues from the real number.
 * For a card whose purchases are expense rows, owing more than the plan expects means spending that was never typed:
 * the dialog offers to count the difference as that month's spending, so expenses and the debt agree.
 */
export function BalanceDialog({ account, month, result, locale, closed, onClose }: Props) {
  const store = useStore()
  const ccy = account.currency
  const hasActual = result.adjustment !== 0 || result.projected === false
  const [text, setText] = useState(hasActual ? amountToInput(result.balance, ccy, locale) : '')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const isInvestment = account.type === 'investment'
  // ticked for a balance typed now; an old difference is only counted when someone asks for it
  const [book, setBook] = useState(!hasActual)
  const typed = text.trim() === '' ? null : parseAmount(text, ccy, locale)
  const extra = typed != null ? typed - result.computed : 0
  const canBook = cardIsItemized(account) && !closed && extra > 0

  async function save(value: number | null) {
    setBusy(true)
    setError(null)
    try {
      if (value != null && canBook && book) await setCardBalanceBooked(store, account.id, month, value)
      else await setAccountActual(store, account.id, month, value)
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save.')
    } finally {
      setBusy(false)
    }
  }
  function submit() {
    if (text.trim() === '') return void save(null)
    const v = parseAmount(text, ccy, locale)
    if (v == null) return setError('That is not a number I can read.')
    void save(v)
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="sm:max-w-md" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>{account.name} · {formatMonth(month, locale, 'long')}</DialogTitle>
          <DialogDescription>
            {isInvestment ? 'What the account was worth at the end of the month, from your broker.' : 'What the account really held at the end of the month, from your bank.'} Later months continue from the real number.
          </DialogDescription>
        </DialogHeader>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
          <dt className="text-muted-foreground">Expected</dt><dd className="text-right tabular-nums">{formatAmount(result.computed, ccy, locale)}</dd>
          {isInvestment && <><dt className="text-muted-foreground">Deposited so far</dt><dd className="text-right tabular-nums">{formatAmount(result.capital ?? 0, ccy, locale)}</dd></>}
          {isInvestment && <><dt className="text-muted-foreground">Return so far</dt><dd className="text-right tabular-nums">{formatPercent(result.totalReturn ?? 0, locale)}</dd></>}
          {hasActual && <><dt className="text-muted-foreground">Difference</dt><dd className="text-right tabular-nums">{formatAmount(result.adjustment, ccy, locale, { sign: 'exceptZero' })}</dd></>}
        </dl>
        <div className="space-y-1.5">
          <Label htmlFor="real-balance">Real balance in {ccy}</Label>
          <Input id="real-balance" autoFocus inputMode="decimal" value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') submit() }} placeholder="leave empty to use the expected amount" disabled={closed} />
          {closed && <p className="text-xs text-muted-foreground">This month is closed. Reopen it from the month header to change the balance.</p>}
        </div>
        {canBook && (
          <div className="space-y-1 rounded-md border p-2.5" data-testid="book-difference">
            <Check label={`Count the ${formatAmount(extra, ccy, locale)} difference as spending this month`} checked={book} onChange={(e) => setBook(e.target.checked)} />
            <p className="text-xs text-muted-foreground">
              {book
                ? `It is added as "Not recorded" on the row "${unrecordedRowName(account)}", paid from this card, so the month's expenses and what is owed agree. Rename it or split it into items any time.`
                : 'Only the balance changes. What is owed rises without a line of spending to explain it.'}
            </p>
          </div>
        )}
        {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
        <DialogFooter className="flex-row flex-wrap gap-2 sm:justify-between">
          <Button variant="ghost" onClick={() => void save(null)} disabled={busy || closed || !hasActual}>Use expected</Button>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
            <Button onClick={submit} disabled={busy || closed}>Save</Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
