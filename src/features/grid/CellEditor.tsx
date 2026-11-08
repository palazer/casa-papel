import { useEffect, useMemo, useState } from 'react'
import { Repeat, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Segmented } from '@/components/Segmented'
import { cn } from '@/lib/utils'
import { amountToInput, formatAmount, formatMonth, parseAmount } from '@/app/format'
import { readPref, writePref } from '@/app/prefs'
import { useStore } from '@/app/store'
import { cellKey, type EngineOutput } from '@/engine'
import { RecurringDialog } from '@/features/recurring/RecurringDialog'
import { compareMonths, describeCadence, newId, type CellItem, type Household, type ItemStatus, type MonthKey, type Row, type Tables } from '@/model'
import {
  changeRecurringFrom, clearCell, endRecurringFrom, itemsFromCurrent, reopenMonth, setCellItems, setCellValue, skipRecurringMonth,
  type EditScope,
} from '@/store'
import { RemoveDialog } from '@/features/remove/RemoveDialog'
import { DoneDot } from './DoneDot'
import { NativeSelect } from './NativeSelect'
import { RateLine } from './RateLine'
import { fundingOptions as buildFundingOptions } from './funding'
import { HELP } from '@/app/help'
import { InfoTip, TipLabel } from '@/components/InfoTip'

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
  // the engine's currency: a follower takes its target's
  const currency = cell?.currency ?? row.currency ?? household.baseCurrency
  const locale = household.locale
  /** Rows driven by a schedule: no carry-forward, no single amount; the posted items are the content. */
  const isRecurringRow = engine.recurringRowIds.includes(row.id)
  /** Expense rows taken out of this income, with this month's amount in the base currency. */
  const deductions = row.section === 'income'
    ? tables.rows.filter((r) => !r.deletedAt && (!r.archivedMonth || compareMonths(r.archivedMonth, month) > 0) && r.deductedFromRowId === row.id).map((r) => ({ id: r.id, name: r.name, valueBase: engine.cells[cellKey(r.id, month)]?.valueBase ?? 0 }))
    : []

  // "How sure" on a single amount is stored as one unlabelled item; keep showing it as a single amount
  const soloItem = cell?.source === 'items' && cell.items.length === 1 && cell.items[0].kind === 'normal' && !cell.items[0].label && !cell.items[0].recurringItemId && !cell.items[0].skipped ? cell.items[0] : null
  const [mode, setMode] = useState<Mode>(isRecurringRow || (cell?.source === 'items' && !soloItem) ? 'items' : 'value')
  const [text, setText] = useState(() => amountToInput(cell?.value ?? 0, currency, locale))
  const [scope, setScope] = useState<EditScope>(() => readPref<EditScope>('editScope', 'from-now-on'))
  const [status, setStatus] = useState<StatusChoice>(soloItem ? soloItem.status : 'default')
  const [fundedBy, setFundedBy] = useState<CellItem['fundedBy']>(soloItem ? soloItem.fundedBy : row.defaultFundedBy)
  const [items, setItems] = useState<CellItem[]>(() => itemsFromCurrent(cell, row.defaultFundedBy, row.defaultStatus))
  /** For edited scheduled items: does the change apply only here or from this month on? */
  const [applyTo, setApplyTo] = useState<Record<string, EditScope>>({})
  const [removing, setRemoving] = useState<string | null>(null)
  /** "All occurrences" hands the schedule to the remove dialog, which says what goes with it. */
  const [removingSchedule, setRemovingSchedule] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [recurring, setRecurring] = useState(false)

  const original = useMemo(() => new Map((cell?.items ?? []).map((i) => [i.id, i])), [cell])
  const schedules = useMemo(() => new Map(tables.recurringItems.map((r) => [r.id, r])), [tables.recurringItems])
  const fundingOptions = useMemo(() => buildFundingOptions(tables.pools, [row.defaultFundedBy, ...items.map((i) => i.fundedBy)]), [tables.pools, row.defaultFundedBy, items])

  useEffect(() => {
    writePref('editScope', scope)
  }, [scope])

  const itemsTotal = items.filter((i) => !i.skipped).reduce((s, i) => s + (i.kind === 'carry' ? (cell?.items.find((x) => x.id === i.id)?.effectiveAmount ?? prevValue()) : i.amount), 0)

  function prevValue(): number {
    const idx = engine.months.indexOf(month)
    if (idx <= 0) return 0
    return engine.cells[cellKey(row.id, engine.months[idx - 1])]?.value ?? 0
  }

  async function run(fn: () => Promise<void>, close = true) {
    setBusy(true)
    setError(null)
    try {
      await fn()
      if (close) onClose()
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
    // A plain value takes the row's defaults; any other certainty or source is stored as one unlabelled item.
    if (status === 'default' && fundedBy === row.defaultFundedBy) return void run(() => setCellValue(store, row.id, month, minor, scope))
    const single: CellItem = { id: newId(), label: '', amount: minor, status: status === 'default' ? row.defaultStatus : status, fundedBy, date: null, note: null, recurringItemId: null, kind: 'normal', skipped: false }
    void run(() => setCellItems(store, row.id, month, [single], scope))
  }

  /** A scheduled item whose amount or funding was edited here. */
  const changedScheduled = (it: CellItem) => {
    const o = original.get(it.id)
    return !!it.recurringItemId && !!o && (o.amount !== it.amount || o.fundedBy !== it.fundedBy)
  }

  function saveItems() {
    for (const it of items) if (it.kind === 'normal' && !Number.isFinite(it.amount)) return setError('Every item needs an amount.')
    void run(async () => {
      let next = items
      for (const it of items) {
        if (!changedScheduled(it) || !it.recurringItemId) continue
        if ((applyTo[it.id] ?? 'this-month') === 'from-now-on') {
          const newId_ = await changeRecurringFrom(store, it.recurringItemId, month, { amount: it.amount, fundedBy: it.fundedBy })
          next = next.map((x) => (x.id === it.id ? { ...x, recurringItemId: newId_, pinned: false } : x))
        } else {
          next = next.map((x) => (x.id === it.id ? { ...x, pinned: true } : x))
        }
      }
      await setCellItems(store, row.id, month, next, isRecurringRow ? 'this-month' : scope)
    })
  }

  function updateItem(id: string, patch: Partial<CellItem>) {
    setItems((list) => list.map((it) => (it.id === id ? { ...it, ...patch } : it)))
  }

  const liveItems = items.filter((i) => !i.skipped)
  const doneCount = liveItems.filter((i) => i.status === 'done').length
  function markAllDone() {
    setItems((list) => list.map((it) => (it.skipped ? it : { ...it, status: 'done' })))
  }

  function addItem() {
    setItems((list) => [
      ...list,
      { id: newId(), label: '', amount: 0, status: row.defaultStatus, fundedBy: row.defaultFundedBy, date: null, note: null, recurringItemId: null, kind: 'normal', skipped: false },
    ])
  }

  function removePlain(id: string) {
    setItems((l) => l.filter((x) => x.id !== id))
  }

  /** Scheduled items are removed through the store so the schedule does not post them straight back. */
  function removeScheduled(it: CellItem, how: 'this-month' | 'from-now-on' | 'all') {
    const scheduleId = it.recurringItemId!
    setRemoving(null)
    if (how === 'this-month') {
      void run(async () => {
        await skipRecurringMonth(store, scheduleId, month, true)
        updateItem(it.id, { skipped: true })
      }, false)
    } else if (how === 'all') {
      setRemovingSchedule(scheduleId)
    } else {
      void run(() => endRecurringFrom(store, scheduleId, month))
    }
  }

  function restoreScheduled(it: CellItem) {
    void run(async () => {
      await skipRecurringMonth(store, it.recurringItemId!, month, false)
      updateItem(it.id, { skipped: false })
    }, false)
  }

  const title = `${row.name} · ${formatMonth(month, locale, 'long')}`
  const sourceText =
    cell?.source === 'inherit' ? 'Carried from the previous month' :
    cell?.source === 'value' ? 'Set in this month' :
    cell?.source === 'items' ? (soloItem ? 'Set in this month' : isRecurringRow ? 'Posted from a schedule' : `${cell.items.length} item${cell.items.length === 1 ? '' : 's'}`) :
    cell?.source === 'empty' ? (isRecurringRow ? 'Nothing due this month' : 'Nothing yet') : ''

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
            {!isRecurringRow && (
              <div className="inline-flex rounded-md border p-0.5 text-sm" role="tablist">
                <button role="tab" aria-selected={mode === 'value'} className={cn('rounded px-3 py-1', mode === 'value' && 'bg-muted font-medium')} onClick={() => setMode('value')}>Single amount</button>
                <button role="tab" aria-selected={mode === 'items'} className={cn('rounded px-3 py-1', mode === 'items' && 'bg-muted font-medium')} onClick={() => setMode('items')}>Itemized</button>
              </div>
            )}

            {mode === 'value' ? (
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <Label htmlFor="cell-amount">Amount in {currency}</Label>
                  <Input id="cell-amount" autoFocus inputMode="decimal" value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') saveValue() }} placeholder="0" />
                  {currency !== household.baseCurrency && <RateLine tables={tables} household={household} month={month} currency={currency} amount={parseAmount(text, currency, locale) ?? 0} />}
                </div>
                <fieldset className="space-y-1.5">
                  <legend className="text-sm font-medium"><span className="inline-flex items-center gap-1">Applies to <InfoTip help="cell.appliesTo" /></span></legend>
                  <Segmented value={scope} onChange={(v) => setScope(v as EditScope)} options={[{ value: 'from-now-on', label: 'This month and onwards' }, { value: 'this-month', label: 'Only this month' }]} />
                  <p className="text-xs text-muted-foreground">
                    {scope === 'from-now-on' ? 'Later months that follow this row will pick up the new amount.' : 'The next month keeps the old amount.'}
                  </p>
                </fieldset>
                <fieldset className="space-y-1.5">
                  <legend className="text-sm font-medium"><span className="inline-flex items-center gap-1">How sure <InfoTip help="cell.howSure" /></span></legend>
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
                {row.section === 'expense' && (
                  <div className="space-y-1.5">
                    <TipLabel htmlFor="cell-source" help="cell.comesOutOf">Comes out of</TipLabel>
                    <NativeSelect id="cell-source" className="w-full" value={fundedBy} onChange={(e) => setFundedBy(e.target.value as CellItem['fundedBy'])}>
                      {fundingOptions.map((o) => <option key={o.value} value={o.value}>{o.label}{o.value === row.defaultFundedBy ? ' (row default)' : ''}</option>)}
                    </NativeSelect>
                  </div>
                )}
              </div>
            ) : (
              <div className="space-y-2">
                {items.length === 0 && <p className="text-sm text-muted-foreground">No items yet.</p>}
                {items.map((it) => {
                  if (it.kind === 'carry') {
                    return (
                      <div key={it.id} className="flex items-center gap-2 rounded-md border border-dashed px-2 py-1.5 text-sm">
                        <span className="flex-1 text-muted-foreground">Carried from previous month</span>
                        <span className="tabular-nums">{formatAmount(prevValue(), currency, locale)}</span>
                        <Button size="icon" variant="ghost" aria-label="Remove carried amount" onClick={() => removePlain(it.id)}><Trash2 /></Button>
                      </div>
                    )
                  }
                  const schedule = it.recurringItemId ? schedules.get(it.recurringItemId) : undefined
                  if (it.skipped && schedule) {
                    return (
                      <div key={it.id} className="flex items-center gap-2 rounded-md border border-dashed px-2 py-1.5 text-sm text-muted-foreground">
                        <Repeat className="size-3.5" aria-hidden />
                        <span className="flex-1"><s>{it.label}</s> · Skipped this month</span>
                        <Button size="xs" variant="outline" onClick={() => restoreScheduled(it)} disabled={busy}>Restore</Button>
                      </div>
                    )
                  }
                  const edited = changedScheduled(it)
                  return (
                    <div key={it.id} className={cn('space-y-2 rounded-md border p-2', schedule && 'border-transfer/40')}>
                      <div className="grid grid-cols-[1fr_7rem] gap-2 sm:grid-cols-[1fr_7rem_7rem_9rem_2rem]">
                        {schedule ? (
                          <div className="flex min-w-0 items-center gap-1.5 text-sm" title={`Repeats: ${describeCadence(schedule, locale)}`}>
                            <Repeat className="size-3.5 shrink-0 text-transfer" aria-hidden />
                            <span className="truncate">{it.label}</span>
                            <span className="truncate text-xs text-muted-foreground">{describeCadence(schedule, locale)}</span>
                          </div>
                        ) : (
                          <Input aria-label="Item label" placeholder="What" value={it.label} onChange={(e) => updateItem(it.id, { label: e.target.value })} />
                        )}
                        <Input
                          aria-label="Item amount" inputMode="decimal" placeholder="0"
                          defaultValue={amountToInput(it.amount, currency, locale)}
                          onChange={(e) => { const v = parseAmount(e.target.value, currency, locale); updateItem(it.id, { amount: v ?? 0 }) }}
                        />
                        <NativeSelect aria-label="Item status" value={it.status} onChange={(e) => updateItem(it.id, { status: e.target.value as ItemStatus })}>
                          {(['projected', 'committed', 'done'] as ItemStatus[]).map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
                        </NativeSelect>
                        <NativeSelect aria-label="Comes out of" value={it.fundedBy} onChange={(e) => updateItem(it.id, { fundedBy: e.target.value as CellItem['fundedBy'] })} disabled={row.section !== 'expense'}>
                          {fundingOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                        </NativeSelect>
                        <Button size="icon" variant="ghost" aria-label="Remove item" onClick={() => (schedule ? setRemoving(removing === it.id ? null : it.id) : removePlain(it.id))}><Trash2 /></Button>
                      </div>
                      {schedule && edited && (
                        <div className="flex flex-wrap items-center gap-2 text-xs">
                          <span className="text-muted-foreground">Apply the change to</span>
                          <Segmented
                            value={applyTo[it.id] ?? 'this-month'}
                            onChange={(v) => setApplyTo((a) => ({ ...a, [it.id]: v as EditScope }))}
                            options={[{ value: 'this-month', label: 'Only this month' }, { value: 'from-now-on', label: 'This and following months' }]}
                          />
                        </div>
                      )}
                      {schedule && removing === it.id && (
                        <div className="flex flex-wrap items-center gap-2 text-xs">
                          <span className="text-muted-foreground">Remove "{it.label}":</span>
                          <Button size="xs" variant="outline" onClick={() => removeScheduled(it, 'this-month')} disabled={busy}>Only this month</Button>
                          <Button size="xs" variant="outline" onClick={() => removeScheduled(it, 'from-now-on')} disabled={busy}>This and following months</Button>
                          <Button size="xs" variant="outline" onClick={() => removeScheduled(it, 'all')} disabled={busy}>All occurrences</Button>
                          <Button size="xs" variant="ghost" onClick={() => setRemoving(null)}>Cancel</Button>
                        </div>
                      )}
                    </div>
                  )
                })}
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <Button size="sm" variant="outline" onClick={addItem}>Add item</Button>
                    {liveItems.length > 0 && doneCount < liveItems.length && <Button size="sm" variant="outline" onClick={markAllDone}>Mark all done</Button>}
                    {liveItems.length > 0 && doneCount === liveItems.length && <span className="inline-flex items-center gap-1.5 text-sm text-done"><DoneDot done={1} total={1} state="all" /><span>All done</span></span>}
                    {doneCount > 0 && doneCount < liveItems.length && <span className="text-xs text-muted-foreground">{doneCount} of {liveItems.length} done</span>}
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <span className="text-sm tabular-nums">Total {formatAmount(itemsTotal, currency, locale)}</span>
                    {currency !== household.baseCurrency && <RateLine tables={tables} household={household} month={month} currency={currency} amount={itemsTotal} />}
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">Set an item to Done when it is paid or received. A done cell shows a green dot; in the current month the dot also shows red for nothing done yet and amber for partly done.</p>
                {row.section === 'expense' && (
                  <p className="text-xs text-muted-foreground">{HELP['cell.comesOutOf'].text}</p>
                )}
                {!isRecurringRow && (
                  <Segmented value={scope} onChange={(v) => setScope(v as EditScope)} options={[{ value: 'from-now-on', label: 'This month and onwards' }, { value: 'this-month', label: 'Only this month' }]} />
                )}
              </div>
            )}
            {deductions.length > 0 && cell && (
              <div className="space-y-1 rounded-md border px-2 py-1.5 text-xs" data-testid="deductions">
                <p className="flex items-center gap-1 font-medium">Deducted from this income <InfoTip help="cell.deductions" /></p>
                <ul className="divide-y divide-border/60">
                  {deductions.map((d) => <li key={d.id} className="flex justify-between gap-2 py-0.5"><span className="truncate">{d.name}</span><span className="tabular-nums">−{formatAmount(d.valueBase, household.baseCurrency, locale)}</span></li>)}
                </ul>
                <p className="flex justify-between border-t pt-1 font-medium"><span>Net</span><span className="tabular-nums">{formatAmount(cell.netBase, household.baseCurrency, locale)}</span></p>
              </div>
            )}
            {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
          </div>
        )}

        {!closed && (
          <DialogFooter className="flex-row flex-wrap gap-2 sm:justify-between">
            <div className="flex gap-2">
              {!isRecurringRow && <Button variant="ghost" onClick={() => void run(() => clearCell(store, row.id, month))} disabled={busy || !cell?.cell}>Clear (inherit)</Button>}
              <Button variant="ghost" onClick={() => setRecurring(true)} disabled={busy}>Make recurring…</Button>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
              <Button onClick={mode === 'value' ? saveValue : saveItems} disabled={busy}>Save</Button>
            </div>
          </DialogFooter>
        )}
      </DialogContent>
      {removingSchedule && <RemoveDialog target={{ kind: 'schedule', id: removingSchedule }} tables={tables} household={household} onClose={() => setRemovingSchedule(null)} onDone={onClose} />}
      {recurring && (
        <RecurringDialog
          tables={tables}
          household={household}
          item={null}
          defaultMonth={month}
          prefill={{ rowId: row.id, name: row.name, amount: mode === 'value' ? (parseAmount(text, currency, locale) ?? undefined) : itemsTotal }}
          onClose={() => setRecurring(false)}
          onSaved={onClose}
        />
      )}
    </Dialog>
  )
}
