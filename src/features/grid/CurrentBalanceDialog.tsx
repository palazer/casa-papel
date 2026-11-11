import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { amountToInput, formatAmount, formatMonth, parseAmount } from '@/app/format'
import { useStore } from '@/app/store'
import type { MainAccountMonth } from '@/engine'
import type { Account, AccountMonth, MonthKey } from '@/model'
import { setCurrentBalances } from '@/store'

interface Props {
  /** The line's name: the one current account's, or "Current accounts". */
  title: string
  /** The current accounts that exist in this month, in their order: each gets a field. */
  accounts: Account[]
  month: MonthKey
  result: MainAccountMonth
  /** What is stored for these accounts in this month. */
  actuals: AccountMonth[]
  baseCurrency: string
  locale: string
  closed: boolean
  onClose: () => void
}

/**
 * Pin what the current accounts really held at the end of a month (DESIGN.md §8). The plan only knows what they hold
 * together, so the dialog asks for every one of them or none: their sum takes the place of the worked-out amount,
 * the line shows the difference and later months continue from the real numbers.
 */
export function CurrentBalanceDialog({ title, accounts, month, result, actuals, baseCurrency: base, locale, closed, onClose }: Props) {
  const store = useStore()
  const stored = (acc: Account) => actuals.find((a) => a.accountId === acc.id && a.month === month)?.actualBalance ?? null
  const [texts, setTexts] = useState<Record<string, string>>(() => Object.fromEntries(accounts.map((acc) => {
    const v = stored(acc)
    return [acc.id, v != null ? amountToInput(v, acc.currency, locale) : '']
  })))
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const several = accounts.length > 1
  const hasActual = accounts.some((acc) => stored(acc) != null)
  // the sum as it is typed, while every account is in the household currency; another currency is converted on saving
  const typed = accounts.map((acc) => (texts[acc.id].trim() === '' ? null : parseAmount(texts[acc.id], acc.currency, locale)))
  const together = accounts.every((acc) => acc.currency === base) && typed.every((v) => v != null) ? typed.reduce<number>((sum, v) => sum + (v ?? 0), 0) : null

  async function save(balances: Record<string, number> | null) {
    setBusy(true)
    setError(null)
    try {
      await setCurrentBalances(store, month, balances)
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save.')
    } finally {
      setBusy(false)
    }
  }
  function submit() {
    const filled = accounts.filter((acc) => texts[acc.id].trim() !== '')
    if (filled.length === 0) return void save(null)
    if (filled.length < accounts.length) return setError('Fill in every account, or leave them all empty to use the calculated amount.')
    const balances: Record<string, number> = {}
    for (const acc of accounts) {
      const v = parseAmount(texts[acc.id], acc.currency, locale)
      if (v == null) return setError(several ? `${acc.name}: that is not a number I can read.` : 'That is not a number I can read.')
      balances[acc.id] = v
    }
    void save(balances)
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="sm:max-w-md" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>{title} · {formatMonth(month, locale, 'long')}</DialogTitle>
          <DialogDescription>
            {several
              ? 'What they really held at the end of the month, from your bank. Later months continue from the real numbers.'
              : 'What the account really held at the end of the month, from your bank. Later months continue from the real number.'}
          </DialogDescription>
        </DialogHeader>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
          <dt className="text-muted-foreground">{several ? 'Worked out, together' : 'Worked out'}</dt>
          <dd className="text-right tabular-nums">{formatAmount(result.computed, base, locale)}</dd>
        </dl>
        <div className="space-y-2">
          {accounts.map((acc, i) => (
            <div key={acc.id} className="space-y-1.5">
              <Label htmlFor={`real-${acc.id}`}>{several ? `${acc.name} (${acc.currency})` : `Real balance in ${acc.currency}`}</Label>
              <Input
                id={`real-${acc.id}`} autoFocus={i === 0} inputMode="decimal" value={texts[acc.id]} disabled={closed}
                onChange={(e) => { setError(null); setTexts((t) => ({ ...t, [acc.id]: e.target.value })) }} onKeyDown={(e) => { if (e.key === 'Enter') submit() }}
                placeholder={several ? undefined : 'leave empty to use the calculated amount'}
              />
            </div>
          ))}
          {closed && <p className="text-xs text-muted-foreground">This month is closed. Reopen it to change the balance.</p>}
          {accounts.some((acc) => acc.currency !== base) && <p className="text-xs text-muted-foreground">An account in another currency is counted in {base} at this month's rate.</p>}
        </div>
        {together != null && (
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm" data-testid="current-balance-sum">
            {several && <><dt className="text-muted-foreground">Together</dt><dd className="text-right tabular-nums">{formatAmount(together, base, locale)}</dd></>}
            <dt className="text-muted-foreground">Difference</dt><dd className="text-right tabular-nums">{formatAmount(together - result.computed, base, locale, { sign: 'exceptZero' })}</dd>
          </dl>
        )}
        {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
        <DialogFooter className="flex-row flex-wrap gap-2 sm:justify-between">
          <Button variant="ghost" onClick={() => void save(null)} disabled={busy || closed || !hasActual}>Use the calculated amount</Button>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
            <Button onClick={submit} disabled={busy || closed}>Save</Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
