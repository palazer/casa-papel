import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Island } from '@/components/ui/island'
import { Label } from '@/components/ui/label'
import { Check } from '@/components/Check'
import { NativeSelect } from '@/components/NativeSelect'
import { amountToInput, formatAmount, formatMonth, parseAmount } from '@/app/format'
import { useStore } from '@/app/store'
import type { EngineOutput } from '@/engine'
import { monthOfDate, type Account, type Household, type MonthKey, type Pool, type Tables } from '@/model'
import { addPool, restorePool, updatePool } from '@/store'
import { HUES } from '@/app/hues'
import { InfoTip } from '@/components/InfoTip'
import { RemoveDialog } from '@/features/remove/RemoveDialog'

export function PoolsCard({ household, tables, engine, onError }: { household: Household; tables: Tables; engine: EngineOutput | null; onError: (m: string) => void }) {
  const store = useStore()
  const [editing, setEditing] = useState<Pool | 'new' | null>(null)
  const [removing, setRemoving] = useState<Pool | null>(null)
  const pools = tables.pools.filter((p) => !p.deletedAt && !p.archivedMonth)
  const archived = tables.pools.filter((p) => !p.deletedAt && p.archivedMonth)
  const savings = tables.accounts.filter((a) => a.type === 'savings' && !a.deletedAt && !a.archivedMonth)
  const m = monthOfDate()
  const { locale, baseCurrency } = household
  const act = (fn: () => Promise<unknown>) => void fn().catch((e) => onError(e instanceof Error ? e.message : 'Action failed'))
  return (
    <Island
      air tone={HUES.pool} title="Virtual accounts"
      description={'A virtual account is money set aside inside a savings account for one purpose: a monthly amount goes in for travel, clothes or gifts, and spending that "comes out of" it draws it down without touching the month\'s leftover.'}
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
                  <span className="text-muted-foreground">in {acc?.name ?? '?'}{alloc ? ` · filled by the row "${alloc.name}"` : ''}</span>
                  {bal && <span className="tabular-nums text-muted-foreground">· {formatAmount(bal.balance, baseCurrency, locale)} now</span>}
                  <Button size="xs" variant="ghost" className="ml-auto" onClick={() => setEditing(p)}>Edit</Button>
                </li>
              )
            })}
          </ul>
        )}
        {archived.length > 0 && (
          <div className="space-y-1">
            <p className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Archived <InfoTip help="household.archived" /></p>
            <ul className="divide-y divide-border/60">
              {archived.map((p) => (
                <li key={p.id} className="flex min-h-8 flex-wrap items-center gap-2 py-1 text-muted-foreground">
                  <span>{p.name}</span>
                  <span>since {formatMonth(p.archivedMonth!, locale)}</span>
                  <Button size="xs" variant="outline" className="ml-auto" onClick={() => act(() => restorePool(store, p.id))}>Restore</Button>
                </li>
              ))}
            </ul>
          </div>
        )}
        {savings.length === 0 ? (
          <p className="text-muted-foreground">Add a savings account first; virtual accounts live inside one.</p>
        ) : (
          <Button variant="outline" size="xs" onClick={() => setEditing('new')}>Add virtual account</Button>
        )}
        {editing && (
          <PoolDialog
            pool={editing === 'new' ? null : editing} savings={savings} baseCurrency={baseCurrency} locale={locale} onClose={() => setEditing(null)} onError={onError}
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
export function PoolDialog({ pool, savings, baseCurrency, locale, fromMonth, onClose, onError, onRemove, onSaved, removeLabel = 'Archive or delete…' }: {
  pool: Pool | null; savings: Account[]; baseCurrency: string; locale: string
  /** A new virtual account: the month its monthly amount starts in; this month when left out. */
  fromMonth?: MonthKey
  onClose: () => void; onError: (m: string) => void; onRemove?: () => void
  /** A new virtual account was saved. */
  onSaved?: (pool: Pool) => void
  /** What the remove button says: "Delete" where removing is one click. */
  removeLabel?: string
}) {
  const store = useStore()
  const [name, setName] = useState(pool?.name ?? '')
  const [accountId, setAccountId] = useState(pool?.accountId ?? savings[0]?.id ?? '')
  const [opening, setOpening] = useState(pool ? amountToInput(pool.openingBalance, baseCurrency, locale) : '')
  const [monthly, setMonthly] = useState('')
  const [spendRow, setSpendRow] = useState(true)
  const [error, setError] = useState<string | null>(null)
  /** A save is on its way: a second press must not add the virtual account twice. */
  const [busy, setBusy] = useState(false)
  function save() {
    if (busy) return
    const openingBalance = opening.trim() ? parseAmount(opening, baseCurrency, locale) : 0
    if (openingBalance == null) return setError('Opening balance is not a number I can read.')
    const monthlyAllocation = monthly.trim() ? parseAmount(monthly, baseCurrency, locale) : null
    if (monthly.trim() && monthlyAllocation == null) return setError('The monthly amount is not a number I can read.')
    setBusy(true)
    const p: Promise<unknown> = pool
      ? updatePool(store, pool.id, { name: name.trim(), accountId, openingBalance })
      : addPool(store, { name: name.trim(), accountId, openingBalance, monthlyAllocation, fromMonth, createSpendRow: spendRow }).then((made) => onSaved?.(made))
    p.then(onClose).catch((e) => { setBusy(false); onError(e instanceof Error ? e.message : 'Failed') })
  }
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="sm:max-w-md" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>{pool ? 'Edit virtual account' : 'New virtual account'}</DialogTitle>
          <DialogDescription>{pool ? 'The monthly amount lives in the virtual account\'s row in the grid.' : 'Creates a transfer row that fills the virtual account each month and, if you like, a spending row that draws from it.'}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="space-y-1.5"><Label htmlFor="pool-name">Name</Label><Input id="pool-name" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Gifts" /></div>
          <div className="space-y-1.5"><Label htmlFor="pool-acc">Held in</Label><NativeSelect id="pool-acc" className="w-full" value={accountId} onChange={(e) => setAccountId(e.target.value)}>{savings.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</NativeSelect></div>
          <div className="space-y-1.5"><Label htmlFor="pool-open">Already in it ({baseCurrency})</Label><Input id="pool-open" inputMode="decimal" value={opening} onChange={(e) => setOpening(e.target.value)} placeholder="0" /></div>
          {!pool && (
            <>
              <div className="space-y-1.5"><Label htmlFor="pool-monthly">Set aside each month ({baseCurrency})</Label><Input id="pool-monthly" inputMode="decimal" value={monthly} onChange={(e) => setMonthly(e.target.value)} placeholder={fromMonth ? `optional, from ${formatMonth(fromMonth, locale)} on` : 'optional, from this month on'} /></div>
              <Check label={`Also add a spending row "${name.trim() || 'Virtual account'}" that comes out of it`} checked={spendRow} onChange={(e) => setSpendRow(e.target.checked)} />
            </>
          )}
        </div>
        {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
        <DialogFooter className="flex-row flex-wrap gap-2 sm:justify-between">
          <div>{pool && onRemove && <Button variant="ghost" size="sm" onClick={onRemove}>{removeLabel}</Button>}</div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
            <Button disabled={busy || !name.trim() || !accountId} onClick={save}>Save</Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
