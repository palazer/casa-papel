import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Check } from '@/components/Check'
import { MonthField } from '@/components/MonthField'
import { NativeSelect } from '@/components/NativeSelect'
import { AmountHint } from '@/components/AmountHint'
import { amountToInput, formatMonth, parseAmount, unreadableAmount } from '@/app/format'
import { useStore } from '@/app/store'
import { sortRows } from '@/engine'
import { isPaymentRow, monthOfDate, payContext, type Household, type MonthKey, type RecurringItem, type Row, type Section, type Tables } from '@/model'
import { addRecurringItem, rowCurrencyOf, updateRecurringItem, type RecurringInput } from '@/store'
import { fundingOptions } from '@/features/grid/funding'
import { DaySelect, MethodSelect } from '@/features/payments/PaidFields'
import { ordinalDay } from '@/app/format'
import { saveError } from '@/app/saveError'
import { lang, txt } from '@/i18n'

const T = txt.recurring.dialog
const SECTION_NAME: Record<Section, string> = { income: txt.common.income, expense: T.expense, transfer: T.transfer }

const MONTH_NAMES = Array.from({ length: 12 }, (_, i) => new Intl.DateTimeFormat(lang, { month: 'short' }).format(new Date(2026, i, 1)))
type CadenceChoice = '1' | '2' | '3' | '6' | '12' | 'months'

interface Props {
  tables: Tables
  household: Household
  /** null = create */
  item: RecurringItem | null
  defaultMonth: MonthKey
  onClose: () => void
}

export function RecurringDialog({ tables, household, item, defaultMonth, onClose }: Props) {
  const store = useStore()
  const { locale, baseCurrency } = household
  const rows = sortRows(tables.rows.filter((r) => !r.deletedAt && !r.archivedMonth && r.kind !== 'to-savings' && r.pocketMode == null), tables.categories)
  const adults = tables.entities.filter((e) => e.kind === 'adult' && !e.deletedAt)
  const sources = fundingOptions(tables, item ? [item.fundedBy] : [])
  const [name, setName] = useState(item?.name ?? '')
  const [rowId, setRowId] = useState(item?.rowId ?? rows[0]?.id ?? '__new__')
  const [newRowName, setNewRowName] = useState('')
  const [newRowSection, setNewRowSection] = useState<Section>('expense')
  const [amount, setAmount] = useState(() => (item == null ? '' : amountToInput(item.amount, rowCurrencyOf(tables, item.rowId), locale)))
  const [cadence, setCadence] = useState<CadenceChoice>(() => (item?.dueMonths?.length ? 'months' : (String(item?.cadence?.intervalMonths ?? 1) as CadenceChoice)))
  const [anchor, setAnchor] = useState<number>(item?.cadence?.anchorMonth ?? Number(defaultMonth.slice(5)))
  const [dueMonths, setDueMonths] = useState<Set<number>>(() => new Set(item?.dueMonths ?? []))
  const [accountId, setAccountId] = useState(item?.accountId ?? '')
  const [scope, setScope] = useState(item?.scope ?? 'shared')
  const [fundedBy, setFundedBy] = useState<string>(item?.fundedBy ?? 'cash')
  const [startMonth, setStartMonth] = useState(item?.startMonth ?? defaultMonth)
  const [endMonth, setEndMonth] = useState(item?.endMonth ?? '')
  const [notes, setNotes] = useState(item?.notes ?? '')
  const [payDay, setPayDay] = useState<number | null>(item?.payDay ?? null)
  const [methodId, setMethodId] = useState<string | null>(item?.methodId ?? null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  // the amount is the row's: read and shown in the currency the row is typed in (a new row starts in the household's)
  const amountCurrency = rowId === '__new__' ? baseCurrency : rowCurrencyOf(tables, rowId)
  // wording follows the row: income arrives somewhere, spending leaves from somewhere and is funded by something
  const section: Section = rowId === '__new__' ? newRowSection : (rows.find((r) => r.id === rowId)?.section ?? 'expense')
  const accountLabel = section === 'income' ? T.paidInto : section === 'transfer' ? T.fromAccount : T.paidFrom
  // while the household plans its payments, a schedule of something that leaves says its day and method; the account "for
  // the overview" gives way to them
  const target = rowId === '__new__' ? { section: newRowSection, kind: 'plain' as const } : rows.find((r) => r.id === rowId)
  const paid = !!household.payments && !!target && isPaymentRow(target)
  const usual = rowId === '__new__' ? undefined : rows.find((r) => r.id === rowId)
  const ctx = payContext(tables)
  const accountHelp = section === 'income' ? T.whichOfYourAccounts : T.whichAccountLeaves

  async function save() {
    const minor = parseAmount(amount, amountCurrency, locale)
    if (minor == null) return setError(unreadableAmount(amount, T.amountIsNotA))
    if (!name.trim()) return setError(T.giveItAName)
    if (rowId === '__new__' && !newRowName.trim()) return setError(T.nameTheNewRow)
    if (cadence === 'months' && dueMonths.size === 0) return setError(txt.common.pickAMonth)
    if (endMonth && endMonth < startMonth) return setError(T.untilIsBeforeFrom)
    setBusy(true)
    setError(null)
    try {
      // a row made here is saved with the schedule and its months, as one step: one undo takes back the whole form
      const newRow = rowId === '__new__' ? { name: newRowName.trim(), section: newRowSection, defaultStatus: 'committed' as const } : undefined
      const base: Partial<RecurringInput> = {
        name: name.trim(), rowId, amount: minor, currency: null,
        cadence: cadence === 'months' ? null : { intervalMonths: Number(cadence) as 1 | 2 | 3 | 6 | 12, anchorMonth: cadence === '1' ? 1 : anchor },
        dueMonths: cadence === 'months' ? [...dueMonths] : null,
        accountId: accountId || null, scope, fundedBy: section === 'expense' ? (fundedBy as RecurringInput['fundedBy']) : 'cash',
        startMonth, endMonth: endMonth || null, notes,
        ...(paid ? { payDay, methodId } : {}),
      }
      if (item) await updateRecurringItem(store, item.id, base, newRow)
      else await addRecurringItem(store, base as Parameters<typeof addRecurringItem>[1], newRow)
      onClose()
    } catch (e) {
      setError(saveError(e, txt.common.couldNotSave))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="sm:max-w-lg" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>{item ? T.editSchedule : T.newSchedule}</DialogTitle>
          <DialogDescription>{item ? T.landsInEachOf(formatMonth(monthOfDate(), locale, 'long')) : T.landsFromMonthOn}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5 sm:col-span-2"><Label htmlFor="rc-name">{txt.common.name}</Label><Input id="rc-name" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder={T.eGCarInsurance} /></div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="rc-row">{T.gridRow}</Label>
            <NativeSelect id="rc-row" className="w-full" value={rowId} onChange={(e) => setRowId(e.target.value)}>
              {(['income', 'expense', 'transfer'] as Section[]).map((s) => (
                <optgroup key={s} label={SECTION_NAME[s]}>
                  {rows.filter((r) => r.section === s).map((r: Row) => <option key={r.id} value={r.id}>{r.name}</option>)}
                </optgroup>
              ))}
              <option value="__new__">{T.newRow}</option>
            </NativeSelect>
          </div>
          {rowId === '__new__' && (
            <>
              <div className="space-y-1.5"><Label htmlFor="rc-newrow">{T.newRowName}</Label><Input id="rc-newrow" value={newRowName} onChange={(e) => setNewRowName(e.target.value)} /></div>
              <div className="space-y-1.5"><Label htmlFor="rc-newsec">{T.section}</Label><NativeSelect id="rc-newsec" className="w-full" value={newRowSection} onChange={(e) => setNewRowSection(e.target.value as Section)}><option value="expense">{T.expense}</option><option value="income">{txt.common.income}</option><option value="transfer">{T.transfer}</option></NativeSelect></div>
            </>
          )}
          <div className="space-y-1.5"><Label htmlFor="rc-amount">{T.amount(amountCurrency)}</Label><Input id="rc-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /><AmountHint text={amount} currency={amountCurrency} locale={locale} /></div>
          <div className="space-y-1.5">
            <Label htmlFor="rc-cadence">{T.howOften}</Label>
            <NativeSelect id="rc-cadence" className="w-full" value={cadence} onChange={(e) => setCadence(e.target.value as CadenceChoice)}>
              <option value="1">{T.everyMonth}</option><option value="2">{T.every2Months}</option><option value="3">{T.every3Months}</option><option value="6">{T.every6Months}</option><option value="12">{T.everyYear}</option><option value="months">{T.inChosenMonths}</option>
            </NativeSelect>
          </div>
          {cadence !== '1' && cadence !== 'months' && (
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="rc-anchor">{cadence === '12' ? T.inWhichMonth : T.startingFromWhichMonth}</Label>
              <NativeSelect id="rc-anchor" className="w-full" value={anchor} onChange={(e) => setAnchor(Number(e.target.value))}>{MONTH_NAMES.map((n, i) => <option key={n} value={i + 1}>{n}</option>)}</NativeSelect>
            </div>
          )}
          {cadence === 'months' && (
            <fieldset className="grid grid-cols-4 gap-1 sm:col-span-2">
              {MONTH_NAMES.map((n, i) => <Check key={n} label={n} checked={dueMonths.has(i + 1)} onChange={(e) => { const s = new Set(dueMonths); if (e.target.checked) s.add(i + 1); else s.delete(i + 1); setDueMonths(s) }} />)}
            </fieldset>
          )}
          {paid ? (
            <>
              <div className="space-y-1.5"><Label htmlFor="rc-day">{txt.common.paidOn}</Label><DaySelect id="rc-day" className="w-full" value={payDay} onChange={setPayDay} none={usual?.payDay != null ? T.theRowsUsualDay(ordinalDay(usual.payDay)) : txt.common.noDay} /></div>
              <div className="space-y-1.5"><Label htmlFor="rc-method">{txt.common.paidWith}</Label><MethodSelect id="rc-method" className="w-full" tables={tables} value={methodId} onChange={setMethodId} none={usual?.payMethodId && ctx.methods.get(usual.payMethodId) ? T.theRowsUsualMethod(ctx.methods.get(usual.payMethodId)!.name) : txt.common.noMethod} /></div>
            </>
          ) : (
            <>
              <div className="space-y-1.5"><Label htmlFor="rc-account">{accountLabel}</Label><NativeSelect id="rc-account" className="w-full" value={accountId} onChange={(e) => setAccountId(e.target.value)}><option value="">—</option>{tables.accounts.filter((a) => !a.deletedAt && (a.id === accountId || (!a.archivedMonth && a.type !== 'credit-card' && a.type !== 'loan'))).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</NativeSelect></div>
              <p className="-mt-2 text-xs text-muted-foreground sm:col-span-2">{accountHelp}</p>
            </>
          )}
          <div className="space-y-1.5"><Label htmlFor="rc-scope">{T.whose}</Label><NativeSelect id="rc-scope" className="w-full" value={scope} onChange={(e) => setScope(e.target.value)}><option value="shared">{T.shared}</option>{adults.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</NativeSelect></div>
          {section === 'expense' && <div className="space-y-1.5"><Label htmlFor="rc-funded">{txt.common.comesOutOf}</Label><NativeSelect id="rc-funded" className="w-full" value={fundedBy} onChange={(e) => setFundedBy(e.target.value)}>{sources.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</NativeSelect><p className="text-xs text-muted-foreground">{T.spendingFromAnAccount}</p></div>}
          <div className="space-y-1.5"><Label>{T.fromMonth}</Label><MonthField label={T.fromMonth} value={startMonth} onChange={setStartMonth} locale={locale} /></div>
          <div className="space-y-1.5"><Label>{T.untilMonthOptional}</Label><MonthField label={T.untilMonth} value={endMonth} onChange={setEndMonth} locale={locale} allowEmpty /></div>
          <div className="space-y-1.5 sm:col-span-2"><Label htmlFor="rc-notes">{txt.common.notes}</Label><Input id="rc-notes" value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
        </div>
        {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>{txt.common.cancel}</Button>
          <Button onClick={() => void save()} disabled={busy}>{txt.common.save}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
