import { MonthField } from '@/components/MonthField'
import { RecurringList } from '@/features/recurring/RecurringList'
import { useMemo, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Check } from '@/components/Check'
import { NativeSelect } from '@/features/grid/NativeSelect'
import { localeExample, localeLabel, amountToInput, formatAmount, formatMonth, parseAmount } from '@/app/format'
import { useStore } from '@/app/store'
import { activeHousehold, defaultMonths, useEngine, useTables } from '@/app/useEngine'
import {
  ENTITY_KIND_LABEL, ENTITY_TEMPLATES, monthOfDate, templateTitle,
  ACCOUNT_TYPE_INFO, type Account, type AccountType, type Entity, type EntityKind, type Household,
} from '@/model'
import { addAccount, addEntity, applyTemplates, setAccountActual, updateAccount, updateEntity, updateHousehold } from '@/store'

const LOCALES = ['en-IE', 'en-GB', 'en-US', 'de-DE', 'de-AT', 'tr-TR', 'fr-FR', 'es-ES', 'nl-NL', 'it-IT', 'pt-PT', 'sv-SE']
const ACCOUNT_TYPES = ACCOUNT_TYPE_INFO
const KINDS: EntityKind[] = ['adult', 'child', 'pet', 'vehicle', 'property', 'company', 'other']

export function HouseholdScreen() {
  const store = useStore()
  const tables = useTables()
  const household = activeHousehold(tables)
  const months = useMemo(() => (household && tables ? defaultMonths(household, tables) : []), [household, tables])
  const engine = useEngine(tables, months)
  const [error, setError] = useState<string | null>(null)
  if (!tables || !household || !engine) return null
  const act = (fn: () => Promise<unknown>) => void fn().catch((e) => setError(e instanceof Error ? e.message : 'Action failed'))

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      {error && <p className="text-sm text-destructive">{error}</p>}
      <SettingsCard household={household} onSave={(p) => act(() => updateHousehold(store, p))} />
      <EntitiesCard household={household} entities={tables.entities.filter((e) => !e.deletedAt && !e.archivedMonth)} onError={setError} />
      <AccountsCard household={household} accounts={tables.accounts.filter((a) => !a.deletedAt)} entities={tables.entities} engine={engine} months={months} onError={setError} />
      <Card>
        <CardHeader>
          <CardTitle>Recurring payments and incomes</CardTitle>
          <CardDescription>Rent, salary, insurance, subscriptions: anything on a schedule. They land in the grid by themselves and show up in Moves when due.</CardDescription>
        </CardHeader>
        <CardContent><RecurringList /></CardContent>
      </Card>
    </div>
  )
}

function SettingsCard({ household: h, onSave }: { household: Household; onSave: (p: Partial<Household>) => void }) {
  const [name, setName] = useState(h.name)
  const [pocket, setPocket] = useState(amountToInput(h.pocketTotal, h.baseCurrency, h.locale))
  const [buffer, setBuffer] = useState(amountToInput(h.cashBuffer, h.baseCurrency, h.locale))
  const money = (s: string) => (s.trim() ? parseAmount(s, h.baseCurrency, h.locale) ?? 0 : 0)
  return (
    <Card>
      <CardHeader>
        <CardTitle>Settings</CardTitle>
        <CardDescription>Changes apply to open months. Closed months keep the values they were closed with.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="s-name">Household name</Label>
          <Input id="s-name" value={name} onChange={(e) => setName(e.target.value)} onBlur={() => name.trim() && name !== h.name && onSave({ name: name.trim() })} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="s-locale">Number format</Label>
          <NativeSelect id="s-locale" className="w-full" value={h.locale} onChange={(e) => onSave({ locale: e.target.value })}>{LOCALES.map((l) => <option key={l} value={l}>{localeLabel(l)} — {localeExample(l)}</option>)}</NativeSelect>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="s-rule">Month-end rule</Label>
          <NativeSelect id="s-rule" className="w-full" value={h.closingRule} onChange={(e) => onSave({ closingRule: e.target.value as Household['closingRule'] })}>
            <option value="savings-plug">Whatever is left goes to savings</option>
            <option value="leftover-plug">I decide savings, show me what is left</option>
          </NativeSelect>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="s-mode">How you share money</Label>
          <NativeSelect id="s-mode" className="w-full" value={h.moneyMode} onChange={(e) => onSave({ moneyMode: e.target.value as Household['moneyMode'] })}>
            <option value="pooled">Pooled with pocket money</option>
            <option value="proportional">Proportional contributions (split view arrives in a later wave)</option>
          </NativeSelect>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="s-pocket">Pocket money per month, all adults ({h.baseCurrency})</Label>
          <Input id="s-pocket" inputMode="decimal" value={pocket} onChange={(e) => setPocket(e.target.value)} onBlur={() => onSave({ pocketTotal: money(pocket) })} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="s-buffer">Cash kept in the account at month end ({h.baseCurrency})</Label>
          <Input id="s-buffer" inputMode="decimal" value={buffer} onChange={(e) => setBuffer(e.target.value)} onBlur={() => onSave({ cashBuffer: money(buffer) })} />
        </div>
        <div className="sm:col-span-2">
          <Check label="Show expenses as negative red numbers" checked={h.displayExpensesNegative} onChange={(e) => onSave({ displayExpensesNegative: e.target.checked })} />
        </div>
        <p className="text-xs text-muted-foreground sm:col-span-2">Base currency {h.baseCurrency} · first month {formatMonth(h.startMonth, h.locale)}. These cannot be changed after setup.</p>
      </CardContent>
    </Card>
  )
}

function EntitiesCard({ household, entities, onError }: { household: Household; entities: Entity[]; onError: (m: string) => void }) {
  const store = useStore()
  const [kind, setKind] = useState<EntityKind>('adult')
  const [name, setName] = useState('')
  const [templatesFor, setTemplatesFor] = useState<Entity | null>(null)
  const adults = entities.filter((e) => e.kind === 'adult')
  const act = (fn: () => Promise<unknown>) => void fn().catch((e) => onError(e instanceof Error ? e.message : 'Action failed'))

  return (
    <Card>
      <CardHeader>
        <CardTitle>People and things</CardTitle>
        <CardDescription>Who and what the household pays for. Each one can bring suggested rows.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <ul className="divide-y rounded-md border">
          {entities.map((e) => (
            <li key={e.id} className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
              <Badge variant="outline">{ENTITY_KIND_LABEL[e.kind]}</Badge>
              <span className="font-medium">{e.name}</span>
              {e.kind !== 'adult' && (
                <NativeSelect aria-label={`Who pays for ${e.name}`} className="h-7 text-xs" value={e.paidBy ?? ''} onChange={(ev) => act(() => updateEntity(store, e.id, { paidBy: ev.target.value || null }))}>
                  <option value="">Costs shared</option>
                  {adults.map((a) => <option key={a.id} value={a.id}>Paid by {a.name}</option>)}
                </NativeSelect>
              )}
              <span className="ml-auto flex gap-1">
                <Button size="xs" variant="outline" onClick={() => setTemplatesFor(e)}>Suggested rows…</Button>
                <Button size="xs" variant="ghost" onClick={() => act(() => updateEntity(store, e.id, { archivedMonth: monthOfDate() }))}>Archive</Button>
              </span>
            </li>
          ))}
          {entities.length === 0 && <li className="px-3 py-2 text-sm text-muted-foreground">Nobody yet.</li>}
        </ul>
        <div className="flex flex-wrap items-end gap-2">
          <div className="space-y-1">
            <Label htmlFor="e-kind">Kind</Label>
            <NativeSelect id="e-kind" value={kind} onChange={(e) => setKind(e.target.value as EntityKind)}>{KINDS.map((k) => <option key={k} value={k}>{ENTITY_KIND_LABEL[k]}</option>)}</NativeSelect>
          </div>
          <div className="space-y-1">
            <Label htmlFor="e-name">Name</Label>
            <Input id="e-name" className="w-44" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && name.trim()) { act(() => addEntity(store, { kind, name: name.trim() })); setName('') } }} />
          </div>
          <Button disabled={!name.trim()} onClick={() => { act(() => addEntity(store, { kind, name: name.trim() })); setName('') }}>Add</Button>
        </div>
        {templatesFor && <TemplatesDialog household={household} entity={templatesFor} onClose={() => setTemplatesFor(null)} onError={onError} />}
      </CardContent>
    </Card>
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

function AccountsCard({ household, accounts, entities, engine, months, onError }: { household: Household; accounts: Account[]; entities: Entity[]; engine: ReturnType<typeof useEngine>; months: string[]; onError: (m: string) => void }) {
  const store = useStore()
  const [editing, setEditing] = useState<Account | 'new' | null>(null)
  const [actualsFor, setActualsFor] = useState<string | null>(null)
  const { locale, baseCurrency } = household
  return (
    <Card>
      <CardHeader>
        <CardTitle>Accounts</CardTitle>
        <CardDescription>Savings accounts get a running balance from your grid. Enter the real balance any month to keep it honest.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <ul className="divide-y rounded-md border">
          {accounts.map((a) => (
            <li key={a.id} className="px-3 py-2 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline">{ACCOUNT_TYPES.find((t) => t.value === a.type)?.label ?? a.type}</Badge>
                <span className="font-medium">{a.name}</span>
                <span className="text-muted-foreground">{a.currency}{a.ownerEntityId ? ` · ${entities.find((e) => e.id === a.ownerEntityId)?.name ?? ''}` : ''} · opening {formatAmount(a.openingBalance, a.currency, locale)} in {formatMonth(a.openingMonth, locale)}</span>
                <span className="ml-auto flex gap-1">
                  {a.type === 'savings' && a.tracked && <Button size="xs" variant="outline" onClick={() => setActualsFor(actualsFor === a.id ? null : a.id)}>Real balances</Button>}
                  <Button size="xs" variant="ghost" onClick={() => setEditing(a)}>Edit</Button>
                </span>
              </div>
              {actualsFor === a.id && engine && (
                <table className="mt-2 w-full text-xs">
                  <thead><tr className="text-muted-foreground"><th className="py-1 text-left font-normal">Month</th><th className="text-right font-normal">Computed</th><th className="text-right font-normal">Real balance</th></tr></thead>
                  <tbody>
                    {months.filter((m) => m <= monthOfDate()).slice(-12).map((m) => {
                      const r = engine.accounts[a.id]?.months[m]
                      return (
                        <tr key={m}>
                          <td className="py-0.5">{formatMonth(m, locale)}</td>
                          <td className="text-right tabular-nums">{r ? formatAmount(r.computed, a.currency, locale) : ''}</td>
                          <td className="text-right">
                            <Input
                              aria-label={`Real balance ${formatMonth(m, locale)}`} className="ml-auto h-7 w-36 text-right" inputMode="decimal"
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
        <Button variant="outline" size="sm" onClick={() => setEditing('new')}>Add account</Button>
        {editing && <AccountDialog account={editing === 'new' ? null : editing} entities={entities} baseCurrency={baseCurrency} locale={locale} startMonth={household.startMonth} onClose={() => setEditing(null)} onError={onError} />}
      </CardContent>
    </Card>
  )
}

function AccountDialog({ account, entities, baseCurrency, locale, startMonth, onClose, onError }: { account: Account | null; entities: Entity[]; baseCurrency: string; locale: string; startMonth: string; onClose: () => void; onError: (m: string) => void }) {
  const store = useStore()
  const [name, setName] = useState(account?.name ?? '')
  const [type, setType] = useState<AccountType>(account?.type ?? 'checking')
  const [currency, setCurrency] = useState(account?.currency ?? baseCurrency)
  const [opening, setOpening] = useState(account ? amountToInput(account.openingBalance, account.currency, locale) : '')
  const [openingMonth, setOpeningMonth] = useState(account?.openingMonth ?? startMonth)
  const [owner, setOwner] = useState(account?.ownerEntityId ?? '')
  const adults = entities.filter((e) => e.kind === 'adult' && !e.deletedAt)
  function save() {
    const openingBalance = opening.trim() ? parseAmount(opening, currency, locale) ?? 0 : 0
    const patch = { name: name.trim(), type, currency: currency.toUpperCase(), openingBalance, openingMonth, ownerEntityId: owner || null }
    const p = account ? updateAccount(store, account.id, patch) : addAccount(store, patch)
    p.then(onClose).catch((e) => onError(e instanceof Error ? e.message : 'Failed'))
  }
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="sm:max-w-md" aria-describedby={undefined}>
        <DialogHeader><DialogTitle>{account ? 'Edit account' : 'New account'}</DialogTitle></DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5 sm:col-span-2"><Label htmlFor="acc-name">Name</Label><Input id="acc-name" autoFocus value={name} onChange={(e) => setName(e.target.value)} /></div>
          <div className="space-y-1.5"><Label htmlFor="acc-type">Type</Label><NativeSelect id="acc-type" className="w-full" value={type} onChange={(e) => setType(e.target.value as AccountType)}>{ACCOUNT_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}</NativeSelect></div>
          <p className="text-xs text-muted-foreground sm:col-span-2">{ACCOUNT_TYPES.find((t) => t.value === type)?.help}</p>
          <div className="space-y-1.5"><Label htmlFor="acc-ccy">Currency</Label><Input id="acc-ccy" value={currency} maxLength={3} onChange={(e) => setCurrency(e.target.value.toUpperCase())} /></div>
          <div className="space-y-1.5"><Label htmlFor="acc-open">Opening balance</Label><Input id="acc-open" inputMode="decimal" value={opening} onChange={(e) => setOpening(e.target.value)} /></div>
          <div className="space-y-1.5"><Label htmlFor="acc-month">Opening month</Label><MonthField id="acc-month" label="Opening month" value={openingMonth} onChange={setOpeningMonth} locale={locale} /></div>
          <div className="space-y-1.5 sm:col-span-2"><Label htmlFor="acc-owner">Owner</Label><NativeSelect id="acc-owner" className="w-full" value={owner} onChange={(e) => setOwner(e.target.value)}><option value="">Household / joint</option>{adults.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</NativeSelect></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button disabled={!name.trim() || currency.length !== 3} onClick={save}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
