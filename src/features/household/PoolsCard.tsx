import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Island } from '@/components/ui/island'
import { Label } from '@/components/ui/label'
import { AmountHint } from '@/components/AmountHint'
import { Check } from '@/components/Check'
import { NativeSelect } from '@/components/NativeSelect'
import { amountToInput, formatAmount, formatMonth, parseAmount, unreadableAmount } from '@/app/format'
import { useStore } from '@/app/store'
import { notSetAside, type EngineOutput } from '@/engine'
import { monthOfDate, type Account, type Household, type Money, type MonthKey, type Pool, type Tables } from '@/model'
import { addPool, restorePool, updatePool, type Restored } from '@/store'
import { HUES } from '@/app/hues'
import { InfoTip } from '@/components/InfoTip'
import { RemoveDialog } from '@/features/remove/RemoveDialog'
import { saveError, showSaveError } from '@/app/saveError'
import { txt } from '@/i18n'

const T = txt.household.pools

export function PoolsCard({ household, tables, engine, onError, onRestored }: { household: Household; tables: Tables; engine: EngineOutput | null; onError: (m: string) => void; onRestored: (r: Restored) => void }) {
  const store = useStore()
  const [editing, setEditing] = useState<Pool | 'new' | null>(null)
  const [removing, setRemoving] = useState<Pool | null>(null)
  const pools = tables.pools.filter((p) => !p.deletedAt && !p.archivedMonth)
  const archived = tables.pools.filter((p) => !p.deletedAt && p.archivedMonth)
  const savings = tables.accounts.filter((a) => a.type === 'savings' && !a.deletedAt && !a.archivedMonth)
  const m = monthOfDate()
  const { locale, baseCurrency } = household
  const act = (fn: () => Promise<unknown>) => void fn().catch(showSaveError(onError, txt.common.actionFailed))
  return (
    <Island
      air tone={HUES.pool} title={txt.common.virtualAccounts}
      description={T.aVirtualAccountIs}
    >
      <div className="space-y-3">
        {pools.length > 0 && (
          <ul className="divide-y divide-border/60">
            {pools.map((p) => {
              const acc = tables.accounts.find((a) => a.id === p.accountId)
              const alloc = p.allocationRowId ? tables.rows.find((r) => r.id === p.allocationRowId) : undefined
              const bal = engine?.pools[p.id]?.months[m]
              return (
                <li key={p.id} className="flex min-h-8 flex-wrap items-center gap-2 py-1">
                  <span className="font-medium">{p.name}</span>
                  <span className="text-muted-foreground">{T.heldInAccount(acc?.name ?? '?', alloc ? alloc.name : null)}</span>
                  {bal && <span className="tabular-nums text-muted-foreground">{T.balanceNow(formatAmount(bal.balance, engine?.pools[p.id]?.currency ?? baseCurrency, locale))}</span>}
                  <Button size="xs" variant="ghost" className="ml-auto" onClick={() => setEditing(p)}>{txt.common.edit}</Button>
                </li>
              )
            })}
          </ul>
        )}
        {archived.length > 0 && (
          <div className="space-y-1">
            <p className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{T.archived} <InfoTip help="household.archived" /></p>
            <ul className="divide-y divide-border/60">
              {archived.map((p) => (
                <li key={p.id} className="flex min-h-8 flex-wrap items-center gap-2 py-1 text-muted-foreground">
                  <span>{p.name}</span>
                  <span>{T.since(formatMonth(p.archivedMonth!, locale))}</span>
                  <Button size="xs" variant="outline" className="ml-auto" onClick={() => act(async () => onRestored(await restorePool(store, p.id)))}>{txt.common.restore}</Button>
                </li>
              ))}
            </ul>
          </div>
        )}
        {savings.length === 0 ? (
          <p className="text-muted-foreground">{T.addASavingsAccount}</p>
        ) : (
          <Button variant="outline" size="xs" onClick={() => setEditing('new')}>{T.addVirtualAccount}</Button>
        )}
        {editing && (
          <PoolDialog
            pool={editing === 'new' ? null : editing} savings={savings} baseCurrency={baseCurrency} locale={locale} onClose={() => setEditing(null)}
            freeOf={engine ? (accountId) => notSetAside(tables, engine, accountId, m) : undefined}
            onRemove={editing !== 'new' ? () => { setRemoving(editing); setEditing(null) } : undefined}
          />
        )}
        {removing && <RemoveDialog target={{ kind: 'pool', id: removing.id }} tables={tables} household={household} onClose={() => setRemoving(null)} />}
      </div>
    </Island>
  )
}

/**
 * A virtual account: its name, the savings account that holds it, what is already in it, and for a new one what is set
 * aside each month. The Statement opens it too, with the month on screen as the month the set-aside starts in.
 */
export function PoolDialog({ pool, savings, baseCurrency, locale, fromMonth, freeOf, onClose, onRemove, onSaved, removeLabel = txt.common.archiveOrDelete }: {
  pool: Pool | null; savings: Account[]; baseCurrency: string; locale: string
  /** What a savings account holds that is not set aside yet (`notSetAside`): the form says it, and warns when "Already in it" asks for more. */
  freeOf?: (accountId: string) => Money | null
  /** A new virtual account: the month its monthly amount starts in; this month when left out. */
  fromMonth?: MonthKey
  onClose: () => void; onRemove?: () => void
  /** A new virtual account was saved. */
  onSaved?: (pool: Pool) => void
  /** What the remove button says: "Delete" where removing is one click. */
  removeLabel?: string
}) {
  const store = useStore()
  const [name, setName] = useState(pool?.name ?? '')
  const [accountId, setAccountId] = useState(pool?.accountId ?? savings[0]?.id ?? '')
  /** A virtual account is kept in the currency of the savings account that holds it (rule X14). */
  const held = (id: string) => savings.find((a) => a.id === id)?.currency ?? baseCurrency
  const [opening, setOpening] = useState(pool ? amountToInput(pool.openingBalance, held(pool.accountId), locale) : '')
  const [monthly, setMonthly] = useState('')
  const [spendRow, setSpendRow] = useState(true)
  const [error, setError] = useState<string | null>(null)
  /** A save is on its way: a second press must not add the virtual account twice. */
  const [busy, setBusy] = useState(false)
  // "Already in it" is a part of what the account holds, never money of its own: the form says how much is still
  // free there, and says so when more is asked for (it does not refuse: a balance can be corrected afterwards)
  const holder = savings.find((a) => a.id === accountId)
  const own = held(accountId)
  // it stays in its currency: a move to a savings account in another is refused here, as the store refuses it
  const moved = pool && own !== held(pool.accountId) ? T.movedCurrency(pool.name, held(pool.accountId), holder?.name, own) : null
  const free = !pool && holder ? freeOf?.(holder.id) ?? null : null
  const asked = opening.trim() ? parseAmount(opening, own, locale) : null
  const tooMuch = free != null && asked != null && asked > Math.max(free, 0)
  function save() {
    if (busy) return
    const openingBalance = opening.trim() ? parseAmount(opening, own, locale) : 0
    if (openingBalance == null) return setError(unreadableAmount(opening, T.openingBalanceIsNot))
    const monthlyAllocation = monthly.trim() ? parseAmount(monthly, baseCurrency, locale) : null
    if (monthly.trim() && monthlyAllocation == null) return setError(unreadableAmount(monthly, T.theMonthlyAmountIs))
    setBusy(true)
    const p: Promise<unknown> = pool
      ? updatePool(store, pool.id, { name: name.trim(), accountId, openingBalance })
      : addPool(store, { name: name.trim(), accountId, openingBalance, monthlyAllocation, fromMonth, createSpendRow: spendRow }).then((made) => onSaved?.(made))
    // a refusal is said in the dialog, where it is seen: the screen's own alert sits behind it
    p.then(onClose).catch((e) => { setBusy(false); setError(saveError(e, txt.common.couldNotSave)) })
  }
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="sm:max-w-md" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>{pool ? T.editVirtualAccount : T.newVirtualAccount}</DialogTitle>
          <DialogDescription>{pool ? T.theMonthlyAmountLives : T.createsATransferRow}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="space-y-1.5"><Label htmlFor="pool-name">{txt.common.name}</Label><Input id="pool-name" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder={T.eGGifts} /></div>
          <div className="space-y-1.5">
            <Label htmlFor="pool-acc">{T.heldIn}</Label>
            <NativeSelect id="pool-acc" className="w-full" value={accountId} onChange={(e) => setAccountId(e.target.value)}>{savings.map((a) => <option key={a.id} value={a.id}>{a.name}{a.currency !== baseCurrency ? ` (${a.currency})` : ''}</option>)}</NativeSelect>
            {own !== baseCurrency && <p className="text-xs text-muted-foreground" data-testid="pool-currency">{T.keptIn(own, holder?.name ?? '')}</p>}
            {moved && <p className="text-sm text-destructive" role="alert" data-testid="pool-moved">{moved}</p>}
          </div>
          <div className="space-y-1.5"><Label htmlFor="pool-open">{T.alreadyInIt(own)}</Label><Input id="pool-open" inputMode="decimal" value={opening} onChange={(e) => setOpening(e.target.value)} placeholder="0" /><AmountHint text={opening} currency={own} locale={locale} />
            <p className="text-xs text-muted-foreground" data-testid="pool-open-note">
              {T.partOfWhat(holder ? holder.name : null, free != null ? formatAmount(free, own, locale) : null)}
            </p>
            {tooMuch && holder && (
              <p className="text-xs text-amber-700 dark:text-amber-400" role="status" data-testid="pool-open-warning">
                {T.thatIsMoreThan(holder.name)}
              </p>
            )}
          </div>
          {!pool && (
            <>
              <div className="space-y-1.5"><Label htmlFor="pool-monthly">{T.setAsideEachMonth(baseCurrency)}</Label><Input id="pool-monthly" inputMode="decimal" value={monthly} onChange={(e) => setMonthly(e.target.value)} placeholder={fromMonth ? T.optionalFromOn(formatMonth(fromMonth, locale)) : T.optionalFromThisMonth} /><AmountHint text={monthly} currency={baseCurrency} locale={locale} /></div>
              <Check label={T.alsoAddASpending(name.trim())} checked={spendRow} onChange={(e) => setSpendRow(e.target.checked)} />
            </>
          )}
        </div>
        {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
        <DialogFooter className="flex-row flex-wrap gap-2 sm:justify-between">
          <div>{pool && onRemove && <Button variant="ghost" size="sm" onClick={onRemove}>{removeLabel}</Button>}</div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose} disabled={busy}>{txt.common.cancel}</Button>
            <Button disabled={busy || !name.trim() || !accountId || moved != null} onClick={save}>{txt.common.save}</Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
