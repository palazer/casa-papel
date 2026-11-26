import { useState } from 'react'
import { ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { AmountHint } from '@/components/AmountHint'
import { Check } from '@/components/Check'
import { InfoTip, TipLabel } from '@/components/InfoTip'
import { MonthField } from '@/components/MonthField'
import { NativeSelect } from '@/components/NativeSelect'
import { currencyChoices, currencyLabel } from '@/app/currencies'
import { amountToInput, formatMonth, parseAmount, unreadableAmount } from '@/app/format'
import { useStore } from '@/app/store'
import { useTables } from '@/app/useEngine'
import { ACCOUNT_TYPE_INFO, growthIn, monthOfDate, paysExpenses, type Account, type AccountType, type Entity, type Row } from '@/model'
import { addAccount, addAccountWithRow, addPayOffRow, payOffRowsOf, planAccountChange, rowNameFor, updateAccount, type AccountRowInput } from '@/store'
import { cn } from '@/lib/utils'
import { saveError } from '@/app/saveError'
import { growthText } from './growthText'

interface Props {
  account: Account | null
  entities: Entity[]
  baseCurrency: string
  locale: string
  startMonth: string
  /**
   * A new account that starts from a suggestion or from its place on the Statement: a name, a type, the types on offer.
   * `payOff: false` leaves out the row that pays a loan or card off, where that row comes another way.
   */
  preset?: { name?: string; type?: AccountType; types?: AccountType[]; payOff?: boolean }
  /** The household's rows, so the form of a loan or card can say which row pays it off; left out, it says nothing. */
  rows?: Row[]
  /** A new account asked for from the row form: the row that is made with it, in the same step. */
  withRow?: AccountRowInput
  onClose: () => void
  /** A new account was saved, with the row that was made alongside it when there is one. */
  onSaved?: (account: Account, row?: Row) => void
  /** The row that pays the loan or card off was added from the form of an account that had none. */
  onRowAdded?: (row: Row) => void
  onRemove?: () => void
  /** What the remove button says: "Delete" where removing is one click, "Archive or delete…" where it opens the dialog. */
  removeLabel?: string
}

const TRACKABLE: AccountType[] = ['savings', 'investment', 'credit-card', 'loan', 'other-asset']
/** What the starting amount of an account is called: money held, money owed, or what a thing is worth. */
const balanceWord = (type: AccountType) => (type === 'credit-card' || type === 'loan' ? 'Owed' : type === 'other-asset' ? 'Worth' : 'Holds')

/**
 * An account (DESIGN.md §8). The short form asks what every account needs: its name, its type and what it holds, or
 * what is owed on it, when it starts. The rest (currency, owner, opening
 * month, tracking, how an investment grows) keeps its usual default behind "More options", which is open when editing.
 */
export function HouseholdAccountDialog({ account, entities, baseCurrency, locale, startMonth, preset, rows, withRow, onClose, onSaved, onRowAdded, onRemove, removeLabel = 'Archive or delete…' }: Props) {
  const store = useStore()
  const tables = useTables()
  // one main account open at a time (rule B9): while there is one, "Main account" is offered only on that account itself
  const main = tables?.accounts.find((a) => !a.deletedAt && !a.archivedMonth && a.type === 'checking' && a.id !== account?.id)
  const types = ACCOUNT_TYPE_INFO.filter((t) => (account || !preset?.types || preset.types.includes(t.value)) && !(t.value === 'checking' && main && account?.type !== 'checking'))
  const [name, setName] = useState(account?.name ?? preset?.name ?? '')
  const [picked, setType] = useState<AccountType>(account?.type ?? (preset?.type && types.some((t) => t.value === preset.type) ? preset.type : types[0]?.value) ?? 'joint')
  // the household's accounts can arrive after the form opened: a type that is no longer offered gives way to the first
  const type: AccountType = types.some((t) => t.value === picked) ? picked : types[0]?.value ?? picked
  const [currency, setCurrency] = useState(account?.currency ?? baseCurrency)
  const [opening, setOpening] = useState(account ? amountToInput(account.openingBalance, account.currency, locale) : '')
  const [openingMonth, setOpeningMonth] = useState(account?.openingMonth ?? startMonth)
  const [owner, setOwner] = useState(account?.ownerEntityId ?? '')
  const [tracked, setTracked] = useState(account?.tracked ?? true)
  const [outside, setOutside] = useState(account?.outsideNetWorth ?? false)
  const inv0 = account?.investment
  // the growth of the current month: where it changed from a month on, the field shows the rate that counts now
  const [annual, setAnnual] = useState(inv0 ? String(Math.round(growthIn(inv0, monthOfDate()) * 10000) / 100) : '5')
  const dated = inv0 ? growthText(inv0, locale) : null
  const [projection, setProjection] = useState<'fixed-rate' | 'historical-average'>(inv0?.projectionMode ?? 'fixed-rate')
  const [timing, setTiming] = useState<'start' | 'end'>(inv0?.depositTiming ?? 'start')
  const [fxMode, setFxMode] = useState<'monthly-rate' | 'fixed'>(inv0?.depositFxMode ?? 'monthly-rate')
  const [fixedRate, setFixedRate] = useState(inv0?.fixedRate ? String(inv0.fixedRate) : '')
  const [more, setMore] = useState(!!account)
  const [payOff, setPayOff] = useState(preset?.payOff ?? true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const adults = entities.filter((e) => e.kind === 'adult' && !e.deletedAt)
  // a child can own an account too: their long-term savings row goes into it
  const children = entities.filter((e) => e.kind === 'child' && !e.deletedAt)
  const trackable = TRACKABLE.includes(type)
  // an account that holds money, and has a balance to leave out, can be kept out of net worth
  const canLeaveOut = paysExpenses({ type }) && (!trackable || tracked)
  // the main account is in the household's currency (rule B9): it has no currency to choose. An existing account in
  // another one keeps it, so the save is refused with the reason instead of reading its amounts in another currency
  const ccy = type === 'checking' ? account?.currency ?? baseCurrency : currency.toUpperCase()
  const foreign = ccy !== baseCurrency && ccy.length === 3
  const info = ACCOUNT_TYPE_INFO.find((t) => t.value === type)
  const debt = type === 'loan' || type === 'credit-card'
  // a new loan or card comes with the row that pays it off unless the box is unticked; the row form brings its own row
  const offersRow = !account && !withRow && debt && preset?.payOff !== false
  const rowInput: AccountRowInput | null = account ? null : withRow ?? (offersRow && payOff ? { kind: 'pay-off' } : null)
  const rowName = rowInput ? rowInput.name?.trim() || (name.trim() ? rowNameFor(rowInput.kind, name.trim()) : null) : null
  // a saved loan or card says which row pays it off, and offers one while none does
  const paidBy = account && rows && debt ? payOffRowsOf(rows, account.id) : null
  // a type that would leave something behind is refused: asked of the same planner the store writes with, so the
  // form says it before Save does. (A loan becomes a card, and a card a loan, with everything it has.)
  const change = account && tables ? planAccountChange(tables, account, { type }) : null
  /** A type with a balance of its own, picked for an account that had none to track: the balance is tracked unless unticked. */
  const pickType = (t: AccountType) => {
    setType(t)
    if (account && !TRACKABLE.includes(account.type) && TRACKABLE.includes(t)) setTracked(true)
  }

  async function addRow() {
    if (!account || busy) return
    setBusy(true)
    setError(null)
    try {
      const row = await addPayOffRow(store, account.id)
      onRowAdded?.(row)
      onClose()
    } catch (e) {
      setError(saveError(e, 'Could not add the row.'))
    } finally {
      setBusy(false)
    }
  }

  async function save() {
    const openingBalance = opening.trim() ? parseAmount(opening, ccy, locale) : 0
    if (openingBalance == null) return setError(unreadableAmount(opening, `"${balanceWord(type)} at the start" is not a number I can read.`))
    // a payment stops at what is owed, so a loan or card that says nothing about it would take no payment at all
    if (debt && trackable && tracked && !opening.trim()) {
      return setError(`Type what is still owed on the ${type === 'loan' ? 'loan' : 'card'}, or untick "Track the balance month by month in the grid". A payment stops at what is owed, so with nothing owed the payments to this ${type === 'loan' ? 'loan' : 'card'} would count as nothing.`)
    }
    const annualRate = Number(annual.replace(',', '.')) / 100
    if (type === 'investment' && !Number.isFinite(annualRate)) return setError('Growth per year is not a number.')
    const fixed = Number(fixedRate.replace(',', '.'))
    if (type === 'investment' && foreign && fxMode === 'fixed' && !(fixed > 0)) return setError('Give the fixed rate as a positive number.')
    const patch = {
      name: name.trim(), type, currency: ccy, openingBalance, openingMonth, ownerEntityId: owner || null, tracked: trackable ? tracked : false,
      outsideNetWorth: canLeaveOut && outside,
      investment: type === 'investment'
        ? { projectionMode: projection, annualRate, depositTiming: timing, depositFxMode: foreign ? fxMode : 'monthly-rate' as const, fixedRate: fxMode === 'fixed' && foreign ? fixed : null }
        : undefined,
    }
    setBusy(true)
    setError(null)
    try {
      if (account) {
        await updateAccount(store, account.id, patch)
      } else if (rowInput) {
        const made = await addAccountWithRow(store, patch, rowInput)
        onSaved?.(made.account, made.row)
      } else {
        const made = await addAccount(store, patch)
        onSaved?.(made)
      }
      onClose()
    } catch (e) {
      setError(saveError(e, 'Could not save.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="sm:max-w-lg" aria-describedby={undefined}>
        <DialogHeader><DialogTitle>{account ? 'Edit account' : 'New account'}</DialogTitle></DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5"><Label htmlFor="acc-name">Name</Label><Input id="acc-name" autoFocus value={name} onChange={(e) => setName(e.target.value)} /></div>
          <div className="space-y-1.5"><Label htmlFor="acc-type">Type</Label><NativeSelect id="acc-type" className="w-full" value={type} aria-invalid={change?.refusal ? true : undefined} onChange={(e) => pickType(e.target.value as AccountType)}>{types.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}</NativeSelect></div>
          {change?.refusal && <p role="alert" className="-mt-1 text-xs text-destructive sm:col-span-2" data-testid="acc-type-refusal">{change.refusal}</p>}
          <p className="-mt-1 text-xs text-muted-foreground sm:col-span-2" data-testid="acc-type-help">{info?.help}{type === 'joint' && main ? ` The main account is "${main.name}".` : ''}{foreign ? ` Amounts are typed in ${ccy} and shown in ${baseCurrency} beneath. The rates come from the European Central Bank by themselves (only currency codes and dates are sent); change them under Household, "Currency rates".` : ''}</p>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="acc-open">{balanceWord(type)} at the start of {formatMonth(openingMonth, locale, 'long')} ({ccy})</Label>
            <Input id="acc-open" className="sm:w-1/2" inputMode="decimal" value={opening} onChange={(e) => setOpening(e.target.value)} placeholder="0" />
            <AmountHint text={opening} currency={ccy} locale={locale} />
            <p className="text-xs text-muted-foreground">
              {type === 'loan' ? 'What is still owed. A payment row that names this loan brings it down, and stops counting once nothing is owed.'
                : type === 'credit-card' ? 'Everything you owe on the card: the whole debt, not the month\'s bill. A payment row that names this card brings it down. Once a month, press the card\'s amount on the Statement and type what its statement says.'
                : type === 'other-asset' ? 'What it is worth. Enter a real value from its line whenever that changes.'
                : 'From then on every month starts with what the month before ended on. Press the account\'s amount in a month to type what it really held at the start and at the end.'}
            </p>
          </div>
          {offersRow && (
            <div className="space-y-1 sm:col-span-2">
              <Check label="Add the row that pays it off" checked={payOff} onChange={(e) => setPayOff(e.target.checked)} />
              <p className="pl-6 text-xs text-muted-foreground" data-testid="acc-row">
                {payOff
                  ? <>{rowName ? `"${rowName}"` : 'Named after the account'}. Each payment brings down what is owed.{type === 'credit-card' && ' It holds what you pay beyond what you buy with the card that month: what you buy is in your rows already.'}</>
                  : 'No row yet. One can be added later from this form.'}
              </p>
            </div>
          )}
          {withRow && (
            <p className="text-xs text-muted-foreground sm:col-span-2" data-testid="acc-row">
              Saving also adds the row {rowName ? `"${rowName}"` : 'named after the account'}, linked to this account.
            </p>
          )}
          {paidBy && (
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground sm:col-span-2" data-testid="acc-paid-by">
              {paidBy.length > 0
                ? <p>Paid off by {paidBy.map((r) => `"${r.name}"`).join(', ')}.</p>
                : type === account?.type && (
                  <>
                    <p>No row pays this off yet.</p>
                    <Button size="xs" variant="outline" disabled={busy} onClick={() => void addRow()}>Add the row that pays it off</Button>
                  </>
                )}
            </div>
          )}
          <div className="sm:col-span-2">
            <button
              type="button" aria-expanded={more} aria-controls="acc-more" onClick={() => setMore((v) => !v)}
              className="flex items-center gap-1 rounded text-xs text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
            >
              <ChevronRight className={cn('size-3.5 transition-transform', more && 'rotate-90')} aria-hidden />
              More options
              {!more && <span className="text-muted-foreground/80">: currency, owner, opening month{trackable ? ', tracking' : ''}{canLeaveOut ? ', net worth' : ''}{type === 'investment' ? ', growth' : ''}</span>}
            </button>
          </div>
          {more && (
            <div id="acc-more" className="grid gap-3 sm:col-span-2 sm:grid-cols-2">
              {type === 'checking' ? (
                <div className="space-y-1.5">
                  <span className="text-sm font-medium">Currency</span>
                  <p className="text-xs text-muted-foreground" data-testid="acc-main-currency">{currencyLabel(baseCurrency, baseCurrency)}{`: the main account is always in the household's currency. An account in another one is an "Other current account".`}</p>
                </div>
              ) : (
                <div className="space-y-1.5">
                  <Label htmlFor="acc-ccy">Currency</Label>
                  <NativeSelect id="acc-ccy" className="w-full" value={currency} onChange={(e) => setCurrency(e.target.value)}>
                    {currencyChoices(baseCurrency, account?.currency).map((c) => <option key={c} value={c}>{currencyLabel(c, baseCurrency)}</option>)}
                  </NativeSelect>
                </div>
              )}
              <div className="space-y-1.5"><Label htmlFor="acc-month">Opening month</Label><MonthField id="acc-month" label="Opening month" value={openingMonth} onChange={setOpeningMonth} locale={locale} /></div>
              <div className="space-y-1.5 sm:col-span-2">
                <TipLabel htmlFor="acc-owner" help="setup.owner">Owner</TipLabel>
                <NativeSelect id="acc-owner" className="w-full" value={owner} onChange={(e) => setOwner(e.target.value)}><option value="">Household / joint</option>{adults.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}{children.map((c) => <option key={c.id} value={c.id}>{c.name} · child</option>)}</NativeSelect>
              </div>
              {trackable && (
                <div className="flex items-center gap-1 sm:col-span-2">
                  <Check label="Track the balance month by month in the grid" checked={tracked} onChange={(e) => setTracked(e.target.checked)} />
                  <InfoTip help="household.tracked" />
                </div>
              )}
              {canLeaveOut && (
                <div className="space-y-1 sm:col-span-2">
                  <Check label="Leave out of net worth" checked={outside} onChange={(e) => setOutside(e.target.checked)} />
                  <p className="pl-6 text-xs text-muted-foreground" data-testid="acc-outside">
                    {outside
                      ? 'It keeps its balance and can still pay into the month, but no total counts it, and net worth does not either. Pocket money can land in it.'
                      : 'For money that is a person\'s own, like saved pocket money. The account keeps its balance, and net worth does not count it.'}
                  </p>
                </div>
              )}
              {type === 'investment' && (
                <>
                  <div className="space-y-1.5">
                    <Label htmlFor="acc-growth">Growth per year (%)</Label>
                    <Input id="acc-growth" inputMode="decimal" value={annual} onChange={(e) => setAnnual(e.target.value)} />
                    <p className="text-xs text-muted-foreground">Projects months without a real value. 5 means 5% a year, applied month by month.</p>
                    {dated && <p className="text-xs text-muted-foreground" data-testid="growth-changes">{dated}.</p>}
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="acc-proj">Projection</Label>
                    <NativeSelect id="acc-proj" className="w-full" value={projection} onChange={(e) => setProjection(e.target.value as typeof projection)}>
                      <option value="fixed-rate">Use the yearly growth</option>
                      <option value="historical-average">Average of the real returns I enter</option>
                    </NativeSelect>
                  </div>
                  <div className="space-y-1.5 sm:col-span-2">
                    <Label htmlFor="acc-timing">Deposits count</Label>
                    <NativeSelect id="acc-timing" className="w-full" value={timing} onChange={(e) => setTiming(e.target.value as typeof timing)}>
                      <option value="start">At the start of the month (they grow this month too)</option>
                      <option value="end">At the end of the month (they grow from next month)</option>
                    </NativeSelect>
                  </div>
                  {foreign && (
                    <>
                      <div className="space-y-1.5">
                        <Label htmlFor="acc-fxmode">Convert deposits</Label>
                        <NativeSelect id="acc-fxmode" className="w-full" value={fxMode} onChange={(e) => setFxMode(e.target.value as typeof fxMode)}>
                          <option value="monthly-rate">At that month's rate</option>
                          <option value="fixed">At a fixed rate</option>
                        </NativeSelect>
                      </div>
                      {fxMode === 'fixed' && (
                        <div className="space-y-1.5">
                          <Label htmlFor="acc-fixed">1 {baseCurrency} = ? {ccy}</Label>
                          <Input id="acc-fixed" inputMode="decimal" value={fixedRate} onChange={(e) => setFixedRate(e.target.value)} placeholder="e.g. 1.10" />
                        </div>
                      )}
                    </>
                  )}
                </>
              )}
            </div>
          )}
        </div>
        {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
        <DialogFooter className="flex-row flex-wrap gap-2 sm:justify-between">
          <div>{account && onRemove && <Button variant="ghost" size="sm" onClick={onRemove} disabled={busy}>{removeLabel}</Button>}</div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
            <Button disabled={busy || !name.trim() || ccy.length !== 3 || !!change?.refusal} onClick={() => void save()}>Save</Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
