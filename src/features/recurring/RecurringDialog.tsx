import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Check } from '@/components/Check'
import { MonthField } from '@/components/MonthField'
import { NativeSelect } from '@/features/grid/NativeSelect'
import { amountToInput, parseAmount } from '@/app/format'
import { useStore } from '@/app/store'
import { sortRows } from '@/engine'
import { poolRef, type Household, type MonthKey, type RecurringItem, type Row, type Section, type Tables } from '@/model'
import { addRecurringItem, addRow, updateRecurringItem, type RecurringInput } from '@/store'

const MONTH_NAMES = Array.from({ length: 12 }, (_, i) => new Intl.DateTimeFormat('en', { month: 'short' }).format(new Date(2026, i, 1)))
type CadenceChoice = '1' | '2' | '3' | '6' | '12' | 'months'

export interface RecurringPrefill { rowId?: string; name?: string; amount?: number }

interface Props {
  tables: Tables
  household: Household
  /** null = create */
  item: RecurringItem | null
  defaultMonth: MonthKey
  prefill?: RecurringPrefill
  onClose: () => void
  onSaved?: () => void
}

export function RecurringDialog({ tables, household, item, defaultMonth, prefill, onClose, onSaved }: Props) {
  const store = useStore()
  const { locale, baseCurrency } = household
  const rows = sortRows(tables.rows.filter((r) => !r.deletedAt && !r.archivedMonth && r.kind !== 'to-savings' && r.pocketMode == null))
  const adults = tables.entities.filter((e) => e.kind === 'adult' && !e.deletedAt)
  const pools = tables.pools.filter((p) => !p.deletedAt)
  const [name, setName] = useState(item?.name ?? prefill?.name ?? '')
  const [rowId, setRowId] = useState(item?.rowId ?? prefill?.rowId ?? rows[0]?.id ?? '__new__')
  const [newRowName, setNewRowName] = useState('')
  const [newRowSection, setNewRowSection] = useState<Section>('expense')
  const [amount, setAmount] = useState(() => {
    const minor = item?.amount ?? prefill?.amount
    return minor == null ? '' : amountToInput(minor, item?.currency ?? baseCurrency, locale)
  })
  const [cadence, setCadence] = useState<CadenceChoice>(() => (item?.dueMonths?.length ? 'months' : (String(item?.cadence?.intervalMonths ?? 1) as CadenceChoice)))
  const [anchor, setAnchor] = useState<number>(item?.cadence?.anchorMonth ?? Number(defaultMonth.slice(5)))
  const [dueMonths, setDueMonths] = useState<Set<number>>(() => new Set(item?.dueMonths ?? []))
  const [accountId, setAccountId] = useState(item?.accountId ?? '')
  const [scope, setScope] = useState(item?.scope ?? 'shared')
  const [fundedBy, setFundedBy] = useState<string>(item?.fundedBy ?? 'cash')
  const [startMonth, setStartMonth] = useState(item?.startMonth ?? defaultMonth)
  const [endMonth, setEndMonth] = useState(item?.endMonth ?? '')
  const [notes, setNotes] = useState(item?.notes ?? '')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  // wording follows the row: income arrives somewhere, spending leaves from somewhere and is funded by something
  const section: Section = rowId === '__new__' ? newRowSection : (rows.find((r) => r.id === rowId)?.section ?? 'expense')
  const accountLabel = section === 'income' ? 'Paid into' : section === 'transfer' ? 'From account' : 'Paid from'
  const accountHelp = section === 'income' ? 'Which of your accounts receives it. For your overview only; the sums do not change.' : 'Which of your accounts the money leaves. For your overview only; the sums do not change.'

  async function save() {
    const minor = parseAmount(amount, baseCurrency, locale)
    if (minor == null) return setError('Amount is not a number I can read.')
    if (!name.trim()) return setError('Give it a name.')
    if (rowId === '__new__' && !newRowName.trim()) return setError('Name the new row.')
    if (cadence === 'months' && dueMonths.size === 0) return setError('Pick at least one month.')
    if (endMonth && endMonth < startMonth) return setError('"Until" is before "From".')
    setBusy(true)
    setError(null)
    try {
      let targetRow = rowId
      if (rowId === '__new__') {
        const r = await addRow(store, { name: newRowName.trim(), section: newRowSection, defaultStatus: 'committed' })
        targetRow = r.id
      }
      const base: Partial<RecurringInput> = {
        name: name.trim(), rowId: targetRow, amount: minor, currency: null,
        cadence: cadence === 'months' ? null : { intervalMonths: Number(cadence) as 1 | 2 | 3 | 6 | 12, anchorMonth: cadence === '1' ? 1 : anchor },
        dueMonths: cadence === 'months' ? [...dueMonths] : null,
        accountId: accountId || null, scope, fundedBy: section === 'expense' ? (fundedBy as RecurringInput['fundedBy']) : 'cash',
        startMonth, endMonth: endMonth || null, notes,
      }
      if (item) await updateRecurringItem(store, item.id, base)
      else await addRecurringItem(store, base as Parameters<typeof addRecurringItem>[1])
      onSaved?.()
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="sm:max-w-lg" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>{item ? 'Edit recurring item' : 'New recurring item'}</DialogTitle>
          <DialogDescription>Posted into every due month that is still open. Change the amount here and every open month follows.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5 sm:col-span-2"><Label htmlFor="rc-name">Name</Label><Input id="rc-name" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Car insurance" /></div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="rc-row">Grid row</Label>
            <NativeSelect id="rc-row" className="w-full" value={rowId} onChange={(e) => setRowId(e.target.value)}>
              {(['income', 'expense', 'transfer'] as Section[]).map((s) => (
                <optgroup key={s} label={s[0].toUpperCase() + s.slice(1)}>
                  {rows.filter((r) => r.section === s).map((r: Row) => <option key={r.id} value={r.id}>{r.name}</option>)}
                </optgroup>
              ))}
              <option value="__new__">+ New row…</option>
            </NativeSelect>
          </div>
          {rowId === '__new__' && (
            <>
              <div className="space-y-1.5"><Label htmlFor="rc-newrow">New row name</Label><Input id="rc-newrow" value={newRowName} onChange={(e) => setNewRowName(e.target.value)} /></div>
              <div className="space-y-1.5"><Label htmlFor="rc-newsec">Section</Label><NativeSelect id="rc-newsec" className="w-full" value={newRowSection} onChange={(e) => setNewRowSection(e.target.value as Section)}><option value="expense">Expense</option><option value="income">Income</option><option value="transfer">Transfer</option></NativeSelect></div>
            </>
          )}
          <div className="space-y-1.5"><Label htmlFor="rc-amount">Amount ({baseCurrency})</Label><Input id="rc-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></div>
          <div className="space-y-1.5">
            <Label htmlFor="rc-cadence">How often</Label>
            <NativeSelect id="rc-cadence" className="w-full" value={cadence} onChange={(e) => setCadence(e.target.value as CadenceChoice)}>
              <option value="1">Monthly</option><option value="2">Every 2 months</option><option value="3">Every 3 months</option><option value="6">Every 6 months</option><option value="12">Yearly</option><option value="months">Specific months</option>
            </NativeSelect>
          </div>
          {cadence !== '1' && cadence !== 'months' && (
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="rc-anchor">{cadence === '12' ? 'In which month' : 'Starting from which month of the year'}</Label>
              <NativeSelect id="rc-anchor" className="w-full" value={anchor} onChange={(e) => setAnchor(Number(e.target.value))}>{MONTH_NAMES.map((n, i) => <option key={n} value={i + 1}>{n}</option>)}</NativeSelect>
            </div>
          )}
          {cadence === 'months' && (
            <fieldset className="grid grid-cols-4 gap-1 sm:col-span-2">
              {MONTH_NAMES.map((n, i) => <Check key={n} label={n} checked={dueMonths.has(i + 1)} onChange={(e) => { const s = new Set(dueMonths); if (e.target.checked) s.add(i + 1); else s.delete(i + 1); setDueMonths(s) }} />)}
            </fieldset>
          )}
          <div className="space-y-1.5"><Label htmlFor="rc-account">{accountLabel}</Label><NativeSelect id="rc-account" className="w-full" value={accountId} onChange={(e) => setAccountId(e.target.value)}><option value="">—</option>{tables.accounts.filter((a) => !a.deletedAt).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</NativeSelect></div>
          <p className="-mt-2 text-xs text-muted-foreground sm:col-span-2">{accountHelp}</p>
          <div className="space-y-1.5"><Label htmlFor="rc-scope">Whose</Label><NativeSelect id="rc-scope" className="w-full" value={scope} onChange={(e) => setScope(e.target.value)}><option value="shared">Shared</option>{adults.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</NativeSelect></div>
          {section === 'expense' && <div className="space-y-1.5"><Label htmlFor="rc-funded">Comes out of</Label><NativeSelect id="rc-funded" className="w-full" value={fundedBy} onChange={(e) => setFundedBy(e.target.value)}><option value="cash">This month's income</option><option value="savings">Savings balance</option>{pools.map((p) => <option key={p.id} value={poolRef(p.id)}>Pool: {p.name}</option>)}</NativeSelect><p className="text-xs text-muted-foreground">Spending from savings or a pool does not reduce this month's leftover.</p></div>}
          <div className="space-y-1.5"><Label>From month</Label><MonthField label="From month" value={startMonth} onChange={setStartMonth} locale={locale} /></div>
          <div className="space-y-1.5"><Label>Until month (optional)</Label><MonthField label="Until month" value={endMonth} onChange={setEndMonth} locale={locale} allowEmpty /></div>
          <div className="space-y-1.5 sm:col-span-2"><Label htmlFor="rc-notes">Notes</Label><Input id="rc-notes" value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
        </div>
        {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={() => void save()} disabled={busy}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
