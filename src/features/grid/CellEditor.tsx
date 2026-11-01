import { useEffect, useMemo, useState } from 'react'
import { Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'
import { amountToInput, formatAmount, formatMonth, parseAmount } from '@/app/format'
import { readPref, writePref } from '@/app/prefs'
import { useStore } from '@/app/store'
import { cellKey, type EngineOutput } from '@/engine'
import { newId, poolRef, type CellItem, type Household, type ItemStatus, type MonthKey, type Row, type Tables } from '@/model'
import { clearCell, itemsFromCurrent, reopenMonth, setCellItems, setCellValue, type EditScope } from '@/store'
import { NativeSelect } from './NativeSelect'

interface Props {
  tables: Tables
  engine: EngineOutput
  household: Household
  row: Row
  month: MonthKey
  onClose: () => void
}

type Mode = 'value' | 'items'
type StatusChoice = 'default' | ItemStatus

const STATUS_LABEL: Record<ItemStatus, string> = { projected: 'Estimate', committed: 'Certain', done: 'Done' }

export function CellEditor({ tables, engine, household, row, month, onClose }: Props) {
  const store = useStore()
  const cell = engine.cells[cellKey(row.id, month)]
  const closed = engine.totals[month]?.closed ?? false
  const currency = row.currency ?? household.baseCurrency
  const locale = household.locale

  // "How sure" on a single amount is stored as one unlabelled item; keep showing it as a single amount
  const soloItem = cell?.source === 'items' && cell.items.length === 1 && cell.items[0].kind === 'normal' && !cell.items[0].label && !cell.items[0].recurringItemId && !cell.items[0].skipped ? cell.items[0] : null
  const [mode, setMode] = useState<Mode>(cell?.source === 'items' && !soloItem ? 'items' : 'value')
  const [text, setText] = useState(() => amountToInput(cell?.value ?? 0, currency, locale))
  const [scope, setScope] = useState<EditScope>(() => readPref<EditScope>('editScope', 'from-now-on'))
  const [status, setStatus] = useState<StatusChoice>(soloItem ? soloItem.status : 'default')
  const [items, setItems] = useState<CellItem[]>(() => itemsFromCurrent(cell, row.defaultFundedBy, row.defaultStatus))
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const pools = useMemo(() => tables.pools.filter((p) => !p.deletedAt), [tables.pools])
  const fundingOptions = useMemo(
    () => [
      { value: 'cash', label: 'Cash (this month)' },
      { value: 'savings', label: 'Savings' },
      ...pools.map((p) => ({ value: poolRef(p.id), label: `Pool: ${p.name}` })),
    ],
    [pools],
  )

  useEffect(() => {
    writePref('editScope', scope)
  }, [scope])

  const itemsTotal = items.filter((i) => !i.skipped).reduce((s, i) => s + (i.kind === 'carry' ? (cell?.items.find((x) => x.id === i.id)?.effectiveAmount ?? prevValue()) : i.amount), 0)

  function prevValue(): number {
    const idx = engine.months.indexOf(month)
    if (idx <= 0) return 0
    return engine.cells[cellKey(row.id, engine.months[idx - 1])]?.value ?? 0
  }

  async function run(fn: () => Promise<void>) {
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

  function saveValue() {
    const minor = text.trim() === '' ? 0 : parseAmount(text, currency, locale)
    if (minor == null) {
      setError('That is not a number I can read.')
      return
    }
    if (status === 'default') return void run(() => setCellValue(store, row.id, month, minor, scope))
    const single: CellItem = { id: newId(), label: '', amount: minor, status, fundedBy: row.defaultFundedBy, date: null, note: null, recurringItemId: null, kind: 'normal', skipped: false }
    void run(() => setCellItems(store, row.id, month, [single], scope))
  }

  function saveItems() {
    for (const it of items) if (it.kind === 'normal' && !Number.isFinite(it.amount)) return setError('Every item needs an amount.')
    void run(() => setCellItems(store, row.id, month, items, scope))
  }

  function updateItem(id: string, patch: Partial<CellItem>) {
    setItems((list) => list.map((it) => (it.id === id ? { ...it, ...patch } : it)))
  }

  function addItem() {
    setItems((list) => [
      ...list,
      { id: newId(), label: '', amount: 0, status: row.defaultStatus, fundedBy: row.defaultFundedBy, date: null, note: null, recurringItemId: null, kind: 'normal', skipped: false },
    ])
  }

  const title = `${row.name} · ${formatMonth(month, locale, 'long')}`
  const sourceText =
    cell?.source === 'inherit' ? 'Carried from the previous month' :
    cell?.source === 'value' ? 'Set in this month' :
    cell?.source === 'items' ? (soloItem ? 'Set in this month' : `${cell.items.length} item${cell.items.length === 1 ? '' : 's'}`) :
    cell?.source === 'empty' ? 'Nothing yet' : ''

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="sm:max-w-xl" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {sourceText}{cell ? ` · currently ${formatAmount(cell.value, currency, locale)}` : ''}
          </DialogDescription>
        </DialogHeader>

        {closed ? (
          <div className="space-y-3">
            <p className="text-sm">This month is closed. Reopen it to make changes.</p>
            <Button variant="outline" onClick={() => void run(() => reopenMonth(store, month))} disabled={busy}>Reopen {formatMonth(month, locale)}</Button>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="inline-flex rounded-md border p-0.5 text-sm" role="tablist">
              <button role="tab" aria-selected={mode === 'value'} className={cn('rounded px-3 py-1', mode === 'value' && 'bg-muted font-medium')} onClick={() => setMode('value')}>Single amount</button>
              <button role="tab" aria-selected={mode === 'items'} className={cn('rounded px-3 py-1', mode === 'items' && 'bg-muted font-medium')} onClick={() => setMode('items')}>Itemized</button>
            </div>

            {mode === 'value' ? (
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <Label htmlFor="cell-amount">Amount in {currency}</Label>
                  <Input id="cell-amount" autoFocus inputMode="decimal" value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') saveValue() }} placeholder="0" />
                </div>
                <fieldset className="space-y-1.5">
                  <legend className="text-sm font-medium">Applies to</legend>
                  <Segmented value={scope} onChange={(v) => setScope(v as EditScope)} options={[{ value: 'from-now-on', label: 'This month and onwards' }, { value: 'this-month', label: 'Only this month' }]} />
                  <p className="text-xs text-muted-foreground">
                    {scope === 'from-now-on' ? 'Later months that follow this row will pick up the new amount.' : 'The next month keeps the old amount.'}
                  </p>
                </fieldset>
                <fieldset className="space-y-1.5">
                  <legend className="text-sm font-medium">How sure</legend>
                  <Segmented
                    value={status}
                    onChange={(v) => setStatus(v as StatusChoice)}
                    options={[
                      { value: 'default', label: `Row default (${STATUS_LABEL[row.defaultStatus]})` },
                      { value: 'projected', label: 'Estimate' },
                      { value: 'committed', label: 'Certain' },
                      { value: 'done', label: 'Done' },
                    ]}
                  />
                </fieldset>
              </div>
            ) : (
              <div className="space-y-2">
                {items.length === 0 && <p className="text-sm text-muted-foreground">No items yet.</p>}
                {items.map((it) =>
                  it.kind === 'carry' ? (
                    <div key={it.id} className="flex items-center gap-2 rounded-md border border-dashed px-2 py-1.5 text-sm">
                      <span className="flex-1 text-muted-foreground">Carried from previous month</span>
                      <span className="tabular-nums">{formatAmount(prevValue(), currency, locale)}</span>
                      <Button size="icon" variant="ghost" aria-label="Remove carried amount" onClick={() => setItems((l) => l.filter((x) => x.id !== it.id))}><Trash2 /></Button>
                    </div>
                  ) : (
                    <div key={it.id} className="grid grid-cols-[1fr_7rem] gap-2 rounded-md border p-2 sm:grid-cols-[1fr_7rem_7rem_9rem_2rem]">
                      <Input aria-label="Item label" placeholder="What" value={it.label} onChange={(e) => updateItem(it.id, { label: e.target.value })} />
                      <Input
                        aria-label="Item amount" inputMode="decimal" placeholder="0"
                        defaultValue={amountToInput(it.amount, currency, locale)}
                        onChange={(e) => { const v = parseAmount(e.target.value, currency, locale); updateItem(it.id, { amount: v ?? 0 }) }}
                      />
                      <NativeSelect aria-label="Item status" value={it.status} onChange={(e) => updateItem(it.id, { status: e.target.value as ItemStatus })}>
                        {(['projected', 'committed', 'done'] as ItemStatus[]).map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
                      </NativeSelect>
                      <NativeSelect aria-label="Funded by" value={it.fundedBy} onChange={(e) => updateItem(it.id, { fundedBy: e.target.value as CellItem['fundedBy'] })} disabled={row.section !== 'expense'}>
                        {fundingOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                      </NativeSelect>
                      <Button size="icon" variant="ghost" aria-label="Remove item" onClick={() => setItems((l) => l.filter((x) => x.id !== it.id))}><Trash2 /></Button>
                    </div>
                  ),
                )}
                <div className="flex items-center justify-between">
                  <Button size="sm" variant="outline" onClick={addItem}>Add item</Button>
                  <span className="text-sm tabular-nums">Total {formatAmount(itemsTotal, currency, locale)}</span>
                </div>
                <Segmented value={scope} onChange={(v) => setScope(v as EditScope)} options={[{ value: 'from-now-on', label: 'This month and onwards' }, { value: 'this-month', label: 'Only this month' }]} />
              </div>
            )}
            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>
        )}

        {!closed && (
          <DialogFooter className="flex-row flex-wrap gap-2 sm:justify-between">
            <Button variant="ghost" onClick={() => void run(() => clearCell(store, row.id, month))} disabled={busy || !cell?.cell}>Clear (inherit)</Button>
            <div className="flex gap-2">
              <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
              <Button onClick={mode === 'value' ? saveValue : saveItems} disabled={busy}>Save</Button>
            </div>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  )
}

function Segmented({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: Array<{ value: string; label: string }> }) {
  return (
    <div className="flex flex-wrap gap-1" role="radiogroup">
      {options.map((o) => (
        <button
          key={o.value} type="button" role="radio" aria-checked={value === o.value}
          className={cn('rounded-md border px-2.5 py-1 text-xs', value === o.value ? 'border-foreground bg-foreground text-background' : 'hover:bg-muted')}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}
