import { useEffect, useMemo, useRef, useState } from 'react'
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
import { RepeatField } from '@/features/recurring/RepeatField'
import {
  addMonths, cadenceOf, canCarryRule, compareMonths, isDue, isTakenFromAccount, newId, nextDue, parseMonth, repeatOf, runningSchedules, sameRepeat,
  type CellItem, type Household, type ItemStatus, type MonthKey, type RepeatChoice, type Repeating, type Row, type Tables,
} from '@/model'
import {
  clearCell, endRecurringFrom, itemsFromCurrent, reopenMonth, saveRowMonth, setCellItems, setCellValue, skipRecurringMonth,
  type EditScope, type RuleTarget,
} from '@/store'
import { RemoveDialog } from '@/features/remove/RemoveDialog'
import { RuleFields, RulePicker } from '@/features/rules/RuleDialog'
import { ruleFacts, type RuleKind } from '@/features/rules/ruleFacts'
import { DoneDot } from '@/components/DoneDot'
import { NativeSelect } from '@/components/NativeSelect'
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
  /** For a row that can carry a rule: the choice the dialog opens on, instead of how this month's amount is set now. */
  startRule?: RuleKind
  onClose: () => void
}

type Mode = 'value' | 'items'
type StatusChoice = 'default' | ItemStatus
const STATUS_LABEL: Record<ItemStatus, string> = { projected: 'Estimate', committed: 'Certain', done: 'Done' }

/**
 * The one dialog of a row in a month (DESIGN.md §8): its amount, as a single amount or as items, how sure it is and
 * how it repeats. A single amount stays every month, is for this month only, or goes on a schedule; every item says
 * for itself how it repeats, and the row's schedules that land in other months are listed too, so they can be
 * changed from any month. A row that can carry a rule (pocket money, the transfer that fills an account) starts with
 * "How the amount is set": a fixed amount shows these fields, a percentage or the rest shows the rule's.
 */
export function CellEditor({ tables, engine, household, row, month, startRule, onClose }: Props) {
  const store = useStore()
  const cell = engine.cells[cellKey(row.id, month)]
  const closed = engine.totals[month]?.closed ?? false
  // ----- the rule, for a row that can carry one -----
  const ruleTarget = useMemo<RuleTarget>(() => ({ rowId: row.id }), [row.id])
  const facts = useMemo(() => (canCarryRule(row) ? ruleFacts(tables, household, ruleTarget) : null), [tables, household, row, ruleTarget])
  /** The app works this month's amount out: the dialog opens on the rule that does, and has no amount to type. */
  const worked = cell?.source === 'derived'
  const [ruleKind, setRuleKind] = useState<RuleKind>(startRule ?? (worked && facts ? facts.current : 'fixed'))
  const showRuleFields = !!facts && !facts.error && (ruleKind !== 'fixed' || worked)
  /** A rule fills this row's other months, so an amount typed here is for this month alone. */
  const ruleRuns = !!facts && (facts.current !== 'fixed' || facts.wasShareOfTotal)
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
  // money taken out of an account is a one-off unless you say otherwise; any other row remembers the last choice
  const oneOff = isTakenFromAccount(row)
  const [scope, setScope] = useState<EditScope>(() => (oneOff ? 'this-month' : readPref<EditScope>('editScope', 'from-now-on')))
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
  /** A single amount put on a schedule; every month and only this month are `scope`. */
  const [onSchedule, setOnSchedule] = useState(false)
  const [rhythm, setRhythm] = useState<Repeating>(() => ({ kind: 'every', interval: 12, anchor: parseMonth(month).month }))
  /** How an item repeats, where that was touched here; the others keep what they have. */
  const [repeats, setRepeats] = useState<Record<string, RepeatChoice>>({})
  /** The row's schedules that land in other months, where one was changed here: its amount as typed, its rhythm. */
  const [others, setOthers] = useState<Record<string, { text?: string; repeat?: Repeating }>>({})
  /** The schedule from another month that is being asked how to stop. */
  const [stopping, setStopping] = useState<string | null>(null)

  const original = useMemo(() => new Map((cell?.items ?? []).map((i) => [i.id, i])), [cell])
  const schedules = useMemo(() => new Map(tables.recurringItems.map((r) => [r.id, r])), [tables.recurringItems])
  /** A schedule can be started here on a row that takes one: not on one a rule can work out, nor on an estimate. */
  const canSchedule = !canCarryRule(row) && row.kind !== 'to-savings' && row.kind !== 'category-estimate' && row.pocketMode == null
  /** How an item repeats as stored: its schedule's rhythm while that runs on after this month. */
  const storedRepeat = (it: CellItem): RepeatChoice => {
    const s = it.recurringItemId ? schedules.get(it.recurringItemId) : undefined
    return s && !s.deletedAt && !(s.endMonth && compareMonths(s.endMonth, month) <= 0) ? repeatOf(s) : { kind: 'none' }
  }
  const repeatFor = (it: CellItem): RepeatChoice => repeats[it.id] ?? storedRepeat(it)
  const repeating = (it: CellItem) => it.kind === 'normal' && !it.skipped && repeatFor(it).kind !== 'none'
  /** The row's schedules with nothing in this month's list: they land in other months, and are changed from here too. */
  const elsewhere = runningSchedules(tables.recurringItems, row.id, month).filter((s) => !items.some((i) => i.recurringItemId === s.id) && nextDue(s, month) !== null)
  /** The amount typed for one of them: undefined while untouched, not a number when it cannot be read. */
  const otherAmount = (id: string): number | undefined => {
    const typed = others[id]?.text
    if (typed == null) return undefined
    return typed.trim() === '' ? 0 : parseAmount(typed, currency, locale) ?? Number.NaN
  }
  /** Once saved, something in the row lands by itself: later months then show only that. */
  const willRepeat = elsewhere.length > 0 || items.some(repeating)
  /** Items that are this month's alone: they are what a row on a schedule does not bring back. */
  const plain = items.filter((it) => it.kind === 'normal' && !it.skipped && !repeating(it))
  const nextMonth = addMonths(month, 1)
  const landsNext = [
    ...items.filter(repeating).filter((it) => isDue({ ...cadenceOf(repeatFor(it) as Repeating), startMonth: month, endMonth: null }, nextMonth)).map((it) => ({ name: it.label.trim() || row.name, amount: it.amount })),
    ...elsewhere.filter((s) => isDue({ ...cadenceOf(others[s.id]?.repeat ?? repeatOf(s)), startMonth: s.startMonth, endMonth: s.endMonth }, nextMonth)).map((s) => ({ name: s.name, amount: otherAmount(s.id) ?? s.amount })),
  ]
  const fundingOptions = useMemo(() => buildFundingOptions(tables.pools, [row.defaultFundedBy, ...items.map((i) => i.fundedBy)]), [tables.pools, row.defaultFundedBy, items])

  useEffect(() => {
    if (!oneOff) writePref('editScope', scope)
  }, [scope, oneOff])
  // the rule fills the months after this one: nothing carries on from a typed amount, and nothing is held for it
  const saveScope: EditScope = ruleRuns ? 'from-now-on' : scope

  const itemsTotal = items.filter((i) => !i.skipped).reduce((s, i) => s + (i.kind === 'carry' ? (cell?.items.find((x) => x.id === i.id)?.effectiveAmount ?? prevValue()) : Number.isFinite(i.amount) ? i.amount : 0), 0)

  function prevValue(): number {
    const idx = engine.months.indexOf(month)
    if (idx <= 0) return 0
    return engine.cells[cellKey(row.id, engine.months[idx - 1])]?.value ?? 0
  }

  // one save at a time: Enter in the amount field is not a button, so `busy` alone does not stop a second press
  const running = useRef(false)
  async function run(fn: () => Promise<void>, close = true) {
    if (running.current) return
    running.current = true
    setBusy(true)
    setError(null)
    try {
      await fn()
      if (close) onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save.')
    } finally {
      running.current = false
      setBusy(false)
    }
  }

  function saveValue() {
    const minor = text.trim() === '' ? 0 : parseAmount(text, currency, locale)
    if (minor == null) {
      setError('That is not a number I can read.')
      return
    }
    const single: CellItem = { id: newId(), label: '', amount: minor, status: status === 'default' ? row.defaultStatus : status, fundedBy, date: null, note: null, recurringItemId: null, kind: 'normal', skipped: false }
    if (onSchedule && !ruleRuns) {
      if (minor === 0) return setError('Type the amount that repeats.')
      if (rhythm.kind === 'months' && rhythm.months.length === 0) return setError('Pick at least one month.')
      // the amount becomes the row's schedule, named after the row; it lands this month only if its rhythm does
      return void run(() => saveRowMonth(store, row.id, month, { items: [single], repeats: { [single.id]: rhythm }, scope: 'from-now-on' }))
    }
    // A plain value takes the row's defaults; any other certainty or source is stored as one unlabelled item.
    if (status === 'default' && fundedBy === row.defaultFundedBy) return void run(() => setCellValue(store, row.id, month, minor, saveScope))
    void run(() => setCellItems(store, row.id, month, [single], saveScope))
  }

  /** A scheduled item whose amount or funding was edited here. */
  const changedScheduled = (it: CellItem) => {
    const o = original.get(it.id)
    return !!it.recurringItemId && !!o && (o.amount !== it.amount || o.fundedBy !== it.fundedBy)
  }

  /** The items, how each repeats and what changed on the schedules of other months, saved as one step. */
  function saveItems() {
    for (const it of items) {
      const named = it.label.trim() ? `"${it.label.trim()}"` : null
      if (it.kind === 'normal' && !Number.isFinite(it.amount)) return setError(`${named ?? 'An item'} has an amount that is not a number I can read.`)
      const choice = repeatFor(it)
      if (choice.kind === 'months' && choice.months.length === 0) return setError(`Pick at least one month for ${named ?? 'the item that repeats'}.`)
    }
    const changes: Record<string, { amount?: number; repeat?: Repeating }> = {}
    for (const s of elsewhere) {
      const draft = others[s.id]
      if (!draft) continue
      const amount = otherAmount(s.id)
      if (amount != null && !Number.isFinite(amount)) return setError(`"${s.name}" has an amount that is not a number I can read.`)
      if (draft.repeat?.kind === 'months' && draft.repeat.months.length === 0) return setError(`Pick at least one month for "${s.name}".`)
      changes[s.id] = { amount, repeat: draft.repeat }
    }
    void run(() => saveRowMonth(store, row.id, month, { items, repeats, applyTo, others: changes, scope: isRecurringRow ? 'this-month' : saveScope }))
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
    cell?.source === 'derived' ? 'Worked out by the app' :
    cell?.source === 'inherit' ? 'Carried from the previous month' :
    cell?.source === 'value' ? 'Set in this month' :
    cell?.source === 'items' ? (soloItem ? 'Set in this month' : isRecurringRow ? 'On a schedule' : `${cell.items.length} item${cell.items.length === 1 ? '' : 's'}`) :
    cell?.source === 'empty' ? (isRecurringRow ? 'Nothing lands this month' : 'Nothing yet') : ''

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
        ) : showRuleFields && facts ? (
          <>
            <RulePicker facts={facts} kind={ruleKind} onKind={setRuleKind} />
            <RuleFields tables={tables} household={household} target={ruleTarget} facts={facts} month={month} kind={ruleKind} onClose={onClose} />
          </>
        ) : (
          <div className="space-y-4">
            {facts && !facts.error && <RulePicker facts={facts} kind={ruleKind} onKind={setRuleKind} />}
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
                {ruleRuns ? (
                  <p className="text-xs text-muted-foreground" data-testid="rule-runs">This amount is for {formatMonth(month, locale, 'long')} alone. A rule works this row out in every month without a typed amount; to change the rule, open a month it works out.</p>
                ) : (
                  <fieldset className="space-y-1.5">
                    <legend className="text-sm font-medium"><span className="inline-flex items-center gap-1">Repeats <InfoTip help="cell.repeats" /></span></legend>
                    <Segmented
                      label="Repeats" value={onSchedule ? 'schedule' : scope}
                      onChange={(v) => {
                        setOnSchedule(v === 'schedule')
                        if (v !== 'schedule') setScope(v as EditScope)
                      }}
                      options={[{ value: 'from-now-on', label: 'Every month' }, ...(canSchedule ? [{ value: 'schedule', label: 'On a schedule' }] : []), { value: 'this-month', label: 'Only this month' }]}
                    />
                    {onSchedule ? (
                      <>
                        <RepeatField value={rhythm} onChange={(c) => { if (c.kind !== 'none') setRhythm(c) }} month={month} locale={locale} name={row.name} label="How often" monthly={false} />
                        <p className="text-xs text-muted-foreground">On a schedule the amount lands only in its months; the months between stay empty.</p>
                      </>
                    ) : (
                      <p className="text-xs text-muted-foreground">
                        {scope === 'from-now-on' ? 'The amount stays in every later month until you change it.' : 'The next month keeps the old amount.'}
                      </p>
                    )}
                  </fieldset>
                )}
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
                {items.length === 0 && elsewhere.length === 0 && <p className="text-sm text-muted-foreground">No items yet.</p>}
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
                  const choice = repeatFor(it)
                  /** The rhythm was changed here: that counts from this month on, so the amount is not asked about separately. */
                  const moved = !!schedule && !sameRepeat(choice, storedRepeat(it))
                  return (
                    <div key={it.id} className={cn('space-y-2 rounded-md border p-2', schedule && 'border-transfer/40')}>
                      <div className="grid grid-cols-[1fr_7rem] gap-2 sm:grid-cols-[1fr_7rem_7rem_9rem_2rem]">
                        {schedule ? (
                          <div className="flex min-w-0 items-center gap-1.5 text-sm">
                            <Repeat className="size-3.5 shrink-0 text-transfer" aria-hidden />
                            <span className="truncate">{it.label}</span>
                          </div>
                        ) : (
                          <Input aria-label="Item label" placeholder="What" value={it.label} onChange={(e) => updateItem(it.id, { label: e.target.value })} />
                        )}
                        <Input
                          aria-label="Item amount" inputMode="decimal" placeholder="0"
                          defaultValue={amountToInput(it.amount, currency, locale)}
                          // an empty field is zero; anything else that cannot be read is kept as such, so saving says so instead of storing zero
                          onChange={(e) => { setError(null); updateItem(it.id, { amount: e.target.value.trim() === '' ? 0 : parseAmount(e.target.value, currency, locale) ?? Number.NaN }) }}
                        />
                        <NativeSelect aria-label="Item status" value={it.status} onChange={(e) => updateItem(it.id, { status: e.target.value as ItemStatus })}>
                          {(['projected', 'committed', 'done'] as ItemStatus[]).map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
                        </NativeSelect>
                        <NativeSelect aria-label="Comes out of" value={it.fundedBy} onChange={(e) => updateItem(it.id, { fundedBy: e.target.value as CellItem['fundedBy'] })} disabled={row.section !== 'expense'}>
                          {fundingOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                        </NativeSelect>
                        <Button size="icon" variant="ghost" aria-label="Remove item" onClick={() => (schedule ? setRemoving(removing === it.id ? null : it.id) : removePlain(it.id))}><Trash2 /></Button>
                      </div>
                      {(schedule || canSchedule) && (
                        <RepeatField value={choice} onChange={(c) => setRepeats((r) => ({ ...r, [it.id]: c }))} month={month} locale={locale} name={it.label.trim() || row.name} none="Only this month" />
                      )}
                      {moved && (
                        <p className="text-xs text-muted-foreground">
                          {choice.kind === 'none' ? `Ends after ${formatMonth(month, locale, 'long')}.` : `Counts from ${formatMonth(month, locale, 'long')}; earlier months keep what they show.`}
                        </p>
                      )}
                      {schedule && edited && !moved && (
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
                {/* what repeats in this row and does not land this month: seen, changed and stopped from here all the same */}
                {elsewhere.map((s) => {
                  const draft = others[s.id]
                  const touched = (draft?.repeat != null && !sameRepeat(draft.repeat, repeatOf(s))) || (otherAmount(s.id) != null && otherAmount(s.id) !== s.amount)
                  return (
                    <div key={s.id} className="space-y-2 rounded-md border border-dashed p-2" data-testid="elsewhere">
                      <div className="grid grid-cols-[1fr_7rem_2rem] items-center gap-2">
                        <div className="flex min-w-0 items-center gap-1.5 text-sm text-muted-foreground">
                          <Repeat className="size-3.5 shrink-0" aria-hidden />
                          <span className="truncate">{s.name}</span>
                        </div>
                        <Input
                          aria-label={`Amount of ${s.name}`} inputMode="decimal" placeholder="0" defaultValue={amountToInput(s.amount, currency, locale)}
                          onChange={(e) => { setError(null); setOthers((o) => ({ ...o, [s.id]: { ...o[s.id], text: e.target.value } })) }}
                        />
                        <Button size="icon" variant="ghost" aria-label={`Stop ${s.name}`} onClick={() => setStopping(stopping === s.id ? null : s.id)}><Trash2 /></Button>
                      </div>
                      <RepeatField
                        value={draft?.repeat ?? repeatOf(s)} month={month} locale={locale} name={s.name}
                        onChange={(c) => { if (c.kind !== 'none') setOthers((o) => ({ ...o, [s.id]: { ...o[s.id], repeat: c } })) }}
                      />
                      {touched && <p className="text-xs text-muted-foreground">Counts from {formatMonth(month, locale, 'long')}; earlier months keep what they show.</p>}
                      {stopping === s.id && (
                        <div className="flex flex-wrap items-center gap-2 text-xs">
                          <span className="text-muted-foreground">Stop "{s.name}":</span>
                          <Button size="xs" variant="outline" onClick={() => void run(() => endRecurringFrom(store, s.id, month))} disabled={busy}>From {formatMonth(month, locale, 'long')} on</Button>
                          <Button size="xs" variant="outline" onClick={() => { setStopping(null); setRemovingSchedule(s.id) }} disabled={busy}>All occurrences</Button>
                          <Button size="xs" variant="ghost" onClick={() => setStopping(null)}>Cancel</Button>
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
                {willRepeat ? (plain.length > 0 || !isRecurringRow) && (
                  // said before saving: a row on a schedule does not carry its other items, or its total, into the next month
                  <p className="text-xs" data-testid="repeat-next">
                    From {formatMonth(nextMonth, locale, 'long')} this row shows only what repeats
                    {landsNext.length ? `: ${landsNext.map((l) => `${l.name} ${formatAmount(l.amount, currency, locale)}`).join(', ')}.` : `. Nothing lands in ${formatMonth(nextMonth, locale, 'long')}.`}
                  </p>
                ) : !isRecurringRow && !ruleRuns && (
                  <fieldset className="space-y-1.5">
                    <legend className="text-sm font-medium">The total</legend>
                    <Segmented label="The total" value={scope} onChange={(v) => setScope(v as EditScope)} options={[{ value: 'from-now-on', label: 'Every month' }, { value: 'this-month', label: 'Only this month' }]} />
                    <p className="text-xs text-muted-foreground">
                      {scope === 'from-now-on' ? `Nothing here repeats by itself: later months show the total, ${formatAmount(itemsTotal, currency, locale)}, as one amount.` : 'The next month keeps the old amount.'}
                    </p>
                  </fieldset>
                )}
                <p className="text-xs text-muted-foreground">Set an item to Done when it is paid or received. A done cell shows a green dot; in the current month the dot also shows red for nothing done yet and amber for partly done.</p>
                {row.section === 'expense' && (
                  <p className="text-xs text-muted-foreground">{HELP['cell.comesOutOf'].text}</p>
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

        {!closed && !showRuleFields && (
          <DialogFooter className="flex-row flex-wrap gap-2 sm:justify-between">
            <div className="flex gap-2">
              {!isRecurringRow && <Button variant="ghost" onClick={() => void run(() => clearCell(store, row.id, month))} disabled={busy || !cell?.cell}>{ruleRuns ? 'Clear (back to the rule)' : 'Clear (inherit)'}</Button>}
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
              <Button onClick={mode === 'value' ? saveValue : saveItems} disabled={busy}>Save</Button>
            </div>
          </DialogFooter>
        )}
      </DialogContent>
      {removingSchedule && <RemoveDialog target={{ kind: 'schedule', id: removingSchedule }} tables={tables} household={household} onClose={() => setRemovingSchedule(null)} onDone={onClose} />}
    </Dialog>
  )
}
