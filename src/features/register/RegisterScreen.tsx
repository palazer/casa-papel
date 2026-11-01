import { useMemo, useState } from 'react'
import { MoreHorizontal } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Check } from '@/components/Check'
import { MonthPicker } from '@/components/MonthPicker'
import { NativeSelect } from '@/features/grid/NativeSelect'
import { amountToInput, formatAmount, formatMonth, parseAmount } from '@/app/format'
import { useStore } from '@/app/store'
import { activeHousehold, defaultMonths, useTables } from '@/app/useEngine'
import { sortRows as sortRowsModel } from '@/engine'
import {
  describeCadence, monthOfDate, poolRef,
  type Household, type MonthKey, type RecurringItem, type Row, type Section, type Tables,
} from '@/model'
import { addRecurringItem, addRow, deleteRecurringItem, endRecurringItem, recurringStatus, setRecurringPaid, updateRecurringItem, type RecurringInput } from '@/store'

const MONTH_NAMES = Array.from({ length: 12 }, (_, i) => new Intl.DateTimeFormat('en', { month: 'short' }).format(new Date(2026, i, 1)))

export function RegisterScreen() {
  const store = useStore()
  const tables = useTables()
  const household = activeHousehold(tables)
  const months = useMemo(() => (household && tables ? defaultMonths(household, tables) : []), [household, tables])
  const [month, setMonth] = useState<MonthKey>(() => monthOfDate())
  const [editing, setEditing] = useState<RecurringItem | 'new' | null>(null)
  const [error, setError] = useState<string | null>(null)
  if (!tables || !household) return null
  const { locale, baseCurrency } = household
  const m = months.includes(month) ? month : months[months.length - 1]
  const items = tables.recurringItems.filter((r) => !r.deletedAt).sort((a, b) => a.name.localeCompare(b.name))
  const rowName = (id: string) => tables.rows.find((r) => r.id === id)?.name ?? '?'
  const accountName = (id: string | null) => (id ? tables.accounts.find((a) => a.id === id)?.name ?? '' : '')
  const act = (fn: () => Promise<unknown>) => void fn().catch((e) => setError(e instanceof Error ? e.message : 'Action failed'))

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <MonthPicker months={months} month={m} onChange={setMonth} locale={locale} />
      {error && <p className="text-sm text-destructive">{error}</p>}
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">Recurring payments and incomes. They are posted into their due months automatically; rows with recurring items stop carrying amounts forward.</p>
        <Button onClick={() => setEditing('new')}>Add recurring</Button>
      </div>
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
            <tr><th className="px-3 py-2 font-medium">Name</th><th className="px-3 py-2 font-medium">Row</th><th className="px-3 py-2 text-right font-medium">Amount</th><th className="px-3 py-2 font-medium">When</th><th className="px-3 py-2 font-medium">Account</th><th className="px-3 py-2 font-medium">{formatMonth(m, locale)}</th><th className="px-1 py-2" /></tr>
          </thead>
          <tbody className="divide-y">
            {items.map((it) => {
              const status = recurringStatus(tables, it, m)
              const ended = it.endMonth != null && it.endMonth < m
              return (
                <tr key={it.id} className={ended ? 'text-muted-foreground' : ''}>
                  <td className="px-3 py-2 font-medium">{it.name}{ended && <span className="ml-1 text-xs font-normal">(ended {formatMonth(it.endMonth!, locale)})</span>}</td>
                  <td className="px-3 py-2">{rowName(it.rowId)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatAmount(it.amount, it.currency ?? baseCurrency, locale)}</td>
                  <td className="px-3 py-2">{describeCadence(it, locale)}</td>
                  <td className="px-3 py-2">{accountName(it.accountId)}</td>
                  <td className="px-3 py-2">
                    {status === 'not-due' ? <span className="text-muted-foreground">—</span> : (
                      <Check
                        label={<Badge variant={status === 'paid' ? 'secondary' : status === 'skipped' ? 'outline' : 'default'}>{status === 'paid' ? 'Paid' : status === 'skipped' ? 'Skipped' : 'Due'}</Badge>}
                        checked={status === 'paid'}
                        aria-label={`${it.name} paid in ${formatMonth(m, locale)}`}
                        onChange={(e) => act(() => setRecurringPaid(store, it.id, m, e.target.checked))}
                      />
                    )}
                  </td>
                  <td className="px-1 py-2">
                    <DropdownMenu>
                      <DropdownMenuTrigger render={<Button variant="ghost" size="icon" className="size-7" aria-label={`Menu for ${it.name}`} />}><MoreHorizontal /></DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => setEditing(it)}>Edit…</DropdownMenuItem>
                        {ended ? (
                          <DropdownMenuItem onClick={() => act(() => endRecurringItem(store, it.id, null))}>Reactivate</DropdownMenuItem>
                        ) : (
                          <DropdownMenuItem onClick={() => act(() => endRecurringItem(store, it.id, m))}>End after {formatMonth(m, locale)}</DropdownMenuItem>
                        )}
                        <DropdownMenuItem onClick={() => act(() => deleteRecurringItem(store, it.id))}>Delete</DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </td>
                </tr>
              )
            })}
            {items.length === 0 && <tr><td colSpan={7} className="px-3 py-6 text-center text-muted-foreground">Nothing recurring yet. Rent, salary, insurance, subscriptions all belong here.</td></tr>}
          </tbody>
        </table>
      </div>
      {editing && <RecurringDialog tables={tables} household={household} item={editing === 'new' ? null : editing} defaultMonth={m} onClose={() => setEditing(null)} onError={setError} />}
    </div>
  )
}

type CadenceChoice = '1' | '2' | '3' | '6' | '12' | 'months'

export function RecurringDialog({ tables, household, item, defaultMonth, onClose, onError }: { tables: Tables; household: Household; item: RecurringItem | null; defaultMonth: MonthKey; onClose: () => void; onError: (m: string) => void }) {
  const store = useStore()
  const { locale, baseCurrency } = household
  const rows = sortRowsModel(tables.rows.filter((r) => !r.deletedAt && !r.archivedMonth && r.kind !== 'to-savings' && r.pocketMode == null))
  const adults = tables.entities.filter((e) => e.kind === 'adult' && !e.deletedAt)
  const pools = tables.pools.filter((p) => !p.deletedAt)
  const [name, setName] = useState(item?.name ?? '')
  const [rowId, setRowId] = useState(item?.rowId ?? rows[0]?.id ?? '__new__')
  const [newRowName, setNewRowName] = useState('')
  const [newRowSection, setNewRowSection] = useState<Section>('expense')
  const [amount, setAmount] = useState(item ? amountToInput(item.amount, item.currency ?? baseCurrency, locale) : '')
  const [cadence, setCadence] = useState<CadenceChoice>(() => (item?.dueMonths?.length ? 'months' : String(item?.cadence?.intervalMonths ?? 1) as CadenceChoice))
  const [anchor, setAnchor] = useState<number>(item?.cadence?.anchorMonth ?? Number(defaultMonth.slice(5)))
  const [dueMonths, setDueMonths] = useState<Set<number>>(() => new Set(item?.dueMonths ?? []))
  const [accountId, setAccountId] = useState(item?.accountId ?? '')
  const [scope, setScope] = useState(item?.scope ?? 'shared')
  const [fundedBy, setFundedBy] = useState<string>(item?.fundedBy ?? 'cash')
  const [startMonth, setStartMonth] = useState(item?.startMonth ?? defaultMonth)
  const [endMonth, setEndMonth] = useState(item?.endMonth ?? '')
  const [notes, setNotes] = useState(item?.notes ?? '')

  async function save() {
    const minor = parseAmount(amount, baseCurrency, locale)
    if (minor == null) return onError('Amount is not a number I can read.')
    if (!name.trim()) return onError('Give it a name.')
    let targetRow = rowId
    if (rowId === '__new__') {
      if (!newRowName.trim()) return onError('Name the new row.')
      const r = await addRow(store, { name: newRowName.trim(), section: newRowSection, defaultStatus: 'committed' })
      targetRow = r.id
    }
    const base: Partial<RecurringInput> = {
      name: name.trim(), rowId: targetRow, amount: minor, currency: null,
      cadence: cadence === 'months' ? null : { intervalMonths: Number(cadence) as 1 | 2 | 3 | 6 | 12, anchorMonth: cadence === '1' ? 1 : anchor },
      dueMonths: cadence === 'months' ? [...dueMonths] : null,
      accountId: accountId || null, scope, fundedBy: fundedBy as RecurringInput['fundedBy'],
      startMonth, endMonth: endMonth || null, notes,
    }
    if (cadence === 'months' && dueMonths.size === 0) return onError('Pick at least one month.')
    if (item) await updateRecurringItem(store, item.id, base)
    else await addRecurringItem(store, base as Parameters<typeof addRecurringItem>[1])
    onClose()
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="sm:max-w-lg" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>{item ? 'Edit recurring item' : 'New recurring item'}</DialogTitle>
          <DialogDescription>Posted into every due month that is still open.</DialogDescription>
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
          <div className="space-y-1.5"><Label htmlFor="rc-account">Paid from</Label><NativeSelect id="rc-account" className="w-full" value={accountId} onChange={(e) => setAccountId(e.target.value)}><option value="">—</option>{tables.accounts.filter((a) => !a.deletedAt).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</NativeSelect></div>
          <div className="space-y-1.5"><Label htmlFor="rc-scope">Whose</Label><NativeSelect id="rc-scope" className="w-full" value={scope} onChange={(e) => setScope(e.target.value)}><option value="shared">Shared</option>{adults.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</NativeSelect></div>
          <div className="space-y-1.5"><Label htmlFor="rc-funded">Funded by</Label><NativeSelect id="rc-funded" className="w-full" value={fundedBy} onChange={(e) => setFundedBy(e.target.value)}><option value="cash">Cash (this month)</option><option value="savings">Savings</option>{pools.map((p) => <option key={p.id} value={poolRef(p.id)}>Pool: {p.name}</option>)}</NativeSelect></div>
          <div className="space-y-1.5"><Label htmlFor="rc-start">From month</Label><Input id="rc-start" type="month" value={startMonth} onChange={(e) => setStartMonth(e.target.value)} /></div>
          <div className="space-y-1.5"><Label htmlFor="rc-end">Until month (optional)</Label><Input id="rc-end" type="month" value={endMonth} onChange={(e) => setEndMonth(e.target.value)} /></div>
          <div className="space-y-1.5 sm:col-span-2"><Label htmlFor="rc-notes">Notes</Label><Input id="rc-notes" value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => void save().catch((e) => onError(e instanceof Error ? e.message : 'Could not save'))}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
