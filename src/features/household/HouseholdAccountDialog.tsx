import { useState } from 'react'
import { ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Check } from '@/components/Check'
import { InfoTip, TipLabel } from '@/components/InfoTip'
import { MonthField } from '@/components/MonthField'
import { NativeSelect } from '@/components/NativeSelect'
import { Segmented } from '@/components/Segmented'
import { currencyChoices, currencyLabel } from '@/app/currencies'
import { amountToInput, formatMonth, parseAmount } from '@/app/format'
import { useStore } from '@/app/store'
import { ACCOUNT_TYPE_INFO, type Account, type AccountType, type Entity } from '@/model'
import { addAccount, updateAccount } from '@/store'
import { cn } from '@/lib/utils'

interface Props {
  account: Account | null
  entities: Entity[]
  baseCurrency: string
  locale: string
  startMonth: string
  /** A new account that starts from a suggestion or from its place on the Statement: a name, a type, the types on offer. */
  preset?: { name?: string; type?: AccountType; types?: AccountType[] }
  onClose: () => void
  /** A new account was saved. */
  onSaved?: (account: Account) => void
  onRemove?: () => void
  /** What the remove button says: "Delete" where removing is one click, "Archive or delete…" where it opens the dialog. */
  removeLabel?: string
}

type CardMode = 'itemized' | 'lump'
const CARD_MODES: Array<{ value: CardMode; label: string }> = [
  { value: 'itemized', label: 'Everything I buy with it' },
  { value: 'lump', label: 'Only what I pay to it' },
]
const CARD_HELP: Record<CardMode, string> = {
  itemized: 'Each purchase is an expense row that names this card. What you owe grows with them and shrinks with the payment, and the payment is not counted as spending again.',
  lump: 'Only the payment is a row, and it counts as that month\'s spending. What you owe comes from the real balances you enter.',
}
const TRACKABLE: AccountType[] = ['savings', 'investment', 'credit-card', 'loan', 'other-asset']
/** What the starting amount of an account is called: money held, money owed, or what a thing is worth. */
const balanceWord = (type: AccountType) => (type === 'credit-card' || type === 'loan' ? 'Owed' : type === 'other-asset' ? 'Worth' : 'Holds')

/**
 * An account (DESIGN.md §8). The short form asks what every account needs: its name, its type and what it holds, or
 * what is owed on it, when it starts; a card also asks what is recorded for it. The rest (currency, owner, opening
 * month, tracking, how an investment grows) keeps its usual default behind "More options", which is open when editing.
 */
export function HouseholdAccountDialog({ account, entities, baseCurrency, locale, startMonth, preset, onClose, onSaved, onRemove, removeLabel = 'Archive or delete…' }: Props) {
  const store = useStore()
  const types = ACCOUNT_TYPE_INFO.filter((t) => account || !preset?.types || preset.types.includes(t.value))
  const [name, setName] = useState(account?.name ?? preset?.name ?? '')
  const [type, setType] = useState<AccountType>(account?.type ?? preset?.type ?? types[0]?.value ?? 'checking')
  const [currency, setCurrency] = useState(account?.currency ?? baseCurrency)
  const [opening, setOpening] = useState(account ? amountToInput(account.openingBalance, account.currency, locale) : '')
  const [openingMonth, setOpeningMonth] = useState(account?.openingMonth ?? startMonth)
  const [owner, setOwner] = useState(account?.ownerEntityId ?? '')
  const [tracked, setTracked] = useState(account?.tracked ?? true)
  const inv0 = account?.investment
  const [annual, setAnnual] = useState(inv0 ? String(Math.round(inv0.annualRate * 10000) / 100) : '5')
  const [projection, setProjection] = useState<'fixed-rate' | 'historical-average'>(inv0?.projectionMode ?? 'fixed-rate')
  const [timing, setTiming] = useState<'start' | 'end'>(inv0?.depositTiming ?? 'start')
  const [fxMode, setFxMode] = useState<'monthly-rate' | 'fixed'>(inv0?.depositFxMode ?? 'monthly-rate')
  const [fixedRate, setFixedRate] = useState(inv0?.fixedRate ? String(inv0.fixedRate) : '')
  const [cardMode, setCardMode] = useState<CardMode>(account?.card?.cardMode ?? 'itemized')
  const [more, setMore] = useState(!!account)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const adults = entities.filter((e) => e.kind === 'adult' && !e.deletedAt)
  // a child can own an account too: their long-term savings row goes into it
  const children = entities.filter((e) => e.kind === 'child' && !e.deletedAt)
  const trackable = TRACKABLE.includes(type)
  const ccy = currency.toUpperCase()
  const foreign = ccy !== baseCurrency && ccy.length === 3
  const info = ACCOUNT_TYPE_INFO.find((t) => t.value === type)

  async function save() {
    const openingBalance = opening.trim() ? parseAmount(opening, ccy, locale) : 0
    if (openingBalance == null) return setError(`"${balanceWord(type)} at the start" is not a number I can read.`)
    const annualRate = Number(annual.replace(',', '.')) / 100
    if (type === 'investment' && !Number.isFinite(annualRate)) return setError('Growth per year is not a number.')
    const fixed = Number(fixedRate.replace(',', '.'))
    if (type === 'investment' && foreign && fxMode === 'fixed' && !(fixed > 0)) return setError('Give the fixed rate as a positive number.')
    const patch = {
      name: name.trim(), type, currency: ccy, openingBalance, openingMonth, ownerEntityId: owner || null, tracked: trackable ? tracked : false,
      investment: type === 'investment'
        ? { projectionMode: projection, annualRate, depositTiming: timing, depositFxMode: foreign ? fxMode : 'monthly-rate' as const, fixedRate: fxMode === 'fixed' && foreign ? fixed : null }
        : undefined,
      card: type === 'credit-card' ? { cardMode } : undefined,
    }
    setBusy(true)
    setError(null)
    try {
      if (account) {
        await updateAccount(store, account.id, patch)
      } else {
        const made = await addAccount(store, patch)
        onSaved?.(made)
      }
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
        <DialogHeader><DialogTitle>{account ? 'Edit account' : 'New account'}</DialogTitle></DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5"><Label htmlFor="acc-name">Name</Label><Input id="acc-name" autoFocus value={name} onChange={(e) => setName(e.target.value)} /></div>
          <div className="space-y-1.5"><Label htmlFor="acc-type">Type</Label><NativeSelect id="acc-type" className="w-full" value={type} onChange={(e) => setType(e.target.value as AccountType)}>{types.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}</NativeSelect></div>
          <p className="-mt-1 text-xs text-muted-foreground sm:col-span-2">{info?.help}{foreign ? ` Amounts are typed in ${ccy} and shown in ${baseCurrency} beneath. The rates come from the European Central Bank by themselves (only currency codes and dates are sent); change them under Household, "Currency rates".` : ''}</p>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="acc-open">{balanceWord(type)} at the start of {formatMonth(openingMonth, locale, 'long')} ({ccy})</Label>
            <Input id="acc-open" className="sm:w-1/2" inputMode="decimal" value={opening} onChange={(e) => setOpening(e.target.value)} placeholder="0" />
            <p className="text-xs text-muted-foreground">
              {type === 'loan' ? 'What is still owed. A payment row that names this loan brings it down.'
                : type === 'credit-card' ? 'What you owed on the card when the month began.'
                : type === 'other-asset' ? 'What it is worth. Enter a real value from its line whenever that changes.'
                : 'From then on the months add to it. A real balance can be entered from its line in any month.'}
            </p>
          </div>
          {type === 'credit-card' && (
            <fieldset className="space-y-1.5 sm:col-span-2">
              <legend className="text-sm font-medium">What do you record for this card?</legend>
              <Segmented label="What do you record for this card?" value={cardMode} onChange={(v) => setCardMode(v as CardMode)} options={CARD_MODES} />
              <p className="text-xs text-muted-foreground">{CARD_HELP[cardMode]}</p>
            </fieldset>
          )}
          <div className="sm:col-span-2">
            <button
              type="button" aria-expanded={more} aria-controls="acc-more" onClick={() => setMore((v) => !v)}
              className="flex items-center gap-1 rounded text-xs text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
            >
              <ChevronRight className={cn('size-3.5 transition-transform', more && 'rotate-90')} aria-hidden />
              More options
              {!more && <span className="text-muted-foreground/80">: currency, owner, opening month{trackable ? ', tracking' : ''}{type === 'investment' ? ', growth' : ''}</span>}
            </button>
          </div>
          {more && (
            <div id="acc-more" className="grid gap-3 sm:col-span-2 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="acc-ccy">Currency</Label>
                <NativeSelect id="acc-ccy" className="w-full" value={currency} onChange={(e) => setCurrency(e.target.value)}>
                  {currencyChoices(baseCurrency, account?.currency).map((c) => <option key={c} value={c}>{currencyLabel(c, baseCurrency)}</option>)}
                </NativeSelect>
              </div>
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
              {type === 'investment' && (
                <>
                  <div className="space-y-1.5">
                    <Label htmlFor="acc-growth">Growth per year (%)</Label>
                    <Input id="acc-growth" inputMode="decimal" value={annual} onChange={(e) => setAnnual(e.target.value)} />
                    <p className="text-xs text-muted-foreground">Projects months without a real value. 5 means 5% a year, applied month by month.</p>
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
            <Button disabled={busy || !name.trim() || currency.length !== 3} onClick={() => void save()}>Save</Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
