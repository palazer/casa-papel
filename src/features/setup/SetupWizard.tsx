import { useMemo, useState } from 'react'
import { Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Check } from '@/components/Check'
import { NativeSelect } from '@/features/grid/NativeSelect'
import { parseAmount } from '@/app/format'
import { useStore } from '@/app/store'
import {
  ENTITY_KIND_LABEL, ENTITY_TEMPLATES, HOUSEHOLD_TEMPLATES, monthOfDate, templateTitle,
  type AccountType, type EntityKind, type Household,
} from '@/model'
import { createHouseholdFromSetup, type SetupInput } from '@/store'

const CURRENCIES = ['EUR', 'USD', 'GBP', 'TRY', 'CHF', 'SEK', 'NOK', 'DKK', 'PLN', 'CZK', 'JPY', 'CAD', 'AUD']
const LOCALES = ['en-IE', 'en-GB', 'en-US', 'de-DE', 'de-AT', 'tr-TR', 'fr-FR', 'es-ES', 'nl-NL', 'it-IT', 'pt-PT', 'sv-SE']
const DEPENDENT_KINDS: Array<Exclude<EntityKind, 'adult'>> = ['child', 'pet', 'vehicle', 'property', 'company', 'other']
const ACCOUNT_TYPES: Array<{ value: AccountType; label: string }> = [
  { value: 'checking', label: 'Current account' }, { value: 'joint', label: 'Joint account' }, { value: 'savings', label: 'Savings' },
  { value: 'investment', label: 'Investments' }, { value: 'credit-card', label: 'Credit card' }, { value: 'loan', label: 'Loan' }, { value: 'cash', label: 'Cash' },
]
const STEPS = ['Basics', 'People', 'Things', 'Accounts', 'Rows', 'Finish']

interface Draft {
  name: string
  currency: string
  locale: string
  startMonth: string
  closingRule: Household['closingRule']
  moneyMode: Household['moneyMode']
  pocketTotal: string
  adults: Array<{ name: string }>
  dependents: Array<{ kind: Exclude<EntityKind, 'adult'>; name: string; paidByIndex: number | null }>
  accounts: Array<{ name: string; type: AccountType; openingBalance: string }>
  householdTemplates: Set<string>
  entityTemplates: Record<number, Set<string>>
}

const recommended = (kind: EntityKind | 'household') =>
  new Set((kind === 'household' ? HOUSEHOLD_TEMPLATES : ENTITY_TEMPLATES[kind]).filter((t) => t.recommended).map((t) => t.key))

export function SetupWizard({ onCreated }: { onCreated: () => void }) {
  const store = useStore()
  const [step, setStep] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [d, setD] = useState<Draft>(() => ({
    name: '', currency: 'EUR', locale: LOCALES.includes(navigator.language) ? navigator.language : 'en-IE', startMonth: monthOfDate(),
    closingRule: 'savings-plug', moneyMode: 'pooled', pocketTotal: '',
    adults: [{ name: '' }, { name: '' }], dependents: [],
    accounts: [{ name: 'Main account', type: 'checking', openingBalance: '' }, { name: 'Savings', type: 'savings', openingBalance: '' }],
    householdTemplates: recommended('household'), entityTemplates: { 0: recommended('adult'), 1: recommended('adult') },
  }))
  const patch = (p: Partial<Draft>) => setD((prev) => ({ ...prev, ...p }))

  const entities = useMemo(() => [...d.adults.map((a) => ({ kind: 'adult' as EntityKind, name: a.name })), ...d.dependents.map((x) => ({ kind: x.kind as EntityKind, name: x.name }))], [d.adults, d.dependents])

  function setEntityTemplates(index: number, kind: EntityKind, mutate: (s: Set<string>) => void) {
    setD((prev) => {
      const next = { ...prev.entityTemplates }
      const s = new Set(next[index] ?? recommended(kind))
      mutate(s)
      next[index] = s
      return { ...prev, entityTemplates: next }
    })
  }

  async function finish() {
    setBusy(true)
    setError(null)
    try {
      const pocket = d.pocketTotal.trim() ? parseAmount(d.pocketTotal, d.currency, d.locale) ?? 0 : 0
      const input: SetupInput = {
        household: { name: d.name.trim() || 'Our household', baseCurrency: d.currency, locale: d.locale, startMonth: d.startMonth, closingRule: d.closingRule, moneyMode: d.moneyMode, pocketTotal: pocket },
        adults: d.adults.filter((a) => a.name.trim()).length ? d.adults.filter((a) => a.name.trim()) : [{ name: 'Me' }],
        dependents: d.dependents.filter((x) => x.name.trim()),
        accounts: d.accounts.filter((a) => a.name.trim()).map((a) => ({ name: a.name.trim(), type: a.type, openingBalance: a.openingBalance.trim() ? parseAmount(a.openingBalance, d.currency, d.locale) ?? 0 : 0 })),
        householdTemplates: [...d.householdTemplates],
        entityTemplates: Object.fromEntries(entities.map((e, i) => [i, [...(d.entityTemplates[i] ?? recommended(e.kind))]])),
      }
      // indexes shift when blank adults are dropped; rebuild dependents' paidBy on the filtered list
      const keptAdults = d.adults.map((a, i) => (a.name.trim() ? i : -1)).filter((i) => i >= 0)
      input.dependents = d.dependents.filter((x) => x.name.trim()).map((x) => ({ ...x, paidByIndex: x.paidByIndex == null ? null : Math.max(0, keptAdults.indexOf(x.paidByIndex)) }))
      await createHouseholdFromSetup(store, input)
      onCreated()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create the household')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card className="mx-auto max-w-2xl">
      <CardHeader>
        <CardTitle>Set up your household</CardTitle>
        <CardDescription>
          Step {step + 1} of {STEPS.length}: {STEPS[step]}. Everything can be changed later. "Finish now" uses sensible defaults for the rest.
        </CardDescription>
        <ol className="mt-2 flex flex-wrap gap-1 text-xs" aria-label="Steps">
          {STEPS.map((s, i) => (
            <li key={s} className={i === step ? 'rounded bg-foreground px-2 py-0.5 text-background' : 'rounded bg-muted px-2 py-0.5 text-muted-foreground'}>{s}</li>
          ))}
        </ol>
      </CardHeader>
      <CardContent className="space-y-5">
        {step === 0 && (
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="w-name">Household name</Label>
              <Input id="w-name" autoFocus value={d.name} onChange={(e) => patch({ name: e.target.value })} placeholder="Our household" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="w-ccy">Currency</Label>
              <NativeSelect id="w-ccy" className="w-full" value={d.currency} onChange={(e) => patch({ currency: e.target.value })}>{CURRENCIES.map((c) => <option key={c}>{c}</option>)}</NativeSelect>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="w-locale">Number format</Label>
              <NativeSelect id="w-locale" className="w-full" value={d.locale} onChange={(e) => patch({ locale: e.target.value })}>{LOCALES.map((l) => <option key={l}>{l}</option>)}</NativeSelect>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="w-start">First month</Label>
              <Input id="w-start" type="month" value={d.startMonth} onChange={(e) => patch({ startMonth: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="w-rule">Month-end rule</Label>
              <NativeSelect id="w-rule" className="w-full" value={d.closingRule} onChange={(e) => patch({ closingRule: e.target.value as Household['closingRule'] })}>
                <option value="savings-plug">Whatever is left goes to savings</option>
                <option value="leftover-plug">I decide savings, show me what is left</option>
              </NativeSelect>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="w-mode">How you share money</Label>
              <NativeSelect id="w-mode" className="w-full" value={d.moneyMode} onChange={(e) => patch({ moneyMode: e.target.value as Household['moneyMode'] })}>
                <option value="pooled">Pooled: all income is household money, adults get pocket money</option>
                <option value="proportional">Proportional: each adult contributes in proportion to income</option>
              </NativeSelect>
            </div>
            {d.moneyMode === 'pooled' && (
              <div className="space-y-1.5">
                <Label htmlFor="w-pocket">Pocket money per month, all adults together ({d.currency})</Label>
                <Input id="w-pocket" inputMode="decimal" value={d.pocketTotal} onChange={(e) => patch({ pocketTotal: e.target.value })} placeholder="e.g. 1000" />
              </div>
            )}
          </div>
        )}

        {step === 1 && (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Adults</Label>
              {d.adults.map((a, i) => (
                <div key={i} className="flex items-center gap-2">
                  <Input aria-label={`Adult ${i + 1} name`} value={a.name} placeholder={`Adult ${i + 1}`} onChange={(e) => patch({ adults: d.adults.map((x, j) => (j === i ? { name: e.target.value } : x)) })} />
                  <Button size="icon" variant="ghost" aria-label="Remove adult" disabled={d.adults.length === 1} onClick={() => patch({ adults: d.adults.filter((_, j) => j !== i) })}><Trash2 /></Button>
                </div>
              ))}
              <Button size="sm" variant="outline" onClick={() => patch({ adults: [...d.adults, { name: '' }] })}>Add adult</Button>
            </div>
            <div className="space-y-2">
              <Label>Children</Label>
              {d.dependents.map((x, i) => x.kind === 'child' && (
                <div key={i} className="flex flex-wrap items-center gap-2">
                  <Input aria-label="Child name" className="w-44" value={x.name} placeholder="Name" onChange={(e) => patch({ dependents: d.dependents.map((y, j) => (j === i ? { ...y, name: e.target.value } : y)) })} />
                  <NativeSelect aria-label="Paid by" value={x.paidByIndex ?? ''} onChange={(e) => patch({ dependents: d.dependents.map((y, j) => (j === i ? { ...y, paidByIndex: e.target.value === '' ? null : Number(e.target.value) } : y)) })}>
                    <option value="">Costs are shared</option>
                    {d.adults.map((a, ai) => <option key={ai} value={ai}>Paid by {a.name || `Adult ${ai + 1}`}</option>)}
                  </NativeSelect>
                  <Button size="icon" variant="ghost" aria-label="Remove child" onClick={() => patch({ dependents: d.dependents.filter((_, j) => j !== i) })}><Trash2 /></Button>
                </div>
              ))}
              <Button size="sm" variant="outline" onClick={() => patch({ dependents: [...d.dependents, { kind: 'child', name: '', paidByIndex: null }] })}>Add child</Button>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">Pets, vehicles, your home, a company. Each one brings suggested rows in the next step.</p>
            {d.dependents.map((x, i) => x.kind !== 'child' && (
              <div key={i} className="flex flex-wrap items-center gap-2">
                <NativeSelect aria-label="Kind" value={x.kind} onChange={(e) => patch({ dependents: d.dependents.map((y, j) => (j === i ? { ...y, kind: e.target.value as Draft['dependents'][number]['kind'] } : y)) })}>
                  {DEPENDENT_KINDS.filter((k) => k !== 'child').map((k) => <option key={k} value={k}>{ENTITY_KIND_LABEL[k]}</option>)}
                </NativeSelect>
                <Input aria-label="Name" className="w-44" value={x.name} placeholder="Name" onChange={(e) => patch({ dependents: d.dependents.map((y, j) => (j === i ? { ...y, name: e.target.value } : y)) })} />
                <Button size="icon" variant="ghost" aria-label="Remove" onClick={() => patch({ dependents: d.dependents.filter((_, j) => j !== i) })}><Trash2 /></Button>
              </div>
            ))}
            <div className="flex flex-wrap gap-2">
              {(['pet', 'vehicle', 'property', 'company'] as const).map((k) => (
                <Button key={k} size="sm" variant="outline" onClick={() => patch({ dependents: [...d.dependents, { kind: k, name: '', paidByIndex: null }] })}>Add {ENTITY_KIND_LABEL[k].toLowerCase()}</Button>
              ))}
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">Savings, investments, cards and loans get a running balance. Opening balance is the balance at the start of your first month.</p>
            {d.accounts.map((a, i) => (
              <div key={i} className="grid grid-cols-[1fr_auto] gap-2 sm:grid-cols-[1fr_11rem_9rem_auto]">
                <Input aria-label={`Account ${i + 1} name`} value={a.name} placeholder="Name" onChange={(e) => patch({ accounts: d.accounts.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })} />
                <NativeSelect aria-label="Account type" value={a.type} onChange={(e) => patch({ accounts: d.accounts.map((x, j) => (j === i ? { ...x, type: e.target.value as AccountType } : x)) })}>
                  {ACCOUNT_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                </NativeSelect>
                <Input aria-label="Opening balance" inputMode="decimal" value={a.openingBalance} placeholder={`Opening ${d.currency}`} onChange={(e) => patch({ accounts: d.accounts.map((x, j) => (j === i ? { ...x, openingBalance: e.target.value } : x)) })} />
                <Button size="icon" variant="ghost" aria-label="Remove account" onClick={() => patch({ accounts: d.accounts.filter((_, j) => j !== i) })}><Trash2 /></Button>
              </div>
            ))}
            <Button size="sm" variant="outline" onClick={() => patch({ accounts: [...d.accounts, { name: '', type: 'checking', openingBalance: '' }] })}>Add account</Button>
          </div>
        )}

        {step === 4 && (
          <div className="space-y-4">
            <fieldset className="space-y-1.5">
              <legend className="text-sm font-medium">Household</legend>
              {HOUSEHOLD_TEMPLATES.map((t) => (
                <Check key={t.key} label={templateTitle(t) + (t.pool ? ' (pool)' : '')} checked={d.householdTemplates.has(t.key)} onChange={(e) => { const s = new Set(d.householdTemplates); if (e.target.checked) s.add(t.key); else s.delete(t.key); patch({ householdTemplates: s }) }} />
              ))}
            </fieldset>
            {entities.map((e, i) => (
              <fieldset key={i} className="space-y-1.5">
                <legend className="text-sm font-medium">{e.name || `${ENTITY_KIND_LABEL[e.kind]} ${i + 1}`} <span className="text-muted-foreground">({ENTITY_KIND_LABEL[e.kind]})</span></legend>
                {ENTITY_TEMPLATES[e.kind].filter((t) => !(t.pocket && d.moneyMode !== 'pooled')).map((t) => (
                  <Check key={t.key} label={templateTitle(t, e.name || ENTITY_KIND_LABEL[e.kind])} checked={(d.entityTemplates[i] ?? recommended(e.kind)).has(t.key)} onChange={(ev) => setEntityTemplates(i, e.kind, (s) => (ev.target.checked ? s.add(t.key) : s.delete(t.key)))} />
                ))}
              </fieldset>
            ))}
          </div>
        )}

        {step === 5 && (
          <div className="space-y-2 text-sm">
            <p><strong>{d.name.trim() || 'Our household'}</strong> · {d.currency} · {d.locale} · from {d.startMonth}</p>
            <p>{d.adults.filter((a) => a.name.trim()).length || 1} adult(s), {d.dependents.filter((x) => x.name.trim()).length} other member(s) or thing(s), {d.accounts.filter((a) => a.name.trim()).length} account(s).</p>
            <p>{d.householdTemplates.size + entities.reduce((n, e, i) => n + (d.entityTemplates[i] ?? recommended(e.kind)).size, 0)} rows will be created. Add recurring payments from the Register afterwards.</p>
          </div>
        )}

        {error && <p className="text-sm text-destructive">{error}</p>}

        <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-4">
          <Button variant="ghost" disabled={step === 0 || busy} onClick={() => setStep(step - 1)}>Back</Button>
          <div className="flex gap-2">
            {step < STEPS.length - 1 && <Button variant="outline" disabled={busy} onClick={() => void finish()}>Finish now</Button>}
            {step < STEPS.length - 1 ? (
              <Button disabled={busy} onClick={() => setStep(step + 1)}>Next</Button>
            ) : (
              <Button disabled={busy} onClick={() => void finish()}>Create household</Button>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
