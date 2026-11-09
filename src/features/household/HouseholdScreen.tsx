import { MonthField } from '@/components/MonthField'
import { GroupTabs } from '@/components/GroupTabs'
import { PageHeader } from '@/components/PageHeader'
import { RecurringList } from '@/features/recurring/RecurringList'
import { FxCard } from './FxCard'
import { SharesCard } from './SharesCard'
import { HUES } from '@/app/hues'
import { InfoTip, TipLabel } from '@/components/InfoTip'
import { PoolsCard } from './PoolsCard'
import { CategoriesCard } from './CategoriesCard'
import { ArchivedRowsCard } from './ArchivedRowsCard'
import { RemoveDialog } from '@/features/remove/RemoveDialog'
import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Chip } from '@/components/ui/chip'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Island } from '@/components/ui/island'
import { Label } from '@/components/ui/label'
import { Check } from '@/components/Check'
import { NativeSelect } from '@/components/NativeSelect'
import { localeExample, localeLabel, amountToInput, formatAmount, formatMonth, parseAmount } from '@/app/format'
import { useStore } from '@/app/store'
import { activeHousehold, defaultMonths, useEngine, useTables } from '@/app/useEngine'
import {
  ENTITY_KIND_LABEL, ENTITY_TEMPLATES, monthOfDate, templateTitle,
  ACCOUNT_TYPE_INFO, ENTITY_KIND_HELP, type Account, type AccountType, type Entity, type EntityKind, type Household, type Tables,
} from '@/model'
import { addAccount, addEntity, applyTemplates, restoreAccount, restoreEntity, setAccountActual, setMonthlyDefault, updateAccount, updateEntity, updateHousehold, type MonthlyDefaultScope } from '@/store'

const LOCALES = ['en-IE', 'en-GB', 'en-US', 'de-DE', 'de-AT', 'tr-TR', 'fr-FR', 'es-ES', 'nl-NL', 'it-IT', 'pt-PT', 'sv-SE']
const ACCOUNT_TYPES = ACCOUNT_TYPE_INFO
const KINDS: EntityKind[] = ['adult', 'child', 'pet', 'vehicle', 'property', 'company', 'other']

/** The household's settings and its parts: people & things, accounts, pool accounts, currency rates, schedules. A reading page: air islands. */
export function HouseholdScreen() {
  const store = useStore()
  const tables = useTables()
  const household = activeHousehold(tables)
  const months = useMemo(() => (household && tables ? defaultMonths(household, tables) : []), [household, tables])
  const engine = useEngine(tables, months)
  const [error, setError] = useState<string | null>(null)
  if (!tables || !household || !engine) return null
  const act = (fn: () => Promise<unknown>) => void fn().catch((e) => setError(e instanceof Error ? e.message : 'Action failed'))
  const people = tables.entities.filter((e) => !e.deletedAt && !e.archivedMonth).length
  const accounts = tables.accounts.filter((a) => !a.deletedAt && !a.archivedMonth).length

  return (
    <div className="mx-auto max-w-3xl space-y-4 text-xs">
      <PageHeader title="Household" subline={`${household.name} · ${people} ${people === 1 ? 'person or thing' : 'people & things'} · ${accounts} ${accounts === 1 ? 'account' : 'accounts'}`}>
        {error && <p role="alert" className="basis-full text-destructive">{error}</p>}
      </PageHeader>
      <GroupTabs />
      <SettingsCard household={household} tables={tables} onSave={(p) => act(() => updateHousehold(store, p))} onMonthly={(key, value, scope) => act(() => setMonthlyDefault(store, key, value, scope, monthOfDate()))} />
      {household.moneyMode === 'proportional' && <SharesCard household={household} tables={tables} engine={engine} onError={setError} />}
      <EntitiesCard household={household} tables={tables} entities={tables.entities.filter((e) => !e.deletedAt)} onError={setError} />
      <AccountsCard household={household} tables={tables} accounts={tables.accounts.filter((a) => !a.deletedAt)} entities={tables.entities} engine={engine} months={months} onError={setError} />
      <PoolsCard household={household} tables={tables} engine={engine} onError={setError} />
      <CategoriesCard household={household} tables={tables} onError={setError} />
      <ArchivedRowsCard household={household} tables={tables} onError={setError} />
      <FxCard household={household} tables={tables} months={months} onError={setError} />
      <Island air tone={HUES.transfer} title="Schedules" description="Recurring payments and incomes: rent, salary, insurance, subscriptions, anything on a schedule. They land in the grid by themselves and show up in Moves when due.">
        <RecurringList />
      </Island>
    </div>
  )
}

function SettingsCard({ household: h, tables, onSave, onMonthly }: { household: Household; tables: Tables; onSave: (p: Partial<Household>) => void; onMonthly: (key: 'pocketTotal' | 'cashBuffer', value: number, scope: MonthlyDefaultScope) => void }) {
  const thisMonth = monthOfDate()
  const state = tables.monthStates.find((s) => s.month === thisMonth)
  const effective = (key: 'pocketTotal' | 'cashBuffer') => (key === 'pocketTotal' ? state?.pocketTotalOverride : state?.cashBufferOverride) ?? h[key]
  const [name, setName] = useState(h.name)
  const [scope, setScope] = useState<MonthlyDefaultScope>('from-now-on')
  const [pocket, setPocket] = useState(amountToInput(effective('pocketTotal'), h.baseCurrency, h.locale))
  const [buffer, setBuffer] = useState(amountToInput(effective('cashBuffer'), h.baseCurrency, h.locale))
  const money = (s: string) => (s.trim() ? parseAmount(s, h.baseCurrency, h.locale) ?? 0 : 0)
  return (
    <Island air title="Household settings" description="Closed months keep the values they were closed with.">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="s-name">Household name</Label>
          <Input id="s-name" value={name} onChange={(e) => setName(e.target.value)} onBlur={() => name.trim() && name !== h.name && onSave({ name: name.trim() })} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="s-locale">Number format</Label>
          <NativeSelect id="s-locale" className="w-full" value={h.locale} onChange={(e) => onSave({ locale: e.target.value })}>{LOCALES.map((l) => <option key={l} value={l}>{localeLabel(l)} — {localeExample(l)}</option>)}</NativeSelect>
        </div>
        <div className="space-y-1.5">
          <TipLabel htmlFor="s-rule" help="household.closingRule">Month-end rule</TipLabel>
          <NativeSelect id="s-rule" className="w-full" value={h.closingRule} onChange={(e) => onSave({ closingRule: e.target.value as Household['closingRule'] })}>
            <option value="savings-plug">Leftover goes to savings</option>
            <option value="leftover-plug">I decide the savings amount</option>
          </NativeSelect>
        </div>
        <div className="space-y-1.5">
          <TipLabel htmlFor="s-mode" help="household.moneyMode">How you share money</TipLabel>
          <NativeSelect id="s-mode" className="w-full" value={h.moneyMode} onChange={(e) => onSave({ moneyMode: e.target.value as Household['moneyMode'] })}>
            <option value="pooled">Pooled, with pocket money</option>
            <option value="proportional">In proportion to income</option>
          </NativeSelect>
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <TipLabel htmlFor="s-scope" help="household.pocketScope">Pocket money and cash buffer changes apply to</TipLabel>
          <NativeSelect id="s-scope" className="w-full" value={scope} onChange={(e) => setScope(e.target.value as MonthlyDefaultScope)}>
            <option value="from-now-on">This month and onwards (earlier months keep what they show)</option>
            <option value="this-month">Only this month</option>
            <option value="all-open">Every open month</option>
          </NativeSelect>
          <p className="text-muted-foreground">Closed months are never changed. "This month" is {formatMonth(thisMonth, h.locale)}.</p>
        </div>
        <div className="space-y-1.5">
          <TipLabel htmlFor="s-pocket" help="household.pocket">Pocket money per month, all adults ({h.baseCurrency})</TipLabel>
          <Input id="s-pocket" inputMode="decimal" value={pocket} onChange={(e) => setPocket(e.target.value)} onBlur={() => { const v = money(pocket); if (v !== effective('pocketTotal')) onMonthly('pocketTotal', v, scope) }} />
          {effective('pocketTotal') !== h.pocketTotal && <p className="text-muted-foreground">This month {formatAmount(effective('pocketTotal'), h.baseCurrency, h.locale)} · default {formatAmount(h.pocketTotal, h.baseCurrency, h.locale)}</p>}
        </div>
        <div className="space-y-1.5">
          <TipLabel htmlFor="s-buffer" help="household.buffer">Cash kept in the account at month end ({h.baseCurrency})</TipLabel>
          <Input id="s-buffer" inputMode="decimal" value={buffer} onChange={(e) => setBuffer(e.target.value)} onBlur={() => { const v = money(buffer); if (v !== effective('cashBuffer')) onMonthly('cashBuffer', v, scope) }} />
          {effective('cashBuffer') !== h.cashBuffer && <p className="text-muted-foreground">This month {formatAmount(effective('cashBuffer'), h.baseCurrency, h.locale)} · default {formatAmount(h.cashBuffer, h.baseCurrency, h.locale)}</p>}
        </div>
        <div className="sm:col-span-2">
          <Check label="Show expenses as negative red numbers" checked={h.displayExpensesNegative} onChange={(e) => onSave({ displayExpensesNegative: e.target.checked })} />
        </div>
        <p className="text-muted-foreground sm:col-span-2">Base currency {h.baseCurrency} · first month {formatMonth(h.startMonth, h.locale)}. These cannot be changed after setup.</p>
      </div>
    </Island>
  )
}

function EntitiesCard({ household, tables, entities: allEntities, onError }: { household: Household; tables: Tables; entities: Entity[]; onError: (m: string) => void }) {
  const store = useStore()
  const [kind, setKind] = useState<EntityKind>('adult')
  const [name, setName] = useState('')
  const [paidBy, setPaidBy] = useState('')
  const [templatesFor, setTemplatesFor] = useState<Entity | null>(null)
  const [removing, setRemoving] = useState<Entity | null>(null)
  const entities = allEntities.filter((e) => !e.archivedMonth)
  const archived = allEntities.filter((e) => e.archivedMonth)
  const adults = entities.filter((e) => e.kind === 'adult')
  const act = (fn: () => Promise<unknown>) => void fn().catch((e) => onError(e instanceof Error ? e.message : 'Action failed'))
  const add = () => {
    act(() => addEntity(store, { kind, name: name.trim(), paidBy: kind === 'adult' ? null : paidBy || null }))
    setName('')
  }

  return (
    <Island air title="People & things" description="Who and what the household pays for. Each one can bring suggested rows.">
      <div className="space-y-4">
        <ul className="divide-y divide-border/60">
          {entities.map((e) => (
            <li key={e.id} className="flex min-h-8 flex-wrap items-center gap-2 py-1">
              <Chip tone="zinc">{ENTITY_KIND_LABEL[e.kind].toLowerCase()}</Chip>
              <span className="font-medium">{e.name}</span>
              {e.kind !== 'adult' && (
                <NativeSelect aria-label={`Who pays for ${e.name}`} className="h-6 text-xs" value={e.paidBy ?? ''} onChange={(ev) => act(() => updateEntity(store, e.id, { paidBy: ev.target.value || null }))}>
                  <option value="">Costs shared</option>
                  {adults.map((a) => <option key={a.id} value={a.id}>Paid by {a.name}</option>)}
                </NativeSelect>
              )}
              <span className="ml-auto flex gap-1">
                <Button size="xs" variant="outline" onClick={() => setTemplatesFor(e)}>Suggested rows…</Button>
                <Button size="xs" variant="ghost" onClick={() => setRemoving(e)}>Archive or delete…</Button>
              </span>
            </li>
          ))}
          {entities.length === 0 && <li className="py-1 text-muted-foreground">Nobody yet.</li>}
        </ul>
        {archived.length > 0 && (
          <div className="space-y-1">
            <p className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Archived <InfoTip help="household.archived" /></p>
            <ul className="divide-y divide-border/60">
              {archived.map((e) => (
                <li key={e.id} className="flex min-h-8 flex-wrap items-center gap-2 py-1 text-muted-foreground">
                  <Chip tone="zinc">{ENTITY_KIND_LABEL[e.kind].toLowerCase()}</Chip>
                  <span>{e.name}</span>
                  <span>since {formatMonth(e.archivedMonth!, household.locale)}</span>
                  <Button size="xs" variant="outline" className="ml-auto" onClick={() => act(() => restoreEntity(store, e.id))}>Restore</Button>
                </li>
              ))}
            </ul>
          </div>
        )}
        <div className="space-y-2">
          <div className="flex flex-wrap gap-1.5">
            {KINDS.map((k) => (
              <Button key={k} size="xs" variant={kind === k ? 'default' : 'outline'} aria-pressed={kind === k} title={ENTITY_KIND_HELP[k]} onClick={() => setKind(k)}>Add {ENTITY_KIND_LABEL[k].toLowerCase()}</Button>
            ))}
          </div>
          <p className="text-muted-foreground">{ENTITY_KIND_HELP[kind]}</p>
          <div className="flex flex-wrap items-end gap-2">
            <div className="space-y-1">
              <Label htmlFor="e-name">{ENTITY_KIND_LABEL[kind]} name</Label>
              <Input id="e-name" className="w-44" value={name} placeholder={kind === 'property' ? 'e.g. Flat, Elm Street' : 'Name'} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && name.trim()) add() }} />
            </div>
            {kind !== 'adult' && (
              <div className="space-y-1">
                <Label htmlFor="e-paidby">Who pays</Label>
                <NativeSelect id="e-paidby" value={paidBy} onChange={(e) => setPaidBy(e.target.value)}>
                  <option value="">Costs shared</option>
                  {adults.map((a) => <option key={a.id} value={a.id}>Paid by {a.name}</option>)}
                </NativeSelect>
              </div>
            )}
            <Button size="sm" disabled={!name.trim()} onClick={add}>Add</Button>
          </div>
        </div>
        {templatesFor && <TemplatesDialog household={household} entity={templatesFor} onClose={() => setTemplatesFor(null)} onError={onError} />}
        {removing && <RemoveDialog target={{ kind: 'entity', id: removing.id }} tables={tables} household={household} onClose={() => setRemoving(null)} />}
      </div>
    </Island>
  )
}

function TemplatesDialog({ household, entity, onClose, onError }: { household: Household; entity: Entity; onClose: () => void; onError: (m: string) => void }) {
  const store = useStore()
  const all = ENTITY_TEMPLATES[entity.kind].filter((t) => !(t.pocket && household.moneyMode !== 'pooled'))
  const [chosen, setChosen] = useState<Set<string>>(() => new Set(all.filter((t) => t.recommended).map((t) => t.key)))
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="sm:max-w-md" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>Suggested rows for {entity.name}</DialogTitle>
          <DialogDescription>Tick what applies. Rows are added at the end of their section.</DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          {all.map((t) => <Check key={t.key} label={templateTitle(t, entity.name)} checked={chosen.has(t.key)} onChange={(e) => { const s = new Set(chosen); if (e.target.checked) s.add(t.key); else s.delete(t.key); setChosen(s) }} />)}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button disabled={chosen.size === 0} onClick={() => { applyTemplates(store, [...chosen], entity.id).then(onClose).catch((e) => onError(e instanceof Error ? e.message : 'Failed')) }}>Add {chosen.size} row{chosen.size === 1 ? '' : 's'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function AccountsCard({ household, tables, accounts: allAccounts, entities, engine, months, onError }: { household: Household; tables: Tables; accounts: Account[]; entities: Entity[]; engine: ReturnType<typeof useEngine>; months: string[]; onError: (m: string) => void }) {
  const store = useStore()
  const [editing, setEditing] = useState<Account | 'new' | null>(null)
  const [removing, setRemoving] = useState<Account | null>(null)
  const [actualsFor, setActualsFor] = useState<string | null>(null)
  const { locale, baseCurrency } = household
  const accounts = allAccounts.filter((a) => !a.archivedMonth)
  const archived = allAccounts.filter((a) => a.archivedMonth)
  const act = (fn: () => Promise<unknown>) => void fn().catch((e) => onError(e instanceof Error ? e.message : 'Action failed'))
  return (
    <Island air tone={HUES.worth} title="Accounts" description="Savings accounts get a running balance from your grid. Enter the real balance any month to keep it honest.">
      <div className="space-y-3">
        <ul className="divide-y divide-border/60">
          {accounts.map((a) => (
            <li key={a.id} className="py-1">
              <div className="flex min-h-6 flex-wrap items-center gap-2">
                <Chip tone="zinc">{(ACCOUNT_TYPES.find((t) => t.value === a.type)?.label ?? a.type).toLowerCase()}</Chip>
                <span className="font-medium">{a.name}</span>
                <span className="text-muted-foreground">{a.currency}{a.ownerEntityId ? ` · ${entities.find((e) => e.id === a.ownerEntityId)?.name ?? ''}` : ''} · opening {formatAmount(a.openingBalance, a.currency, locale)} in {formatMonth(a.openingMonth, locale)}</span>
                <span className="ml-auto flex gap-1">
                  {(a.type === 'savings' || a.type === 'investment') && a.tracked && <Button size="xs" variant="outline" onClick={() => setActualsFor(actualsFor === a.id ? null : a.id)}>Real balances</Button>}
                  <Button size="xs" variant="ghost" onClick={() => setEditing(a)}>Edit</Button>
                </span>
              </div>
              {actualsFor === a.id && engine && (
                <table className="mt-2 w-full">
                  <thead><tr className="text-muted-foreground"><th className="py-1 text-left font-semibold">Month</th><th className="text-right font-semibold">Computed</th><th className="text-right font-semibold">Real balance</th></tr></thead>
                  <tbody>
                    {months.filter((m) => m <= monthOfDate()).slice(-12).map((m) => {
                      const r = engine.accounts[a.id]?.months[m]
                      return (
                        <tr key={m}>
                          <td className="py-0.5">{formatMonth(m, locale)}</td>
                          <td className="text-right tabular-nums">{r ? formatAmount(r.computed, a.currency, locale) : ''}</td>
                          <td className="text-right">
                            <Input
                              aria-label={`Real balance ${formatMonth(m, locale)}`} className="ml-auto h-6 w-36 text-right" inputMode="decimal"
                              defaultValue={r && r.adjustment !== 0 ? amountToInput(r.balance, a.currency, locale) : ''}
                              placeholder="same as computed"
                              onBlur={(e) => { const v = e.target.value.trim() ? parseAmount(e.target.value, a.currency, locale) : null; setAccountActual(store, a.id, m, v).catch((err) => onError(err instanceof Error ? err.message : 'Failed')) }}
                            />
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              )}
            </li>
          ))}
        </ul>
        {archived.length > 0 && (
          <div className="space-y-1">
            <p className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Archived <InfoTip help="household.archived" /></p>
            <ul className="divide-y divide-border/60">
              {archived.map((a) => (
                <li key={a.id} className="flex min-h-8 flex-wrap items-center gap-2 py-1 text-muted-foreground">
                  <Chip tone="zinc">{(ACCOUNT_TYPES.find((t) => t.value === a.type)?.label ?? a.type).toLowerCase()}</Chip>
                  <span>{a.name}</span>
                  <span>since {formatMonth(a.archivedMonth!, locale)}</span>
                  <Button size="xs" variant="outline" className="ml-auto" onClick={() => act(() => restoreAccount(store, a.id))}>Restore</Button>
                </li>
              ))}
            </ul>
          </div>
        )}
        <Button variant="outline" size="xs" onClick={() => setEditing('new')}>Add account</Button>
        {editing && (
          <AccountDialog
            account={editing === 'new' ? null : editing} entities={entities} baseCurrency={baseCurrency} locale={locale} startMonth={household.startMonth}
            onClose={() => setEditing(null)} onError={onError} onRemove={editing !== 'new' ? () => { setRemoving(editing); setEditing(null) } : undefined}
          />
        )}
        {removing && <RemoveDialog target={{ kind: 'account', id: removing.id }} tables={tables} household={household} onClose={() => setRemoving(null)} />}
      </div>
    </Island>
  )
}

function AccountDialog({ account, entities, baseCurrency, locale, startMonth, onClose, onError, onRemove }: { account: Account | null; entities: Entity[]; baseCurrency: string; locale: string; startMonth: string; onClose: () => void; onError: (m: string) => void; onRemove?: () => void }) {
  const store = useStore()
  const [name, setName] = useState(account?.name ?? '')
  const [type, setType] = useState<AccountType>(account?.type ?? 'checking')
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
  const [cardMode, setCardMode] = useState<'itemized' | 'lump'>(account?.card?.cardMode ?? 'itemized')
  const [error, setError] = useState<string | null>(null)
  const adults = entities.filter((e) => e.kind === 'adult' && !e.deletedAt)
  // a child can own an account too: their long-term savings row goes into it
  const children = entities.filter((e) => e.kind === 'child' && !e.deletedAt)
  const trackable = ['savings', 'investment', 'credit-card', 'loan', 'other-asset'].includes(type)
  const ccy = currency.toUpperCase()

  function save() {
    const openingBalance = opening.trim() ? parseAmount(opening, ccy, locale) : 0
    if (openingBalance == null) return setError('Opening balance is not a number I can read.')
    const annualRate = Number(annual.replace(',', '.')) / 100
    if (type === 'investment' && !Number.isFinite(annualRate)) return setError('Growth per year is not a number.')
    const fixed = Number(fixedRate.replace(',', '.'))
    if (type === 'investment' && fxMode === 'fixed' && !(fixed > 0)) return setError('Give the fixed rate as a positive number.')
    const patch = {
      name: name.trim(), type, currency: ccy, openingBalance, openingMonth, ownerEntityId: owner || null, tracked: trackable ? tracked : false,
      investment: type === 'investment'
        ? { projectionMode: projection, annualRate, depositTiming: timing, depositFxMode: ccy === baseCurrency ? 'monthly-rate' as const : fxMode, fixedRate: fxMode === 'fixed' && ccy !== baseCurrency ? fixed : null }
        : undefined,
      card: type === 'credit-card' ? { cardMode } : undefined,
    }
    const p = account ? updateAccount(store, account.id, patch) : addAccount(store, patch)
    p.then(onClose).catch((e) => onError(e instanceof Error ? e.message : 'Failed'))
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="sm:max-w-lg" aria-describedby={undefined}>
        <DialogHeader><DialogTitle>{account ? 'Edit account' : 'New account'}</DialogTitle></DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5 sm:col-span-2"><Label htmlFor="acc-name">Name</Label><Input id="acc-name" autoFocus value={name} onChange={(e) => setName(e.target.value)} /></div>
          <div className="space-y-1.5"><Label htmlFor="acc-type">Type</Label><NativeSelect id="acc-type" className="w-full" value={type} onChange={(e) => setType(e.target.value as AccountType)}>{ACCOUNT_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}</NativeSelect></div>
          <div className="space-y-1.5"><Label htmlFor="acc-ccy">Currency</Label><Input id="acc-ccy" value={currency} maxLength={3} onChange={(e) => setCurrency(e.target.value.toUpperCase())} /></div>
          <p className="-mt-1 text-xs text-muted-foreground sm:col-span-2">{ACCOUNT_TYPES.find((t) => t.value === type)?.help}{ccy !== baseCurrency && ccy.length === 3 ? ` Amounts are shown in ${ccy}; the Currency rates card converts them.` : ''}</p>
          <div className="space-y-1.5"><Label htmlFor="acc-open">Opening balance</Label><Input id="acc-open" inputMode="decimal" value={opening} onChange={(e) => setOpening(e.target.value)} /></div>
          <div className="space-y-1.5"><Label htmlFor="acc-month">Opening month</Label><MonthField id="acc-month" label="Opening month" value={openingMonth} onChange={setOpeningMonth} locale={locale} /></div>
          <div className="space-y-1.5 sm:col-span-2"><Label htmlFor="acc-owner">Owner</Label><NativeSelect id="acc-owner" className="w-full" value={owner} onChange={(e) => setOwner(e.target.value)}><option value="">Household / joint</option>{adults.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}{children.map((c) => <option key={c.id} value={c.id}>{c.name} · child</option>)}</NativeSelect></div>
          {trackable && (
            <div className="flex items-center gap-1 sm:col-span-2">
              <Check label="Track the balance month by month in the grid" checked={tracked} onChange={(e) => setTracked(e.target.checked)} />
              <InfoTip help="household.tracked" />
            </div>
          )}
          {type === 'credit-card' && (
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="acc-card">How you record card spending</Label>
              <NativeSelect id="acc-card" className="w-full" value={cardMode} onChange={(e) => setCardMode(e.target.value as typeof cardMode)}>
                <option value="itemized">Purchases are expense rows paid from this card; the card payment is a transfer</option>
                <option value="lump">Only the card payment is recorded, as an expense</option>
              </NativeSelect>
              <p className="text-xs text-muted-foreground">{cardMode === 'itemized' ? 'What is owed grows with rows that name this card as their account and shrinks with the payment row. The payment itself is not counted as spending, since the purchases already were.' : 'What is owed only comes from the real balances you enter. The payment counts as this month\'s spending.'} Opening balance is what you owed at the start.</p>
            </div>
          )}
          {(type === 'loan' || type === 'other-asset') && (
            <p className="text-xs text-muted-foreground sm:col-span-2">{type === 'loan' ? 'Opening balance is the amount still owed. Rows of kind "debt payment" that name this account bring it down.' : 'Opening balance is its value. Enter a real value from the grid whenever it changes.'}</p>
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
              {ccy !== baseCurrency && ccy.length === 3 && (
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
        {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
        <DialogFooter className="flex-row flex-wrap gap-2 sm:justify-between">
          <div>{account && onRemove && <Button variant="ghost" size="sm" onClick={onRemove}>Archive or delete…</Button>}</div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            <Button disabled={!name.trim() || currency.length !== 3} onClick={save}>Save</Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
