import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Segmented } from '@/components/Segmented'
import { formatMonth } from '@/app/format'
import { useStore } from '@/app/store'
import { sortRows } from '@/engine'
import { monthOfDate, type FundedBy, type Household, type Row, type Section, type Tables } from '@/model'
import { accountTypeForRow, derivedRowReason, followRow, setRowAccount, setRowFundedBy } from '@/store'
import { NativeSelect } from './NativeSelect'
import { fundingOptions } from './funding'
import { HELP } from '@/app/help'
import { accountHelp, accountVerb } from './rowAccount'

interface Base {
  row: Row
  tables: Tables
  household: Household
  onClose: () => void
}

const SECTIONS: Array<{ key: Section; title: string }> = [
  { key: 'income', title: 'Income' },
  { key: 'expense', title: 'Expenses' },
  { key: 'transfer', title: 'Transfers' },
]

/** Busy and error state for a dialog that saves once and closes. */
export function useSave(onClose: () => void) {
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const save = async (fn: () => Promise<void>) => {
    setBusy(true)
    setError(null)
    try {
      await fn()
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save.')
    } finally {
      setBusy(false)
    }
  }
  return { error, busy, save }
}

/** Where a spending row's single amounts come out of, from a month on or for all months. */
export function RowSourceDialog({ row, tables, household, onClose }: Base) {
  const store = useStore()
  const options = fundingOptions(tables.pools, [row.defaultFundedBy])
  const [fundedBy, setFundedBy] = useState<FundedBy>(row.defaultFundedBy)
  const [scope, setScope] = useState<'from-month' | 'all-months'>('from-month')
  const { error, busy, save } = useSave(onClose)
  const month = monthOfDate()
  const oldLabel = options.find((o) => o.value === row.defaultFundedBy)?.label ?? 'the old source'

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Comes out of</DialogTitle>
          <DialogDescription>Row "{row.name}"</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="row-source">Single amounts in this row come out of</Label>
            <NativeSelect id="row-source" className="w-full" value={fundedBy} onChange={(e) => setFundedBy(e.target.value as FundedBy)}>
              {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </NativeSelect>
            <p className="text-xs text-muted-foreground">{HELP['cell.comesOutOf'].text} Items that have their own choice keep it.</p>
          </div>
          <fieldset className="space-y-1.5">
            <legend className="text-sm font-medium">Applies to</legend>
            <Segmented
              value={scope}
              onChange={(v) => setScope(v as 'from-month' | 'all-months')}
              options={[{ value: 'from-month', label: `From ${formatMonth(month, household.locale)} on` }, { value: 'all-months', label: 'All months, past included' }]}
            />
            <p className="text-xs text-muted-foreground">
              {scope === 'from-month'
                ? `Earlier months stay as they are (${oldLabel}), so past savings and pool balances do not move.`
                : 'Earlier months change too: the savings balance and pool accounts are worked out again from the start.'}
            </p>
          </fieldset>
          {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={() => void save(() => setRowFundedBy(store, row.id, fundedBy, scope === 'all-months' ? 'all-months' : { from: month }))} disabled={busy}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** Destination for transfers, the card or loan a payment row clears, or the paying account for everything else. */
export function RowAccountDialog({ row, tables, onClose }: Base) {
  const store = useStore()
  const need = accountTypeForRow(row)
  // archived accounts are offered only while the row still points at one
  const accounts = tables.accounts.filter((a) => !a.deletedAt && (!need || a.type === need) && (!a.archivedMonth || a.id === row.accountId))
  const [accountId, setAccountId] = useState(row.accountId ?? '')
  const { error, busy, save } = useSave(onClose)
  const verb = accountVerb(row)

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{verb}</DialogTitle>
          <DialogDescription>Row "{row.name}"</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="row-account">{verb}</Label>
            <NativeSelect id="row-account" className="w-full" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
              {!need && <option value="">—</option>}
              {need && !accountId && <option value="">Pick an account</option>}
              {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}{need && !a.tracked ? ' (not tracked)' : ''}</option>)}
            </NativeSelect>
            <p className="text-xs text-muted-foreground">{accountHelp(row)}</p>
            {need && accounts.length === 0 && <p className="text-xs text-muted-foreground">No account of the right kind yet. Add one under Household first.</p>}
          </div>
          <p className="text-xs text-muted-foreground">Applies to every month, past ones included. To switch from a month on, archive this row and add a new one.</p>
          {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={() => void save(() => setRowAccount(store, row.id, accountId || null))} disabled={busy}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** Make this row mirror another row's amount month by month. */
export function RowFollowDialog({ row, tables, household, onClose }: Base) {
  const store = useStore()
  const rule = household.closingRule
  const candidates = sortRows(tables.rows.filter((r) => !r.deletedAt && r.id !== row.id && !r.archivedMonth && !r.followsRowId && !derivedRowReason(r, rule)), tables.categories)
  const [targetId, setTargetId] = useState(row.followsRowId ?? '')
  const { error, busy, save } = useSave(onClose)

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Follow another row</DialogTitle>
          <DialogDescription>Row "{row.name}"</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="row-follows">Same amount as</Label>
            <NativeSelect id="row-follows" className="w-full" value={targetId} onChange={(e) => setTargetId(e.target.value)}>
              <option value="">Nothing: its own amounts</option>
              {SECTIONS.map((s) => {
                const list = candidates.filter((r) => r.section === s.key)
                return list.length ? (
                  <optgroup key={s.key} label={s.title}>
                    {list.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                  </optgroup>
                ) : null
              })}
            </NativeSelect>
            <p className="text-xs text-muted-foreground">
              Month by month this row shows the same amount as the row you pick, and its cells cannot be edited while it follows.
              Handy for a transfer that moves exactly what came in, like a child's long-term savings following the child benefit.
              Choose "Nothing" to go back to its own amounts; they were kept.
            </p>
          </div>
          {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={() => void save(() => followRow(store, row.id, targetId || null))} disabled={busy}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
