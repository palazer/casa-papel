import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Check } from '@/components/Check'
import { Segmented } from '@/components/Segmented'
import { formatMonth } from '@/app/format'
import { useStore } from '@/app/store'
import { sortRows } from '@/engine'
import { ENTITY_KIND_LABEL, monthOfDate, type FundedBy, type Household, type Row, type Section, type Tables } from '@/model'
import { accountTypeForRow, derivedRowReason, followRow, setRowAccount, setRowDeductedFrom, setRowFundedBy, setRowScope, updateRow } from '@/store'
import { NativeSelect } from '@/components/NativeSelect'
import { fundingOptions } from './funding'
import { currencyChoices, currencyLabel } from '@/app/currencies'
import { HELP } from '@/app/help'
import { InfoTip, TipLabel } from '@/components/InfoTip'
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
  // shown to a tenth of a percent; an untouched field keeps the stored fraction exactly
  const seeded = String(Math.round((row.followShare ?? 1) * 1000) / 10)
  const [share, setShare] = useState(seeded)
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
              Month by month this row shows the same amount as the row you pick, or a share of it, and its cells cannot be edited while it follows.
              Handy for a transfer that moves exactly what came in, like a child's long-term savings following the child benefit, or a tax that takes a quarter of a salary.
              Choose "Nothing" to go back to its own amounts; they were kept.
            </p>
          </div>
          {targetId && (
            <div className="space-y-1.5">
              <TipLabel htmlFor="row-follow-share" help="row.followShare">Share (%)</TipLabel>
              <Input id="row-follow-share" className="w-28" inputMode="decimal" value={share} onChange={(e) => setShare(e.target.value)} />
              <p className="text-xs text-muted-foreground">100 mirrors the row exactly; 25 puts a quarter of it here.</p>
            </div>
          )}
          {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button
            onClick={() => void save(async () => {
              const pct = Number(share.replace(',', '.'))
              if (targetId && !(pct > 0)) throw new Error('The share must be a number above 0.')
              const fraction = share === seeded ? row.followShare : pct / 100
              await followRow(store, row.id, targetId || null, targetId ? fraction : null)
            })}
            disabled={busy}
          >Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** The currency this row's amounts are typed in; the grid shows the household-currency value beneath each one. */
export function RowCurrencyDialog({ row, household, onClose }: Base) {
  const store = useStore()
  const base = household.baseCurrency
  const codes = currencyChoices(base, row.currency)
  const [ccy, setCcy] = useState(row.currency ?? base)
  const { error, busy, save } = useSave(onClose)

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Currency</DialogTitle>
          <DialogDescription>Row "{row.name}"</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <TipLabel htmlFor="row-currency" help="row.currency">Amounts in this row are in</TipLabel>
            <NativeSelect id="row-currency" className="w-full" value={ccy} onChange={(e) => setCcy(e.target.value)}>
              {codes.map((c) => <option key={c} value={c}>{currencyLabel(c, base)}</option>)}
            </NativeSelect>
            <p className="text-xs text-muted-foreground">{HELP['row.currency'].text}</p>
          </div>
          {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={() => void save(() => updateRow(store, row.id, { currency: ccy === base ? null : ccy }))} disabled={busy}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** Take this spending row out of an income row: the income shows what is left, and the shares count the net. */
export function RowDeductionDialog({ row, tables, household, onClose }: Base) {
  const store = useStore()
  const rule = household.closingRule
  // live income rows; an archived one stays listed while this row is still deducted from it (the engine stops at its archive month)
  const incomes = sortRows(tables.rows.filter((r) => !r.deletedAt && r.section === 'income' && (!r.archivedMonth || r.id === row.deductedFromRowId) && !derivedRowReason(r, rule)), tables.categories)
  const [targetId, setTargetId] = useState(row.deductedFromRowId ?? '')
  const { error, busy, save } = useSave(onClose)

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Deducted from an income</DialogTitle>
          <DialogDescription>Row "{row.name}"</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <TipLabel htmlFor="row-deducted-from" help="row.deductedFrom">This expense is taken off</TipLabel>
            <NativeSelect id="row-deducted-from" className="w-full" value={targetId} onChange={(e) => setTargetId(e.target.value)}>
              <option value="">Nothing: a normal expense</option>
              {incomes.map((r) => <option key={r.id} value={r.id}>{r.name}{r.archivedMonth ? ' (archived)' : ''}</option>)}
            </NativeSelect>
            <p className="text-xs text-muted-foreground">{HELP['row.deductedFrom'].text} The row then belongs to whoever that income belongs to.</p>
          </div>
          {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={() => void save(async () => { if (targetId !== (row.deductedFromRowId ?? '')) await setRowDeductedFrom(store, row.id, targetId || null) })} disabled={busy}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** Who a row is for: the household, an adult, or a child, pet or thing (routed to whoever pays for them). */
export function RowScopeDialog({ row, tables, onClose }: Base) {
  const store = useStore()
  const live = tables.entities.filter((e) => !e.deletedAt && (!e.archivedMonth || e.id === row.scope)).sort((a, b) => (a.order < b.order ? -1 : a.order > b.order ? 1 : 0))
  const adults = live.filter((e) => e.kind === 'adult')
  const others = live.filter((e) => e.kind !== 'adult')
  const [scope, setScope] = useState(row.scope)
  const [inShareBasis, setInShareBasis] = useState(row.inShareBasis)
  const { error, busy, save } = useSave(onClose)

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Belongs to</DialogTitle>
          <DialogDescription>Row "{row.name}"</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <TipLabel htmlFor="row-belongs-to" help="row.belongsTo">This row is for</TipLabel>
            <NativeSelect id="row-belongs-to" className="w-full" value={scope} onChange={(e) => setScope(e.target.value)}>
              <option value="shared">The household (shared)</option>
              {adults.length > 0 && <optgroup label="Adults">{adults.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}</optgroup>}
              {others.length > 0 && <optgroup label="Other people & things">{others.map((e) => <option key={e.id} value={e.id}>{e.name} · {ENTITY_KIND_LABEL[e.kind].toLowerCase()}</option>)}</optgroup>}
            </NativeSelect>
            <p className="text-xs text-muted-foreground">{HELP['row.belongsTo'].text}</p>
          </div>
          {row.section === 'income' && (
            <div className="flex items-center gap-1">
              <Check label="Counts for the split" checked={inShareBasis} disabled={scope === 'shared'} onChange={(e) => setInShareBasis(e.target.checked)} />
              <InfoTip help="row.inShareBasis" />
            </div>
          )}
          {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={() => void save(() => setRowScope(store, row.id, scope, row.section === 'income' ? inShareBasis : undefined))} disabled={busy}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
