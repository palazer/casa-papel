import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { MonthField } from '@/components/MonthField'
import { NativeSelect } from '@/components/NativeSelect'
import { Segmented } from '@/components/Segmented'
import { AmountHint } from '@/components/AmountHint'
import { amountToInput, formatMonth, parseAmount, unreadableAmount } from '@/app/format'
import { useStore } from '@/app/store'
import { GOAL_KIND_INFO, goalFamilyOf, monthOfDate, type Goal, type GoalFamily, type GoalKind, type Household, type Tables } from '@/model'
import { addGoal, updateGoal } from '@/store'
import { saveError } from '@/app/saveError'
import { txt } from '@/i18n'

const T = txt.goals.dialog

interface Props {
  household: Household
  tables: Tables
  goal: Goal | null
  /** A new goal opened from the thing it will watch (the Statement's lines): the dialog then asks only for the amount. */
  preset?: { kind: GoalKind; accountId?: string | null; poolId?: string | null }
  onClose: () => void
  /** "Delete…" hands the goal to the remove dialog; the Statement opens it after this one closes. */
  onRemove?: () => void
}

const ASSET_TYPES = ['savings', 'investment', 'other-asset']
const DEBT_TYPES = ['credit-card', 'loan']

/** The two kinds a goal without a line to start from is offered. A net worth goal is only reached from the Net worth line, where nothing needs choosing. */
const FAMILIES = GOAL_KIND_INFO.filter((k) => k.value !== 'net-worth').map((k) => ({ value: k.value, label: k.label }))
/** What a goal watches, as one value for the "Tracks" list: `acc:<id>` or `pool:<id>`. */
const thingOf = (g: { kind: GoalKind; accountId?: string | null; poolId?: string | null } | null | undefined): string =>
  !g ? '' : g.kind === 'pool-balance' ? (g.poolId ? `pool:${g.poolId}` : '') : g.kind === 'net-worth' ? '' : g.accountId ? `acc:${g.accountId}` : ''

/**
 * A goal (DESIGN.md §8). From a line of the Statement, and when editing, what it watches is settled, so the dialog
 * asks only for the name, the amount and the month. Every goal starts on a line today; opened without one, the dialog
 * asks which of the two kinds and what it tracks.
 */
export function GoalDialog({ household, tables, goal, preset, onClose, onRemove }: Props) {
  const store = useStore()
  const { locale, baseCurrency } = household
  const given = goal ?? preset ?? null
  // archived accounts and virtual accounts are offered only while this goal still watches one
  const accounts = tables.accounts.filter((a) => !a.deletedAt && (!a.archivedMonth || a.id === goal?.accountId))
  const pools = tables.pools.filter((p) => !p.deletedAt && (!p.archivedMonth || p.id === goal?.poolId))
  const nameOf = (thing: string): string | undefined =>
    thing.startsWith('pool:') ? pools.find((p) => `pool:${p.id}` === thing)?.name : accounts.find((a) => `acc:${a.id}` === thing)?.name

  const [family, setFamily] = useState<GoalFamily>(given ? goalFamilyOf(given.kind) : 'fill')
  const [thing, setThing] = useState(thingOf(given))
  const [name, setName] = useState(goal?.name ?? (preset ? (preset.kind === 'net-worth' ? txt.common.netWorth : nameOf(thingOf(preset)) ?? '') : ''))
  const [targetMonth, setTargetMonth] = useState(goal?.targetMonth ?? '')
  const [notes, setNotes] = useState(goal?.notes ?? '')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const fillAccounts = accounts.filter((a) => ASSET_TYPES.includes(a.type))
  const debts = accounts.filter((a) => DEBT_TYPES.includes(a.type))
  const choices = family === 'fill' ? [...fillAccounts.map((a) => `acc:${a.id}`), ...pools.map((p) => `pool:${p.id}`)] : family === 'pay-down' ? debts.map((a) => `acc:${a.id}`) : []
  const tracked = family === 'net-worth' ? '' : choices.includes(thing) ? thing : choices[0] ?? ''
  const kind: GoalKind = family === 'net-worth' ? 'net-worth' : family === 'pay-down' ? 'pay-off' : tracked.startsWith('pool:') ? 'pool-balance' : 'account-balance'
  const account = tracked.startsWith('acc:') ? accounts.find((a) => `acc:${a.id}` === tracked) : undefined
  // a virtual account is kept in the currency of the savings account that holds it (rule X14)
  const holder = tracked.startsWith('pool:') ? tables.accounts.find((a) => a.id === pools.find((p) => `pool:${p.id}` === tracked)?.accountId) : undefined
  const currency = (account ?? holder)?.currency ?? baseCurrency
  const trackedName = family === 'net-worth' ? T.netWorthInASentence : nameOf(tracked) ?? ''
  // a debt is paid down to zero unless another amount is typed
  const [target, setTarget] = useState(goal ? amountToInput(goal.target, currency, locale) : given?.kind === 'pay-off' ? '0' : '')
  const thisMonth = monthOfDate()
  const noChoice = family !== 'net-worth' && choices.length === 0
  const info = GOAL_KIND_INFO.find((k) => k.value === family)

  function pickFamily(next: GoalFamily) {
    setFamily(next)
    setThing('')
    // the amount means something else now: a debt starts at zero, an account at nothing typed
    setTarget(next === 'pay-down' ? '0' : '')
  }

  async function save() {
    // a debt with nothing typed is paid down to zero
    const minor = family === 'pay-down' && target.trim() === '' ? 0 : parseAmount(target, currency, locale)
    if (minor == null) return setError(unreadableAmount(target, T.notANumber(family)))
    setBusy(true)
    setError(null)
    try {
      const input = { name, kind, accountId: account?.id ?? null, poolId: kind === 'pool-balance' ? tracked.slice(5) : null, target: minor, targetMonth: targetMonth || null, notes }
      if (goal) await updateGoal(store, goal.id, input)
      else await addGoal(store, input)
      onClose()
    } catch (e) {
      setError(saveError(e, txt.common.couldNotSave))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="sm:max-w-md" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>{goal ? T.editGoal : given ? T.goalFor(trackedName) : T.newGoal}</DialogTitle>
          <DialogDescription>
            {given && <>{family === 'pay-down' ? T.paysDownToAn(trackedName) : family === 'net-worth' ? T.netWorthReachesAn : T.fillsToAnAmount(trackedName)} </>}
            {T.measuredAgainstThePlan}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="space-y-1.5"><Label htmlFor="goal-name">{txt.common.name}</Label><Input id="goal-name" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder={T.eGEmergencyFund} /></div>
          {!given && (
            <>
              <fieldset className="space-y-1.5">
                <legend className="text-sm font-medium">{txt.common.kind}</legend>
                <Segmented label={txt.common.kind} value={family} onChange={(v) => pickFamily(v as GoalFamily)} options={FAMILIES} />
                <p className="text-xs text-muted-foreground">{info?.help}</p>
              </fieldset>
              <div className="space-y-1.5">
                <Label htmlFor="goal-tracks">{T.tracks}</Label>
                <NativeSelect id="goal-tracks" className="w-full" value={tracked} onChange={(e) => setThing(e.target.value)} disabled={noChoice}>
                  {family === 'fill' ? (
                    <>
                      {fillAccounts.length > 0 && <optgroup label={txt.common.accounts}>{fillAccounts.map((a) => <option key={a.id} value={`acc:${a.id}`}>{T.accountChoice(a.name, a.tracked)}</option>)}</optgroup>}
                      {pools.length > 0 && <optgroup label={txt.common.virtualAccounts}>{pools.map((p) => <option key={p.id} value={`pool:${p.id}`}>{p.name}</option>)}</optgroup>}
                    </>
                  ) : debts.map((a) => <option key={a.id} value={`acc:${a.id}`}>{T.accountChoice(a.name, a.tracked)}</option>)}
                </NativeSelect>
                {noChoice && <p className="text-xs text-muted-foreground">{family === 'pay-down' ? T.addACreditCard : T.addASavingsInvestment}</p>}
              </div>
            </>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="goal-target">{family === 'pay-down' ? T.bringItDownTo(currency) : T.target(currency)}</Label>
            <Input id="goal-target" inputMode="decimal" value={target} onChange={(e) => setTarget(e.target.value)} placeholder={family === 'pay-down' ? '0' : 'e.g. 10000'} />
            <AmountHint text={target} currency={currency} locale={locale} />
            {family === 'pay-down' && <p className="text-xs text-muted-foreground">{T.zeroMeansNothingIs(trackedName)}</p>}
          </div>
          <div className="space-y-1.5">
            <Label>{T.targetMonthOptional}</Label>
            <MonthField label={T.targetMonth} value={targetMonth} onChange={setTargetMonth} locale={locale} allowEmpty />
            <p className="text-xs text-muted-foreground">
              {targetMonth && targetMonth < thisMonth ? T.hasPassedTheGoal(formatMonth(targetMonth, locale)) : T.comparedWithTheMonth}
            </p>
          </div>
          <div className="space-y-1.5"><Label htmlFor="goal-notes">{txt.common.notes}</Label><Input id="goal-notes" value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
        </div>
        {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
        <DialogFooter className="flex-row flex-wrap gap-2 sm:justify-between">
          <div>
            {goal && onRemove && <Button variant="ghost" size="sm" onClick={onRemove} disabled={busy}>{txt.common.deleteMore}</Button>}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose} disabled={busy}>{txt.common.cancel}</Button>
            <Button onClick={() => void save()} disabled={busy || !name.trim() || noChoice}>{txt.common.save}</Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
