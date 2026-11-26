import { useState } from 'react'
import { useStore } from '@/app/store'
import { saveError } from '@/app/saveError'
import { InfoTip } from '@/components/InfoTip'
import { Segmented } from '@/components/Segmented'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import type { Household, Tables } from '@/model'
import { mainAccountChoice, setMainAccount } from '@/store'
import { txt } from '@/i18n'

const T = txt.main.question

/**
 * Rule B9 on screen (DESIGN.md §8): once, after the app has put a household from before the rule right, it asks
 * which of its current accounts is the main account. The upgrade has picked one already, so the figures are right
 * while the question waits; "Save" keeps the pick or makes another account the main account, and the others keep a
 * balance of their own. With one account in the household's currency there is nothing to choose: it says so. With
 * none, it says the month's money stays on the "Main account" line. Closing it keeps what the upgrade picked.
 */
export function MainAccountQuestion({ tables, household }: { tables: Tables; household: Household }) {
  const store = useStore()
  const { eligible, foreign, mainId } = mainAccountChoice(tables)
  const [chosen, setChosen] = useState(mainId ?? eligible[0]?.id ?? '')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const base = household.baseCurrency
  const choose = eligible.length > 1

  async function save(id: string | null) {
    setBusy(true)
    setError(null)
    try {
      await setMainAccount(store, id)
    } catch (e) {
      setError(saveError(e, txt.common.couldNotSave))
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o && !busy) void save(null) }}>
      <DialogContent className="sm:max-w-md" data-testid="main-account-question">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-1.5">
            {choose ? T.whichIsYourMain : T.oneMainAccount} <InfoTip help="statement.mainAccountQuestion" />
          </DialogTitle>
          <DialogDescription>
            {T.theMonthsMoneyNow(base)}
          </DialogDescription>
        </DialogHeader>
        {choose && (
          <Segmented label={T.mainAccount} value={chosen} onChange={setChosen} options={eligible.map((a) => ({ value: a.id, label: a.name }))} />
        )}
        <ul className="space-y-1 text-sm" aria-label={T.whatChanges}>
          {!choose && eligible.length === 1 && <li>{T.isTheMainAccount(eligible[0].name)}</li>}
          {eligible.length === 0 && <li>{T.noneOfThemIs(base)}</li>}
          {foreign.map((a) => (
            <li key={a.id} className="text-muted-foreground">{T.isInItKeeps(a.name, a.currency)}</li>
          ))}
          <li className="text-muted-foreground">{T.netWorthStays(foreign.length)}</li>
        </ul>
        {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
        <DialogFooter>
          {choose
            ? <Button disabled={busy || !chosen} onClick={() => void save(chosen)}>{txt.common.save}</Button>
            : <Button disabled={busy} onClick={() => void save(null)}>{T.ok}</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
