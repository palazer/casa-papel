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
import { txt } from '@/i18n'

const T = txt.household.account

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
const balanceWord = (type: AccountType) => (type === 'credit-card' || type === 'loan' ? T.owed : type === 'other-asset' ? T.worth : T.holds)

/**
 * An account (DESIGN.md §8). The short form asks what every account needs: its name, its type and what it holds, or
 * what is owed on it, when it starts. The rest (currency, owner, opening
 * month, tracking, how an investment grows) keeps its usual default behind "More options", which is open when editing.
 */
export function HouseholdAccountDialog({ account, entities, baseCurrency, locale, startMonth, preset, rows, withRow, onClose, onSaved, onRowAdded, onRemove, removeLabel = txt.common.archiveOrDelete }: Props) {
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
      setError(saveError(e, T.couldNotAddThe))
    } finally {
      setBusy(false)
    }
  }

  async function save() {
    const openingBalance = opening.trim() ? parseAmount(opening, ccy, locale) : 0
    if (openingBalance == null) return setError(unreadableAmount(opening, T.startNotANumber(balanceWord(type))))
    // a payment stops at what is owed, so a loan or card that says nothing about it would take no payment at all
    if (debt && trackable && tracked && !opening.trim()) {
      return setError(T.typeWhatIsStill(type))
    }
    const annualRate = Number(annual.replace(',', '.')) / 100
    if (type === 'investment' && !Number.isFinite(annualRate)) return setError(T.growthPerYearIs)
    const fixed = Number(fixedRate.replace(',', '.'))
    if (type === 'investment' && foreign && fxMode === 'fixed' && !(fixed > 0)) return setError(T.giveTheFixedRate)
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
      setError(saveError(e, txt.common.couldNotSave))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="sm:max-w-lg" aria-describedby={undefined}>
        <DialogHeader><DialogTitle>{account ? T.editAccount : T.newAccount}</DialogTitle></DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5"><Label htmlFor="acc-name">{txt.common.name}</Label><Input id="acc-name" autoFocus value={name} onChange={(e) => setName(e.target.value)} /></div>
          <div className="space-y-1.5"><Label htmlFor="acc-type">{T.type}</Label><NativeSelect id="acc-type" className="w-full" value={type} aria-invalid={change?.refusal ? true : undefined} onChange={(e) => pickType(e.target.value as AccountType)}>{types.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}</NativeSelect></div>
          {change?.refusal && <p role="alert" className="-mt-1 text-xs text-destructive sm:col-span-2" data-testid="acc-type-refusal">{change.refusal}</p>}
          <p className="-mt-1 text-xs text-muted-foreground sm:col-span-2" data-testid="acc-type-help">{T.typeHelp(info?.help ?? '', type === 'joint' && main ? main.name : null, foreign ? ccy : null, baseCurrency)}</p>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="acc-open">{T.balanceAtStart(balanceWord(type), formatMonth(openingMonth, locale, 'long'), ccy)}</Label>
            <Input id="acc-open" className="sm:w-1/2" inputMode="decimal" value={opening} onChange={(e) => setOpening(e.target.value)} placeholder="0" />
            <AmountHint text={opening} currency={ccy} locale={locale} />
            <p className="text-xs text-muted-foreground">
              {type === 'loan' ? T.whatIsStillOwed
                : type === 'credit-card' ? T.everythingYouOweOn
                : type === 'other-asset' ? T.whatItIsWorth
                : T.fromThenOnEvery}
            </p>
          </div>
          {offersRow && (
            <div className="space-y-1 sm:col-span-2">
              <Check label={T.addTheRowThat} checked={payOff} onChange={(e) => setPayOff(e.target.checked)} />
              <p className="pl-6 text-xs text-muted-foreground" data-testid="acc-row">
                {payOff
                  ? T.payOffRow(rowName, type === 'credit-card')
                  : T.noRowYetOne}
              </p>
            </div>
          )}
          {withRow && (
            <p className="text-xs text-muted-foreground sm:col-span-2" data-testid="acc-row">
              {T.savingAlsoAddsThe(rowName)}
            </p>
          )}
          {paidBy && (
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground sm:col-span-2" data-testid="acc-paid-by">
              {paidBy.length > 0
                ? <p>{T.paidOffBy(paidBy.map((r) => `"${r.name}"`).join(', '))}</p>
                : type === account?.type && (
                  <>
                    <p>{T.noRowPaysThis}</p>
                    <Button size="xs" variant="outline" disabled={busy} onClick={() => void addRow()}>{T.addTheRowThat}</Button>
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
              {T.moreOptions}
              {!more && <span className="text-muted-foreground/80">{T.moreOptionsList(trackable, canLeaveOut, type)}</span>}
            </button>
          </div>
          {more && (
            <div id="acc-more" className="grid gap-3 sm:col-span-2 sm:grid-cols-2">
              {type === 'checking' ? (
                <div className="space-y-1.5">
                  <span className="text-sm font-medium">{txt.common.currency}</span>
                  <p className="text-xs text-muted-foreground" data-testid="acc-main-currency">{T.theMainAccountIs(currencyLabel(baseCurrency, baseCurrency))}</p>
                </div>
              ) : (
                <div className="space-y-1.5">
                  <Label htmlFor="acc-ccy">{txt.common.currency}</Label>
                  <NativeSelect id="acc-ccy" className="w-full" value={currency} onChange={(e) => setCurrency(e.target.value)}>
                    {currencyChoices(baseCurrency, account?.currency).map((c) => <option key={c} value={c}>{currencyLabel(c, baseCurrency)}</option>)}
                  </NativeSelect>
                </div>
              )}
              <div className="space-y-1.5"><Label htmlFor="acc-month">{T.openingMonth}</Label><MonthField id="acc-month" label={T.openingMonth} value={openingMonth} onChange={setOpeningMonth} locale={locale} /></div>
              <div className="space-y-1.5 sm:col-span-2">
                <TipLabel htmlFor="acc-owner" help="setup.owner">{T.owner}</TipLabel>
                <NativeSelect id="acc-owner" className="w-full" value={owner} onChange={(e) => setOwner(e.target.value)}><option value="">{T.householdJoint}</option>{adults.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}{children.map((c) => <option key={c.id} value={c.id}>{T.child(c.name)}</option>)}</NativeSelect>
              </div>
              {trackable && (
                <div className="flex items-center gap-1 sm:col-span-2">
                  <Check label={T.trackTheBalanceMonth} checked={tracked} onChange={(e) => setTracked(e.target.checked)} />
                  <InfoTip help="household.tracked" />
                </div>
              )}
              {canLeaveOut && (
                <div className="space-y-1 sm:col-span-2">
                  <Check label={T.leaveOutOfNet} checked={outside} onChange={(e) => setOutside(e.target.checked)} />
                  <p className="pl-6 text-xs text-muted-foreground" data-testid="acc-outside">
                    {outside
                      ? T.itKeepsItsBalance
                      : T.forMoneyThatIs}
                  </p>
                </div>
              )}
              {type === 'investment' && (
                <>
                  <div className="space-y-1.5">
                    <Label htmlFor="acc-growth">{T.growthPerYear}</Label>
                    <Input id="acc-growth" inputMode="decimal" value={annual} onChange={(e) => setAnnual(e.target.value)} />
                    <p className="text-xs text-muted-foreground">{T.projectsMonthsWithoutA}</p>
                    {dated && <p className="text-xs text-muted-foreground" data-testid="growth-changes">{dated}.</p>}
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="acc-proj">{T.projection}</Label>
                    <NativeSelect id="acc-proj" className="w-full" value={projection} onChange={(e) => setProjection(e.target.value as typeof projection)}>
                      <option value="fixed-rate">{T.useTheYearlyGrowth}</option>
                      <option value="historical-average">{T.averageOfTheReal}</option>
                    </NativeSelect>
                  </div>
                  <div className="space-y-1.5 sm:col-span-2">
                    <Label htmlFor="acc-timing">{T.depositsCount}</Label>
                    <NativeSelect id="acc-timing" className="w-full" value={timing} onChange={(e) => setTiming(e.target.value as typeof timing)}>
                      <option value="start">{T.depositsAtStart}</option>
                      <option value="end">{T.atTheEndOf}</option>
                    </NativeSelect>
                  </div>
                  {foreign && (
                    <>
                      <div className="space-y-1.5">
                        <Label htmlFor="acc-fxmode">{T.convertDeposits}</Label>
                        <NativeSelect id="acc-fxmode" className="w-full" value={fxMode} onChange={(e) => setFxMode(e.target.value as typeof fxMode)}>
                          <option value="monthly-rate">{T.atThatMonthsRate}</option>
                          <option value="fixed">{T.atAFixedRate}</option>
                        </NativeSelect>
                      </div>
                      {fxMode === 'fixed' && (
                        <div className="space-y-1.5">
                          <Label htmlFor="acc-fixed">1 {baseCurrency} = ? {ccy}</Label>
                          <Input id="acc-fixed" inputMode="decimal" value={fixedRate} onChange={(e) => setFixedRate(e.target.value)} placeholder={T.eG110} />
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
            <Button variant="outline" onClick={onClose} disabled={busy}>{txt.common.cancel}</Button>
            <Button disabled={busy || !name.trim() || ccy.length !== 3 || !!change?.refusal} onClick={() => void save()}>{txt.common.save}</Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
