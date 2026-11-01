import { useMemo, useState } from 'react'
import { Trash2 } from 'lucide-react'
import { ZodError } from 'zod'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Check } from '@/components/Check'
import { MonthField } from '@/components/MonthField'
import { NativeSelect } from '@/features/grid/NativeSelect'
import { decimalSeparator, formatMonth, localeExample, localeLabel, parseAmount } from '@/app/format'
import { useStore } from '@/app/store'
import { cn } from '@/lib/utils'
import {
  ACCOUNT_TYPE_INFO, ENTITY_KIND_HELP, ENTITY_KIND_LABEL, ENTITY_TEMPLATES, HOUSEHOLD_TEMPLATES, SECTION_INFO, monthOfDate, templateTitle,
  type AccountType, type EntityKind, type Household, type RowTemplate, type Section,
} from '@/model'
import { addRow, createHouseholdFromSetup, type SetupInput } from '@/store'

const CURRENCIES = ['EUR', 'USD', 'GBP', 'TRY', 'CHF', 'SEK', 'NOK', 'DKK', 'PLN', 'CZK', 'JPY', 'CAD', 'AUD']
const LOCALES = ['en-IE', 'en-GB', 'en-US', 'de-DE', 'de-AT', 'tr-TR', 'fr-FR', 'es-ES', 'nl-NL', 'it-IT', 'pt-PT', 'sv-SE']
const DEPENDENT_KINDS: Array<Exclude<EntityKind, 'adult'>> = ['child', 'pet', 'vehicle', 'property', 'company', 'other']
const WIZARD_ACCOUNT_TYPES = ACCOUNT_TYPE_INFO.filter((t) => t.value !== 'other-asset')
const STEPS = ['Basics', 'People', 'Things', 'Accounts', 'Rows', 'Finish']
const SECTIONS: Section[] = ['income', 'expense', 'transfer']
const SECTION_DOT: Record<Section, string> = { income: 'bg-emerald-500', expense: 'bg-rose-500', transfer: 'bg-sky-500' }
const RULE_HELP: Record<Household['closingRule'], string> = {
  'savings-plug': 'Income minus spending minus pocket money is moved to savings. You never type "To savings".',
  'leftover-plug': 'You type how much goes to savings. What remains is shown as leftover.',
}
const MODE_HELP: Record<Household['moneyMode'], string> = {
  pooled: 'All income is household money. Each adult gets pocket money to spend freely.',
  proportional: 'Each adult pays a share of the shared costs in proportion to their income. Coming in a later wave; pooled is used for now.',
}

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
  /** subject 0 = household, i + 1 = entity i */
  customRows: Array<{ subject: number; name: string; section: Section }>
}

interface Errors { pocketTotal?: string; accounts: Record<number, string> }

const recommended = (kind: EntityKind | 'household') =>
  new Set((kind === 'household' ? HOUSEHOLD_TEMPLATES : ENTITY_TEMPLATES[kind]).filter((t) => t.recommended).map((t) => t.key))

function validate(d: Draft): Errors {
  const errors: Errors = { accounts: {} }
  const hint = `Digits only, "${decimalSeparator(d.locale)}" for decimals, like ${new Intl.NumberFormat(d.locale).format(1234.5)}.`
  if (d.pocketTotal.trim() && parseAmount(d.pocketTotal, d.currency, d.locale) == null) errors.pocketTotal = `Not a number. ${hint}`
  d.accounts.forEach((a, i) => {
    if (a.openingBalance.trim() && parseAmount(a.openingBalance, d.currency, d.locale) == null) errors.accounts[i] = `Not a number. ${hint}`
  })
  return errors
}

export function SetupWizard({ onCreated }: { onCreated: () => void }) {
  const store = useStore()
  const [step, setStep] = useState(0)
  const [subject, setSubject] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [d, setD] = useState<Draft>(() => ({
    name: '', currency: 'EUR', locale: LOCALES.includes(navigator.language) ? navigator.language : 'en-IE', startMonth: monthOfDate(),
    closingRule: 'savings-plug', moneyMode: 'pooled', pocketTotal: '',
    adults: [{ name: '' }, { name: '' }], dependents: [],
    accounts: [{ name: 'Main account', type: 'checking', openingBalance: '' }, { name: 'Savings', type: 'savings', openingBalance: '' }],
    householdTemplates: recommended('household'), entityTemplates: { 0: recommended('adult'), 1: recommended('adult') },
    customRows: [],
  }))
  const patch = (p: Partial<Draft>) => setD((prev) => ({ ...prev, ...p }))

  const entities = useMemo(() => [...d.adults.map((a) => ({ kind: 'adult' as EntityKind, name: a.name })), ...d.dependents.map((x) => ({ kind: x.kind as EntityKind, name: x.name }))], [d.adults, d.dependents])
  const subjects = useMemo(
    () => [
      { name: 'the household', kind: null as EntityKind | null, index: -1 },
      ...entities.map((e, i) => ({ name: e.name.trim() || `${ENTITY_KIND_LABEL[e.kind]} ${i + 1}`, kind: e.kind as EntityKind | null, index: i })),
    ],
    [entities],
  )
  const errors = useMemo(() => validate(d), [d])
  const stepErrors = [errors.pocketTotal ? 1 : 0, 0, 0, Object.keys(errors.accounts).length, 0, 0]
  const currentHasErrors = stepErrors[step] > 0

  const hasAccountOf = (type: AccountType) => d.accounts.some((a) => a.name.trim() && a.type === type)
  const chosenFor = (s: (typeof subjects)[number]) => (s.kind ? d.entityTemplates[s.index] ?? recommended(s.kind) : d.householdTemplates)
  const templatesFor = (s: (typeof subjects)[number]): RowTemplate[] => (s.kind ? ENTITY_TEMPLATES[s.kind].filter((t) => !(t.pocket && d.moneyMode !== 'pooled')) : HOUSEHOLD_TEMPLATES)
  const totalRows = subjects.reduce((n, s) => n + chosenFor(s).size, 0) + d.customRows.length

  function toggle(s: (typeof subjects)[number], key: string, on: boolean) {
    if (!s.kind) {
      const set = new Set(d.householdTemplates)
      if (on) set.add(key); else set.delete(key)
      patch({ householdTemplates: set })
      return
    }
    setD((prev) => {
      const next = { ...prev.entityTemplates }
      const set = new Set(next[s.index] ?? recommended(s.kind!))
      if (on) set.add(key); else set.delete(key)
      next[s.index] = set
      return { ...prev, entityTemplates: next }
    })
  }

  function go(to: number) {
    setError(null)
    setStep(to)
    if (to === 4) setSubject(0)
  }
  function next() {
    if (step === 4 && subject < subjects.length - 1) return setSubject(subject + 1)
    go(Math.min(step + 1, STEPS.length - 1))
    if (step + 1 === 4) setSubject(0)
  }
  function back() {
    if (step === 4 && subject > 0) return setSubject(subject - 1)
    if (step === 5) { setStep(4); setSubject(subjects.length - 1); return }
    go(Math.max(step - 1, 0))
  }

  async function finish() {
    setBusy(true)
    setError(null)
    try {
      const pocket = d.pocketTotal.trim() ? parseAmount(d.pocketTotal, d.currency, d.locale) ?? 0 : 0
      const keptAdults = d.adults.filter((a) => a.name.trim())
      const input: SetupInput = {
        household: { name: d.name.trim() || 'Our household', baseCurrency: d.currency, locale: d.locale, startMonth: d.startMonth, closingRule: d.closingRule, moneyMode: d.moneyMode, pocketTotal: pocket },
        adults: keptAdults.length ? keptAdults : [{ name: 'Me' }],
        dependents: d.dependents.filter((x) => x.name.trim()),
        accounts: d.accounts.filter((a) => a.name.trim()).map((a) => ({ name: a.name.trim(), type: a.type, openingBalance: a.openingBalance.trim() ? parseAmount(a.openingBalance, d.currency, d.locale) ?? 0 : 0 })),
        householdTemplates: [...d.householdTemplates],
        entityTemplates: Object.fromEntries(entities.map((e, i) => [i, [...(d.entityTemplates[i] ?? recommended(e.kind))]])),
      }
      // indexes shift when blank adults are dropped; rebuild dependents' paidBy on the filtered list
      const keptIdx = d.adults.map((a, i) => (a.name.trim() ? i : -1)).filter((i) => i >= 0)
      input.dependents = d.dependents.filter((x) => x.name.trim()).map((x) => ({ ...x, paidByIndex: x.paidByIndex == null ? null : Math.max(0, keptIdx.indexOf(x.paidByIndex)) }))
      await createHouseholdFromSetup(store, input)
      for (const c of d.customRows) {
        const s = subjects[c.subject]
        const prefix = s && s.kind && entities[s.index]?.name.trim() ? `${entities[s.index].name.trim()} – ` : ''
        await addRow(store, { name: `${prefix}${c.name}`, section: c.section, defaultStatus: c.section === 'expense' ? 'projected' : 'committed' })
      }
      onCreated()
    } catch (e) {
      if (e instanceof ZodError) setError(`Something does not fit: ${e.issues.map((i) => `${i.path.join('.')} ${i.message}`).join('; ')}. Use the step names above to go back and fix it.`)
      else setError(e instanceof Error ? e.message : 'Could not create the household')
    } finally {
      setBusy(false)
    }
  }

  const s = subjects[Math.min(subject, subjects.length - 1)]

  return (
    <Card className="mx-auto max-w-2xl">
      <CardHeader>
        <CardTitle>Set up your household</CardTitle>
        <CardDescription>
          Step {step + 1} of {STEPS.length}: {STEPS[step]}{step === 4 ? ` · ${subject + 1} of ${subjects.length}` : ''}. Everything can be changed later. "Finish now" uses sensible defaults for the rest.
        </CardDescription>
        <ol className="mt-2 flex flex-wrap gap-1 text-xs" aria-label="Steps">
          {STEPS.map((name, i) => (
            <li key={name}>
              <button
                type="button"
                onClick={() => go(i)}
                aria-current={i === step ? 'step' : undefined}
                className={cn('rounded px-2 py-0.5', i === step ? 'bg-foreground text-background' : 'bg-muted text-muted-foreground hover:text-foreground', stepErrors[i] > 0 && 'ring-1 ring-destructive')}
              >
                {name}{stepErrors[i] > 0 ? ' !' : ''}
              </button>
            </li>
          ))}
        </ol>
      </CardHeader>
      <CardContent className="space-y-5">
        {step === 0 && (
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="w-name">Household name</Label>
              <Input id="w-name" autoFocus value={d.name} onChange={(e) => patch({ name: e.target.value })} placeholder="Our household" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="w-ccy">Currency</Label>
              <NativeSelect id="w-ccy" className="w-full" value={d.currency} onChange={(e) => patch({ currency: e.target.value })}>{CURRENCIES.map((c) => <option key={c}>{c}</option>)}</NativeSelect>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="w-locale">Number and date format</Label>
              <NativeSelect id="w-locale" className="w-full" value={d.locale} onChange={(e) => patch({ locale: e.target.value })}>
                {LOCALES.map((l) => <option key={l} value={l}>{localeLabel(l)} — {localeExample(l)}</option>)}
              </NativeSelect>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="w-start">First month</Label>
              <MonthField id="w-start" label="First month" value={d.startMonth} onChange={(m) => patch({ startMonth: m })} locale={d.locale} />
              <p className="text-xs text-muted-foreground">The grid starts here. Earlier months stay in your old spreadsheet.</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="w-rule">Month-end rule</Label>
              <NativeSelect id="w-rule" className="w-full" value={d.closingRule} onChange={(e) => patch({ closingRule: e.target.value as Household['closingRule'] })}>
                <option value="savings-plug">Leftover goes to savings</option>
                <option value="leftover-plug">I decide the savings amount</option>
              </NativeSelect>
              <p className="text-xs text-muted-foreground">{RULE_HELP[d.closingRule]}</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="w-mode">How you share money</Label>
              <NativeSelect id="w-mode" className="w-full" value={d.moneyMode} onChange={(e) => patch({ moneyMode: e.target.value as Household['moneyMode'] })}>
                <option value="pooled">Pooled, with pocket money</option>
                <option value="proportional">In proportion to income</option>
              </NativeSelect>
              <p className="text-xs text-muted-foreground">{MODE_HELP[d.moneyMode]}</p>
            </div>
            {d.moneyMode === 'pooled' && (
              <div className="space-y-1.5">
                <Label htmlFor="w-pocket">Pocket money per month ({d.currency})</Label>
                <Input id="w-pocket" inputMode="decimal" value={d.pocketTotal} onChange={(e) => patch({ pocketTotal: e.target.value })} placeholder="e.g. 1000" aria-invalid={!!errors.pocketTotal} />
                <p className={cn('text-xs', errors.pocketTotal ? 'text-destructive' : 'text-muted-foreground')}>
                  {errors.pocketTotal ?? 'For all adults together, split equally. Each adult\'s share appears as its own row.'}
                </p>
              </div>
            )}
          </div>
        )}

        {step === 1 && (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Adults</Label>
              <p className="text-xs text-muted-foreground">{ENTITY_KIND_HELP.adult} Blank names are skipped.</p>
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
              <p className="text-xs text-muted-foreground">{ENTITY_KIND_HELP.child}</p>
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
            <p className="text-sm text-muted-foreground">Things with running costs. Each one brings its own suggested rows in the Rows step, so a car's insurance does not get mixed up with the dog's.</p>
            {d.dependents.map((x, i) => x.kind !== 'child' && (
              <div key={i} className="space-y-1 rounded-md border p-2">
                <div className="flex flex-wrap items-center gap-2">
                  <NativeSelect aria-label="Kind" value={x.kind} onChange={(e) => patch({ dependents: d.dependents.map((y, j) => (j === i ? { ...y, kind: e.target.value as Draft['dependents'][number]['kind'] } : y)) })}>
                    {DEPENDENT_KINDS.filter((k) => k !== 'child').map((k) => <option key={k} value={k}>{ENTITY_KIND_LABEL[k]}</option>)}
                  </NativeSelect>
                  <Input aria-label="Name" className="w-44" value={x.name} placeholder={x.kind === 'property' ? 'e.g. Flat, Elm Street' : 'Name'} onChange={(e) => patch({ dependents: d.dependents.map((y, j) => (j === i ? { ...y, name: e.target.value } : y)) })} />
                  <Button size="icon" variant="ghost" aria-label="Remove" onClick={() => patch({ dependents: d.dependents.filter((_, j) => j !== i) })}><Trash2 /></Button>
                </div>
                <p className="text-xs text-muted-foreground">{ENTITY_KIND_HELP[x.kind]}</p>
              </div>
            ))}
            <div className="flex flex-wrap gap-2">
              {(['pet', 'vehicle', 'property', 'company', 'other'] as const).map((k) => (
                <Button key={k} size="sm" variant="outline" title={ENTITY_KIND_HELP[k]} onClick={() => patch({ dependents: [...d.dependents, { kind: k, name: '', paidByIndex: null }] })}>Add {ENTITY_KIND_LABEL[k].toLowerCase()}</Button>
              ))}
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              One current account is enough to start. Add a savings account if you want to see your savings grow month by month. Opening balance is the balance at the start of your first month; leave it empty if you do not know.
            </p>
            {d.accounts.map((a, i) => (
              <div key={i} className="space-y-1 rounded-md border p-2">
                <div className="grid grid-cols-[1fr_auto] gap-2 sm:grid-cols-[1fr_11rem_9rem_auto]">
                  <Input aria-label={`Account ${i + 1} name`} value={a.name} placeholder="Name" onChange={(e) => patch({ accounts: d.accounts.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })} />
                  <NativeSelect aria-label="Account type" value={a.type} onChange={(e) => patch({ accounts: d.accounts.map((x, j) => (j === i ? { ...x, type: e.target.value as AccountType } : x)) })}>
                    {WIZARD_ACCOUNT_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                  </NativeSelect>
                  <Input aria-label="Opening balance" inputMode="decimal" value={a.openingBalance} placeholder={`Opening ${d.currency}`} aria-invalid={!!errors.accounts[i]} onChange={(e) => patch({ accounts: d.accounts.map((x, j) => (j === i ? { ...x, openingBalance: e.target.value } : x)) })} />
                  <Button size="icon" variant="ghost" aria-label="Remove account" onClick={() => patch({ accounts: d.accounts.filter((_, j) => j !== i) })}><Trash2 /></Button>
                </div>
                <p className={cn('text-xs', errors.accounts[i] ? 'text-destructive' : 'text-muted-foreground')}>{errors.accounts[i] ?? ACCOUNT_TYPE_INFO.find((t) => t.value === a.type)?.help}</p>
              </div>
            ))}
            <Button size="sm" variant="outline" onClick={() => patch({ accounts: [...d.accounts, { name: '', type: 'checking', openingBalance: '' }] })}>Add account</Button>
          </div>
        )}

        {step === 4 && s && (
          <div className="space-y-4">
            <div role="tablist" aria-label="Who the rows are for" className="flex flex-wrap gap-1 border-b pb-2">
              {subjects.map((sub, i) => {
                const count = chosenFor(sub).size + d.customRows.filter((r) => r.subject === i).length
                return (
                  <button
                    key={i}
                    type="button"
                    role="tab"
                    aria-selected={i === subject}
                    onClick={() => setSubject(i)}
                    className={cn('flex items-center gap-1.5 rounded-md px-2.5 py-1 text-sm', i === subject ? 'bg-secondary font-medium' : 'text-muted-foreground hover:bg-muted hover:text-foreground')}
                  >
                    {sub.kind ? sub.name : 'Household'}
                    {sub.kind && <span className="text-xs text-muted-foreground">{ENTITY_KIND_LABEL[sub.kind]}</span>}
                    <span className="rounded-full bg-muted px-1.5 text-xs tabular-nums">{count}</span>
                  </button>
                )
              })}
            </div>
            <div>
              <h3 className="font-medium">Rows for {s.name}</h3>
              <p className="text-sm text-muted-foreground">
                {s.kind ? ENTITY_KIND_HELP[s.kind] : 'Shared rows that belong to no one in particular.'} Tick what applies; untick what you never have. Rows can be added, renamed or archived later.
              </p>
            </div>
            {SECTIONS.map((section) => {
              const list = templatesFor(s).filter((t) => t.section === section)
              if (list.length === 0) return null
              return (
                <fieldset key={section} className="space-y-1.5 rounded-md border p-3">
                  <legend className="flex items-center gap-2 px-1 text-sm font-medium">
                    <span className={cn('size-2 rounded-full', SECTION_DOT[section])} aria-hidden />
                    {SECTION_INFO[section].label}
                    <span className="font-normal text-muted-foreground">· {SECTION_INFO[section].blurb}</span>
                  </legend>
                  {list.map((t) => {
                    const missing = t.account && !hasAccountOf(t.account) ? ` Needs a ${ACCOUNT_TYPE_INFO.find((a) => a.value === t.account)?.label.toLowerCase()} account; add one under Accounts.` : ''
                    return (
                      <Check
                        key={t.key}
                        className="items-start py-0.5"
                        label={<span className="block leading-tight"><span>{templateTitle(t, s.kind ? entities[s.index]?.name || s.name : undefined)}</span><span className="block text-xs text-muted-foreground">{t.description}{missing}</span></span>}
                        checked={chosenFor(s).has(t.key)}
                        onChange={(e) => toggle(s, t.key, e.target.checked)}
                      />
                    )
                  })}
                </fieldset>
              )
            })}
            <CustomRows d={d} subject={subject} subjectName={s.name} onChange={(rows) => patch({ customRows: rows })} />
          </div>
        )}

        {step === 5 && (
          <div className="space-y-2 text-sm">
            <p><strong>{d.name.trim() || 'Our household'}</strong> · {d.currency} · {localeLabel(d.locale)} · from {formatMonth(d.startMonth, d.locale, 'long')}</p>
            <p>{d.adults.filter((a) => a.name.trim()).length || 1} adult(s), {d.dependents.filter((x) => x.name.trim()).length} other member(s) or thing(s), {d.accounts.filter((a) => a.name.trim()).length} account(s).</p>
            <p>{totalRows} rows will be created. Recurring payments such as rent or insurance are added afterwards from any grid cell with "Make recurring".</p>
          </div>
        )}

        {error && <p className="text-sm text-destructive" role="alert">{error}</p>}

        <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-4">
          <Button variant="ghost" disabled={(step === 0) || busy} onClick={back}>Back</Button>
          <div className="flex gap-2">
            {step < STEPS.length - 1 && <Button variant="outline" disabled={busy || stepErrors.some((n) => n > 0)} onClick={() => void finish()}>Finish now</Button>}
            {step < STEPS.length - 1 ? (
              <Button disabled={busy || currentHasErrors} onClick={next}>Next</Button>
            ) : (
              <Button disabled={busy || stepErrors.some((n) => n > 0)} onClick={() => void finish()}>Create household</Button>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

function CustomRows({ d, subject, subjectName, onChange }: { d: Draft; subject: number; subjectName: string; onChange: (rows: Draft['customRows']) => void }) {
  const [name, setName] = useState('')
  const [section, setSection] = useState<Section>('expense')
  const mine = d.customRows.map((r, i) => ({ ...r, i })).filter((r) => r.subject === subject)
  function add() {
    if (!name.trim()) return
    onChange([...d.customRows, { subject, name: name.trim(), section }])
    setName('')
  }
  return (
    <div className="space-y-2 rounded-md border border-dashed p-3">
      <p className="text-sm font-medium">Your own rows for {subjectName}</p>
      {mine.map((r) => (
        <div key={r.i} className="flex items-center gap-2 text-sm">
          <span className={cn('size-2 rounded-full', SECTION_DOT[r.section])} aria-hidden />
          <span className="flex-1">{r.name} <span className="text-xs text-muted-foreground">· {SECTION_INFO[r.section].label}</span></span>
          <Button size="icon" variant="ghost" aria-label={`Remove ${r.name}`} onClick={() => onChange(d.customRows.filter((_, j) => j !== r.i))}><Trash2 /></Button>
        </div>
      ))}
      <div className="flex flex-wrap gap-2">
        <Input aria-label="Your own row name" className="w-48" value={name} placeholder="e.g. Garden" onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add() } }} />
        <NativeSelect aria-label="Your own row section" value={section} onChange={(e) => setSection(e.target.value as Section)}>
          {SECTIONS.map((sec) => <option key={sec} value={sec}>{SECTION_INFO[sec].label}</option>)}
        </NativeSelect>
        <Button size="sm" variant="outline" onClick={add} disabled={!name.trim()}>Add row</Button>
      </div>
    </div>
  )
}
