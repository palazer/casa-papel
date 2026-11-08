import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { MonthField } from '@/components/MonthField'
import { NativeSelect } from '@/features/grid/NativeSelect'
import { amountToInput, formatMonth, parseAmount } from '@/app/format'
import { useStore } from '@/app/store'
import { GOAL_KIND_INFO, monthOfDate, type Goal, type GoalKind, type Household, type Tables } from '@/model'
import { addGoal, updateGoal } from '@/store'

interface Props {
  household: Household
  tables: Tables
  goal: Goal | null
  onClose: () => void
  /** "Delete…" hands the goal to the remove dialog; the card opens it after this one closes. */
  onRemove?: () => void
}

const ASSET_TYPES = ['savings', 'investment', 'other-asset']
const DEBT_TYPES = ['credit-card', 'loan']

export function GoalDialog({ household, tables, goal, onClose, onRemove }: Props) {
  const store = useStore()
  const { locale, baseCurrency } = household
  const [name, setName] = useState(goal?.name ?? '')
  const [kind, setKind] = useState<GoalKind>(goal?.kind ?? 'account-balance')
  const [accountId, setAccountId] = useState(goal?.accountId ?? '')
  const [poolId, setPoolId] = useState(goal?.poolId ?? '')
  const [target, setTarget] = useState(goal && goal.kind !== 'pay-off' ? amountToInput(goal.target, currencyFor(goal.kind, goal.accountId), locale) : '')
  const [targetMonth, setTargetMonth] = useState(goal?.targetMonth ?? '')
  const [notes, setNotes] = useState(goal?.notes ?? '')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // archived accounts and pool accounts are offered only while this goal still watches one
  const accounts = tables.accounts.filter((a) => !a.deletedAt && (!a.archivedMonth || a.id === goal?.accountId))
  const choices = kind === 'account-balance' ? accounts.filter((a) => ASSET_TYPES.includes(a.type)) : kind === 'pay-off' ? accounts.filter((a) => DEBT_TYPES.includes(a.type)) : []
  const pools = tables.pools.filter((p) => !p.deletedAt && (!p.archivedMonth || p.id === goal?.poolId))
  const chosenAccount = accounts.find((a) => a.id === accountId)
  const needsAccount = kind === 'account-balance' || kind === 'pay-off'
  const effectiveAccountId = needsAccount ? (choices.some((a) => a.id === accountId) ? accountId : choices[0]?.id ?? '') : ''
  const effectivePoolId = kind === 'pool-balance' ? (pools.some((p) => p.id === poolId) ? poolId : pools[0]?.id ?? '') : ''
  const currency = currencyFor(kind, effectiveAccountId)
  const thisMonth = monthOfDate()

  function currencyFor(k: GoalKind, accId: string | null): string {
    if (k === 'account-balance' || k === 'pay-off') return tables.accounts.find((a) => a.id === accId)?.currency ?? baseCurrency
    return baseCurrency
  }

  async function save() {
    const minor = kind === 'pay-off' ? 0 : parseAmount(target, currency, locale)
    if (minor == null) return setError('Target is not a number I can read.')
    setBusy(true)
    setError(null)
    try {
      const input = { name, kind, accountId: effectiveAccountId || null, poolId: effectivePoolId || null, target: minor, targetMonth: targetMonth || null, notes }
      if (goal) await updateGoal(store, goal.id, input)
      else await addGoal(store, input)
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save.')
    } finally {
      setBusy(false)
    }
  }
  const noChoice = needsAccount ? choices.length === 0 : kind === 'pool-balance' ? pools.length === 0 : false

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="sm:max-w-md" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>{goal ? 'Edit goal' : 'New goal'}</DialogTitle>
          <DialogDescription>Measured against the plan in the grid every month, nothing to update by hand.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="space-y-1.5"><Label htmlFor="goal-name">Name</Label><Input id="goal-name" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Emergency fund" /></div>
          <div className="space-y-1.5">
            <Label htmlFor="goal-kind">Kind</Label>
            <NativeSelect id="goal-kind" className="w-full" value={kind} onChange={(e) => setKind(e.target.value as GoalKind)}>
              {GOAL_KIND_INFO.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
            </NativeSelect>
            <p className="text-xs text-muted-foreground">{GOAL_KIND_INFO.find((k) => k.value === kind)?.help}</p>
          </div>
          {needsAccount && (
            <div className="space-y-1.5">
              <Label htmlFor="goal-account">Tracks</Label>
              <NativeSelect id="goal-account" className="w-full" value={effectiveAccountId} onChange={(e) => setAccountId(e.target.value)} disabled={choices.length === 0}>
                {choices.map((a) => <option key={a.id} value={a.id}>{a.name}{a.tracked ? '' : ' (not tracked)'}</option>)}
              </NativeSelect>
              {choices.length === 0 && <p className="text-xs text-muted-foreground">{kind === 'pay-off' ? 'Add a credit card or loan account first.' : 'Add a savings, investment or other asset account first.'}</p>}
            </div>
          )}
          {kind === 'pool-balance' && (
            <div className="space-y-1.5">
              <Label htmlFor="goal-pool">Tracks</Label>
              <NativeSelect id="goal-pool" className="w-full" value={effectivePoolId} onChange={(e) => setPoolId(e.target.value)} disabled={pools.length === 0}>
                {pools.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </NativeSelect>
              {pools.length === 0 && <p className="text-xs text-muted-foreground">Add a pool account first, under Household.</p>}
            </div>
          )}
          {kind !== 'pay-off' ? (
            <div className="space-y-1.5"><Label htmlFor="goal-target">Target ({currency})</Label><Input id="goal-target" inputMode="decimal" value={target} onChange={(e) => setTarget(e.target.value)} placeholder="e.g. 10000" /></div>
          ) : (
            <p className="text-xs text-muted-foreground">Done when nothing is owed on {chosenAccount?.name ?? 'the account'}.</p>
          )}
          <div className="space-y-1.5">
            <Label>Target month (optional)</Label>
            <MonthField label="Target month" value={targetMonth} onChange={setTargetMonth} locale={locale} allowEmpty />
            <p className="text-xs text-muted-foreground">
              {targetMonth && targetMonth < thisMonth ? `${formatMonth(targetMonth, locale)} has passed; the goal shows as late until it is reached.` : 'Compared with the month the plan reaches the target.'}
            </p>
          </div>
          <div className="space-y-1.5"><Label htmlFor="goal-notes">Notes</Label><Input id="goal-notes" value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
        </div>
        {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
        <DialogFooter className="flex-row flex-wrap gap-2 sm:justify-between">
          <div>
            {goal && onRemove && <Button variant="ghost" size="sm" onClick={onRemove} disabled={busy}>Delete…</Button>}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
            <Button onClick={() => void save()} disabled={busy || !name.trim() || noChoice}>Save</Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
