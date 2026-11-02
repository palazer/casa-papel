import { useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Check } from '@/components/Check'
import { NativeSelect } from '@/features/grid/NativeSelect'
import { amountToInput, formatAmount, parseAmount } from '@/app/format'
import { useStore } from '@/app/store'
import type { EngineOutput } from '@/engine'
import { monthOfDate, type Account, type Household, type Pool, type Tables } from '@/model'
import { addPool, updatePool } from '@/store'

export function PoolsCard({ household, tables, engine, onError }: { household: Household; tables: Tables; engine: EngineOutput | null; onError: (m: string) => void }) {
  const [editing, setEditing] = useState<Pool | 'new' | null>(null)
  const pools = tables.pools.filter((p) => !p.deletedAt)
  const savings = tables.accounts.filter((a) => a.type === 'savings' && !a.deletedAt)
  const m = monthOfDate()
  const { locale, baseCurrency } = household
  return (
    <Card>
      <CardHeader>
        <CardTitle>Pool accounts</CardTitle>
        <CardDescription>
          A pool account is an envelope inside a savings account: a monthly amount is set aside for travel, clothes, gifts, and spending that "comes out of" it draws it down without touching the month's leftover.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {pools.length > 0 && (
          <ul className="divide-y rounded-md border">
            {pools.map((p) => {
              const acc = tables.accounts.find((a) => a.id === p.accountId)
              const alloc = p.allocationRowId ? tables.rows.find((r) => r.id === p.allocationRowId) : undefined
              const bal = engine?.pools[p.id]?.months[m]
              return (
                <li key={p.id} className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
                  <span className="font-medium">{p.name}</span>
                  <span className="text-muted-foreground">in {acc?.name ?? '?'}{alloc ? ` · filled by the row "${alloc.name}"` : ''}</span>
                  {bal && <Badge variant="secondary">{formatAmount(bal.balance, baseCurrency, locale)} now</Badge>}
                  <Button size="xs" variant="ghost" className="ml-auto" onClick={() => setEditing(p)}>Edit</Button>
                </li>
              )
            })}
          </ul>
        )}
        {savings.length === 0 ? (
          <p className="text-sm text-muted-foreground">Add a savings account first; pool accounts live inside one.</p>
        ) : (
          <Button variant="outline" size="sm" onClick={() => setEditing('new')}>Add pool account</Button>
        )}
        {editing && <PoolDialog pool={editing === 'new' ? null : editing} savings={savings} baseCurrency={baseCurrency} locale={locale} onClose={() => setEditing(null)} onError={onError} />}
      </CardContent>
    </Card>
  )
}

function PoolDialog({ pool, savings, baseCurrency, locale, onClose, onError }: { pool: Pool | null; savings: Account[]; baseCurrency: string; locale: string; onClose: () => void; onError: (m: string) => void }) {
  const store = useStore()
  const [name, setName] = useState(pool?.name ?? '')
  const [accountId, setAccountId] = useState(pool?.accountId ?? savings[0]?.id ?? '')
  const [opening, setOpening] = useState(pool ? amountToInput(pool.openingBalance, baseCurrency, locale) : '')
  const [monthly, setMonthly] = useState('')
  const [spendRow, setSpendRow] = useState(true)
  const [error, setError] = useState<string | null>(null)
  function save() {
    const openingBalance = opening.trim() ? parseAmount(opening, baseCurrency, locale) : 0
    if (openingBalance == null) return setError('Opening balance is not a number I can read.')
    const monthlyAllocation = monthly.trim() ? parseAmount(monthly, baseCurrency, locale) : null
    if (monthly.trim() && monthlyAllocation == null) return setError('The monthly amount is not a number I can read.')
    const p = pool
      ? updatePool(store, pool.id, { name: name.trim(), accountId, openingBalance })
      : addPool(store, { name: name.trim(), accountId, openingBalance, monthlyAllocation, createSpendRow: spendRow })
    p.then(onClose).catch((e) => onError(e instanceof Error ? e.message : 'Failed'))
  }
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="sm:max-w-md" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>{pool ? 'Edit pool account' : 'New pool account'}</DialogTitle>
          <DialogDescription>{pool ? 'The monthly amount lives in the pool account\'s row in the grid.' : 'Creates a transfer row that fills the pool account each month and, if you like, a spending row that draws from it.'}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="space-y-1.5"><Label htmlFor="pool-name">Name</Label><Input id="pool-name" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Gifts" /></div>
          <div className="space-y-1.5"><Label htmlFor="pool-acc">Held in</Label><NativeSelect id="pool-acc" className="w-full" value={accountId} onChange={(e) => setAccountId(e.target.value)}>{savings.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</NativeSelect></div>
          <div className="space-y-1.5"><Label htmlFor="pool-open">Already in it ({baseCurrency})</Label><Input id="pool-open" inputMode="decimal" value={opening} onChange={(e) => setOpening(e.target.value)} placeholder="0" /></div>
          {!pool && (
            <>
              <div className="space-y-1.5"><Label htmlFor="pool-monthly">Set aside each month ({baseCurrency})</Label><Input id="pool-monthly" inputMode="decimal" value={monthly} onChange={(e) => setMonthly(e.target.value)} placeholder="optional, from this month on" /></div>
              <Check label={`Also add a spending row "${name.trim() || 'Pool account'}" that comes out of it`} checked={spendRow} onChange={(e) => setSpendRow(e.target.checked)} />
            </>
          )}
        </div>
        {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button disabled={!name.trim() || !accountId} onClick={save}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
