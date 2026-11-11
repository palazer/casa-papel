import { GroupTabs } from '@/components/GroupTabs'
import { PageHeader } from '@/components/PageHeader'
import { RecurringList } from '@/features/recurring/RecurringList'
import { FxCard } from './FxCard'
import { SharesCard } from './SharesCard'
import { HUES } from '@/app/hues'
import { InfoTip, TipLabel } from '@/components/InfoTip'
import { PoolsCard } from './PoolsCard'
import { HouseholdAccountDialog } from './HouseholdAccountDialog'
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
  ACCOUNT_TYPE_INFO, ENTITY_KIND_HELP, type Account, type Entity, type EntityKind, type Household, type Tables,
} from '@/model'
import { addEntity, applyTemplates, restoreAccount, restoreEntity, setAccountActual, setMonthlyDefault, updateEntity, updateHousehold, type MonthlyDefaultScope } from '@/store'

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
      <SettingsCard household={household} tables={tables} onSave={(p) => act(() => updateHousehold(store, p))} onBuffer={(value, scope) => act(() => setMonthlyDefault(store, value, scope, monthOfDate()))} />
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

function SettingsCard({ household: h, tables, onSave, onBuffer }: { household: Household; tables: Tables; onSave: (p: Partial<Household>) => void; onBuffer: (value: number, scope: MonthlyDefaultScope) => void }) {
  const thisMonth = monthOfDate()
  const state = tables.monthStates.find((s) => s.month === thisMonth)
  /** The cash buffer this month: its own value when the month has one, else the household's. */
  const bufferNow = state?.cashBufferOverride ?? h.cashBuffer
  const [name, setName] = useState(h.name)
  const [scope, setScope] = useState<MonthlyDefaultScope>('from-now-on')
  const [buffer, setBuffer] = useState(amountToInput(bufferNow, h.baseCurrency, h.locale))
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
          <TipLabel htmlFor="s-mode" help="household.moneyMode">How you share money</TipLabel>
          <NativeSelect id="s-mode" className="w-full" value={h.moneyMode} onChange={(e) => onSave({ moneyMode: e.target.value as Household['moneyMode'] })}>
            <option value="pooled">Pooled, with pocket money</option>
            <option value="proportional">In proportion to income</option>
          </NativeSelect>
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <TipLabel htmlFor="s-scope" help="household.bufferScope">Cash buffer changes apply to</TipLabel>
          <NativeSelect id="s-scope" className="w-full" value={scope} onChange={(e) => setScope(e.target.value as MonthlyDefaultScope)}>
            <option value="from-now-on">This month and onwards (earlier months keep what they show)</option>
            <option value="this-month">Only this month</option>
            <option value="all-open">Every open month</option>
          </NativeSelect>
          <p className="text-muted-foreground">Closed months are never changed. "This month" is {formatMonth(thisMonth, h.locale)}.</p>
        </div>
        <div className="space-y-1.5">
          <TipLabel htmlFor="s-buffer" help="household.buffer">Cash kept in the account at month end ({h.baseCurrency})</TipLabel>
          <Input id="s-buffer" inputMode="decimal" value={buffer} onChange={(e) => setBuffer(e.target.value)} onBlur={() => { const v = money(buffer); if (v !== bufferNow) onBuffer(v, scope) }} />
          {bufferNow !== h.cashBuffer && <p className="text-muted-foreground">This month {formatAmount(bufferNow, h.baseCurrency, h.locale)} · default {formatAmount(h.cashBuffer, h.baseCurrency, h.locale)}</p>}
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
        {templatesFor && <TemplatesDialog entity={templatesFor} onClose={() => setTemplatesFor(null)} onError={onError} />}
        {removing && <RemoveDialog target={{ kind: 'entity', id: removing.id }} tables={tables} household={household} onClose={() => setRemoving(null)} />}
      </div>
    </Island>
  )
}

function TemplatesDialog({ entity, onClose, onError }: { entity: Entity; onClose: () => void; onError: (m: string) => void }) {
  const store = useStore()
  const all = ENTITY_TEMPLATES[entity.kind]
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
          <HouseholdAccountDialog
            account={editing === 'new' ? null : editing} entities={entities} baseCurrency={baseCurrency} locale={locale} startMonth={household.startMonth}
            onClose={() => setEditing(null)} onRemove={editing !== 'new' ? () => { setRemoving(editing); setEditing(null) } : undefined}
          />
        )}
        {removing && <RemoveDialog target={{ kind: 'account', id: removing.id }} tables={tables} household={household} onClose={() => setRemoving(null)} />}
      </div>
    </Island>
  )
}
