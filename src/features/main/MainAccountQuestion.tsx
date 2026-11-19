import { useState } from 'react'
import { useStore } from '@/app/store'
import { saveError } from '@/app/saveError'
import { InfoTip } from '@/components/InfoTip'
import { Segmented } from '@/components/Segmented'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import type { Household, Tables } from '@/model'
import { mainAccountChoice, setMainAccount } from '@/store'

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
      setError(saveError(e, 'Could not save.'))
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o && !busy) void save(null) }}>
      <DialogContent className="sm:max-w-md" data-testid="main-account-question">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-1.5">
            {choose ? 'Which is your main account?' : 'One main account'} <InfoTip help="statement.mainAccountQuestion" />
          </DialogTitle>
          <DialogDescription>
            {`The month's money now runs through one account, in ${base}.`} The others keep a balance of their own: money is moved to them with a transfer row, and expenses can come out of them.
          </DialogDescription>
        </DialogHeader>
        {choose && (
          <Segmented label="Main account" value={chosen} onChange={setChosen} options={eligible.map((a) => ({ value: a.id, label: a.name }))} />
        )}
        <ul className="space-y-1 text-sm" aria-label="What changes">
          {!choose && eligible.length === 1 && <li>{`"${eligible[0].name}" is the main account.`}</li>}
          {eligible.length === 0 && <li>{`None of them is in ${base}: the month's money stays on the line "Main account" until you add one.`}</li>}
          {foreign.map((a) => (
            <li key={a.id} className="text-muted-foreground">{`"${a.name}" is in ${a.currency}: it keeps its own balance, and its worth moves with the rate.`}</li>
          ))}
          <li className="text-muted-foreground">Net worth stays as it was{foreign.length ? ', but for what the rate does' : ''}.</li>
        </ul>
        {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
        <DialogFooter>
          {choose
            ? <Button disabled={busy || !chosen} onClick={() => void save(chosen)}>Save</Button>
            : <Button disabled={busy} onClick={() => void save(null)}>OK</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
