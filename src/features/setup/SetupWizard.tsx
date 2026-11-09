import { useMemo, useState, type ReactNode } from 'react'
import { Trash2 } from 'lucide-react'
import { ZodError } from 'zod'
import { Button } from '@/components/ui/button'
import { Island } from '@/components/ui/island'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Check } from '@/components/Check'
import { InfoTip } from '@/components/InfoTip'
import { MonthField } from '@/components/MonthField'
import { NativeSelect } from '@/features/grid/NativeSelect'
import { formatAmount, formatMonth, localeExample, localeLabel, parseAmount } from '@/app/format'
import { useStore } from '@/app/store'
import { cn } from '@/lib/utils'
import { HUES } from '@/app/hues'
import { MODE_HELP, RULE_HELP } from '@/app/help'
import {
  ACCOUNT_TYPE_INFO, ENTITY_KIND_HELP, ENTITY_KIND_LABEL, SECTION_INFO, monthOfDate, templateTitle,
  type AccountType, type EntityKind, type Household, type Section,
} from '@/model'
import { createHouseholdFromSetup } from '@/store'
import { CURRENCIES } from '@/app/currencies'
import {
  customKey, depositKey, depositTargets, isAutomatic, keptEntities, linkFor, namedAccounts, recommended, rowKey, templatesFor, toSetupInput, validate,
  type Draft, type Errors,
} from './draft'

const LOCALES = ['en-IE', 'en-GB', 'en-US', 'de-DE', 'de-AT', 'tr-TR', 'fr-FR', 'es-ES', 'nl-NL', 'it-IT', 'pt-PT', 'sv-SE']
const DEPENDENT_KINDS: Array<Exclude<EntityKind, 'adult'>> = ['child', 'pet', 'vehicle', 'property', 'company', 'other']
const WIZARD_ACCOUNT_TYPES = ACCOUNT_TYPE_INFO.filter((t) => t.value !== 'other-asset')
const STEPS = ['Basics', 'People', 'Things', 'Accounts', 'Rows', 'Finish']
const SECTIONS: Section[] = ['income', 'expense', 'transfer']
const SECTION_DOT: Record<Section, string> = { income: HUES.income.fill, expense: HUES.expense.fill, transfer: HUES.transfer.fill }
const typeLabel = (type: AccountType) => ACCOUNT_TYPE_INFO.find((t) => t.value === type)?.label ?? type

type SubjectAt = number | 'h'
interface Subject { name: string; kind: EntityKind | null; at: SubjectAt }

/** One row the Rows step offers: a template or a deposit into an account. */
interface Offer {
  id: string
  title: string
  description: string
  checked: boolean
  toggle: (on: boolean) => void
  /** where its amount is kept; null = automatic (the savings plug, pocket money) */
  amountKey: string | null
  /** the account the row points at, when more than one account of the type exists */
  link?: { options: ReturnType<typeof namedAccounts>; value: number | null; onChange: (at: number) => void }
}

/** `onBack` adds a "Back to start" link to the title row (the welcome screen's chooser); `notice` is a line above the steps,
 *  the signed-in note that the household uploads on finish. */
export function SetupWizard({ onCreated, onBack, notice }: { onCreated: () => void; onBack?: () => void; notice?: ReactNode }) {
  const store = useStore()
  const [step, setStep] = useState(0)
  const [subject, setSubject] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [d, setD] = useState<Draft>(() => ({
    name: '', currency: 'EUR', locale: LOCALES.includes(navigator.language) ? navigator.language : 'en-IE', startMonth: monthOfDate(),
    closingRule: 'savings-plug', moneyMode: 'pooled', pocketTotal: '',
    adults: [{ name: '' }, { name: '' }], dependents: [],
    accounts: [{ name: 'Main account', type: 'checking', openingBalance: '', currency: null, ownerAt: null }, { name: 'Savings', type: 'savings', openingBalance: '', currency: null, ownerAt: null }],
    householdTemplates: recommended('household'), entityTemplates: { 0: recommended('adult'), 1: recommended('adult') },
    depositsOff: new Set(), amounts: {}, links: {},
    customRows: [],
  }))
  const patch = (p: Partial<Draft>) => setD((prev) => ({ ...prev, ...p }))

  // only people and things that will be created get a Rows step, so every preview is a row that will exist
  const kept = useMemo(() => keptEntities(d), [d])
  const subjects = useMemo<Subject[]>(
    () => [{ name: 'the household', kind: null, at: 'h' }, ...kept.map((e) => ({ name: e.name, kind: e.kind as EntityKind | null, at: e.at as SubjectAt }))],
    [kept],
  )
  const errors = useMemo(() => validate(d), [d])
  const stepErrors = [errors.pocketTotal ? 1 : 0, 0, 0, Object.keys(errors.accounts).length, Object.keys(errors.amounts).length, 0]
  const currentHasErrors = stepErrors[step] > 0

  const hasAccountOf = (type: AccountType) => namedAccounts(d, type).length > 0
  const chosenFor = (s: Subject) => (s.kind ? d.entityTemplates[s.at as number] ?? recommended(s.kind) : d.householdTemplates)
  const depositsOn = () => depositTargets(d).filter(({ at }) => !d.depositsOff.has(at))
  const countFor = (s: Subject, i: number) =>
    templatesFor(d, s.kind).filter((t) => chosenFor(s).has(t.key)).length + (s.kind ? 0 : depositsOn().length) + d.customRows.filter((r) => r.subject === i && r.name.trim()).length

  function toggle(s: Subject, key: string, on: boolean) {
    if (!s.kind) {
      const set = new Set(d.householdTemplates)
      if (on) set.add(key); else set.delete(key)
      patch({ householdTemplates: set })
      return
    }
    setD((prev) => {
      const next = { ...prev.entityTemplates }
      const set = new Set(next[s.at as number] ?? recommended(s.kind!))
      if (on) set.add(key); else set.delete(key)
      next[s.at as number] = set
      return { ...prev, entityTemplates: next }
    })
  }

  /** What the Rows step offers a subject in one section: its templates, and for the household the deposit rows. */
  function offersFor(s: Subject, section: Section): Offer[] {
    const list: Offer[] = templatesFor(d, s.kind).filter((t) => t.section === section).map((t) => {
      const key = rowKey(s.at, t.key)
      const missing = t.account && !hasAccountOf(t.account) ? ` Needs a ${typeLabel(t.account).toLowerCase()} account; add one under Accounts.` : ''
      const linkable = t.account ? namedAccounts(d, t.account) : []
      return {
        id: t.key, title: templateTitle(t, s.kind ? s.name : undefined), description: `${t.description}${missing}`,
        checked: chosenFor(s).has(t.key), toggle: (on) => toggle(s, t.key, on),
        amountKey: isAutomatic(d, t) ? null : key,
        link: linkable.length > 1 ? { options: linkable, value: linkFor(d, s.at, t), onChange: (at) => patch({ links: { ...d.links, [key]: at } }) } : undefined,
      }
    })
    if (!s.kind && section === 'transfer') {
      for (const { account, at } of depositTargets(d)) {
        list.push({
          id: depositKey(at), title: `To ${account.name}`,
          description: `A fixed monthly deposit into ${account.name} (${typeLabel(account.type).toLowerCase()}${account.currency ? `, ${account.currency}` : ''}).`,
          checked: !d.depositsOff.has(at),
          toggle: (on) => { const set = new Set(d.depositsOff); if (on) set.delete(at); else set.add(at); patch({ depositsOff: set }) },
          amountKey: depositKey(at),
        })
      }
    }
    return list
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
      await createHouseholdFromSetup(store, toSetupInput(d))
      onCreated()
    } catch (e) {
      if (e instanceof ZodError) setError(`Something does not fit: ${e.issues.map((i) => `${i.path.join('.')} ${i.message}`).join('; ')}. Use the step names above to go back and fix it.`)
      else setError(e instanceof Error ? e.message : 'Could not create the household')
    } finally {
      setBusy(false)
    }
  }

  const s = subjects[Math.min(subject, subjects.length - 1)]
  const owners = kept.filter((e) => e.kind === 'adult' || e.kind === 'child')

  return (
    <Island
      air title="Set up your household" className="mx-auto max-w-2xl" bodyClassName="space-y-5"
      description={<>Step {step + 1} of {STEPS.length}: {STEPS[step]}{step === 4 ? ` · ${subject + 1} of ${subjects.length}` : ''}. Everything can be changed later. "Finish now" uses sensible defaults for the rest.</>}
      right={onBack ? <Button size="xs" variant="ghost" onClick={onBack}>Back to start</Button> : undefined}
    >
        {notice && <p className="text-xs text-muted-foreground">{notice}</p>}
        <ol className="flex flex-wrap gap-1 text-xs" aria-label="Steps">
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
              One current account is enough to start. Add a savings account if you want to see your savings grow month by month, and an investment account for each place you deposit into; every investment account gets its own deposit row in the Rows step.
              Opening balance is the balance at the start of your first month; leave it empty if you do not know. An account kept in another currency says so next to its type; the grid then shows its household value beneath.
            </p>
            {d.accounts.map((a, i) => (
              <div key={i} className="space-y-1 rounded-md border p-2">
                <div className="grid grid-cols-[1fr_auto] gap-2 sm:grid-cols-[1fr_10rem_7rem_8rem_auto]">
                  <Input aria-label={`Account ${i + 1} name`} value={a.name} placeholder="Name" onChange={(e) => patch({ accounts: d.accounts.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })} />
                  <NativeSelect aria-label="Account type" value={a.type} onChange={(e) => patch({ accounts: d.accounts.map((x, j) => (j === i ? { ...x, type: e.target.value as AccountType } : x)) })}>
                    {WIZARD_ACCOUNT_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                  </NativeSelect>
                  <NativeSelect aria-label="Account currency" value={a.currency ?? ''} onChange={(e) => patch({ accounts: d.accounts.map((x, j) => (j === i ? { ...x, currency: e.target.value || null } : x)) })}>
                    <option value="">{d.currency} (household currency)</option>
                    {CURRENCIES.filter((c) => c !== d.currency).map((c) => <option key={c} value={c}>{c}</option>)}
                  </NativeSelect>
                  <Input aria-label="Opening balance" inputMode="decimal" value={a.openingBalance} placeholder={`Opening ${a.currency ?? d.currency}`} aria-invalid={!!errors.accounts[i]} onChange={(e) => patch({ accounts: d.accounts.map((x, j) => (j === i ? { ...x, openingBalance: e.target.value } : x)) })} />
                  <Button size="icon" variant="ghost" aria-label="Remove account" onClick={() => patch({ accounts: d.accounts.filter((_, j) => j !== i) })}><Trash2 /></Button>
                </div>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                  <span className="inline-flex items-center gap-1">
                    <label className="inline-flex items-center gap-1">
                      Belongs to
                      <NativeSelect aria-label={`Account ${i + 1} belongs to`} className="h-7" value={a.ownerAt ?? ''} onChange={(e) => patch({ accounts: d.accounts.map((x, j) => (j === i ? { ...x, ownerAt: e.target.value === '' ? null : Number(e.target.value) } : x)) })}>
                        <option value="">The household</option>
                        {owners.map((o) => <option key={o.at} value={o.at}>{o.name}{o.kind === 'child' ? ' · child' : ''}</option>)}
                      </NativeSelect>
                    </label>
                    <InfoTip help="setup.owner" />
                  </span>
                  <p className={cn(errors.accounts[i] && 'text-destructive')}>{errors.accounts[i] ?? `${ACCOUNT_TYPE_INFO.find((t) => t.value === a.type)?.help ?? ''}${a.currency ? ` Kept in ${a.currency}; the grid shows its ${d.currency} value beneath, at each month's rate.` : ''}`}</p>
                </div>
              </div>
            ))}
            <Button size="sm" variant="outline" onClick={() => patch({ accounts: [...d.accounts, { name: '', type: 'checking', openingBalance: '', currency: null, ownerAt: null }] })}>Add account</Button>
          </div>
        )}

        {step === 4 && s && (
          <div className="space-y-4">
            <div role="tablist" aria-label="Who the rows are for" className="flex flex-wrap gap-1 border-b pb-2">
              {subjects.map((sub, i) => (
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
                  <span className="rounded-full bg-muted px-1.5 text-xs tabular-nums">{countFor(sub, i)}</span>
                </button>
              ))}
            </div>
            <div>
              <h3 className="font-medium">Rows for {s.name}</h3>
              <p className="text-sm text-muted-foreground">
                {s.kind ? ENTITY_KIND_HELP[s.kind] : 'Shared rows that belong to no one in particular.'} Tick what applies; untick what you never have. Beside a ticked row, type the usual monthly amount or leave it for the grid <InfoTip help="setup.amount" />. Rows can be added, renamed or archived later.
              </p>
            </div>
            {SECTIONS.map((section) => {
              const list = offersFor(s, section)
              const householdTransfers = !s.kind && section === 'transfer'
              if (list.length === 0 && !householdTransfers) return null
              return (
                <fieldset key={section} className="space-y-1.5 rounded-md border p-3">
                  <legend className="flex items-center gap-2 px-1 text-sm font-medium">
                    <span className={cn('size-2 rounded-full', SECTION_DOT[section])} aria-hidden />
                    {SECTION_INFO[section].label}
                    <span className="font-normal text-muted-foreground">· {SECTION_INFO[section].blurb}</span>
                  </legend>
                  {list.map((o) => (
                    <div key={o.id} className="py-0.5">
                      <div className="flex flex-wrap items-start gap-x-3 gap-y-1">
                        <Check
                          className="min-w-0 flex-1 items-start"
                          label={<span className="block leading-tight"><span>{o.title}</span><span className="block text-xs text-muted-foreground">{o.description}</span></span>}
                          checked={o.checked}
                          onChange={(e) => o.toggle(e.target.checked)}
                        />
                        {o.checked && (o.amountKey
                          ? <AmountField label={o.title} value={d.amounts[o.amountKey] ?? ''} currency={d.currency} error={errors.amounts[o.amountKey]} onChange={(v) => patch({ amounts: { ...d.amounts, [o.amountKey as string]: v } })} />
                          : <span className="pt-1 text-xs text-muted-foreground">automatic</span>)}
                      </div>
                      {o.checked && o.link && (
                        <label className="ml-6 mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                          into
                          <NativeSelect aria-label={`${o.title} account`} className="h-7" value={o.link.value ?? ''} onChange={(e) => o.link?.onChange(Number(e.target.value))}>
                            {o.link.options.map(({ account, at }) => <option key={at} value={at}>{account.name}</option>)}
                          </NativeSelect>
                        </label>
                      )}
                      {o.checked && o.amountKey && errors.amounts[o.amountKey] && <p className="ml-6 text-xs text-destructive">{errors.amounts[o.amountKey]}</p>}
                    </div>
                  ))}
                  {householdTransfers && !hasAccountOf('investment') && (
                    <p className="px-1 text-xs text-muted-foreground">Add an investment account under Accounts and a {'"To <name>"'} deposit row appears here, one per account.</p>
                  )}
                </fieldset>
              )
            })}
            <CustomRows d={d} errors={errors} subject={subject} subjectName={s.name} onChange={(rows) => patch({ customRows: rows })} />
          </div>
        )}

        {step === 5 && <Preview d={d} />}

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
    </Island>
  )
}

/** The optional first amount of a row: a small field with the currency after it. */
function AmountField({ label, value, currency, error, onChange }: { label: string; value: string; currency: string; error?: string; onChange: (v: string) => void }) {
  return (
    <span className="flex items-center gap-1 text-xs text-muted-foreground">
      <Input aria-label={`${label} per month`} inputMode="decimal" className="h-7 w-28" placeholder="per month" value={value} aria-invalid={!!error} onChange={(e) => onChange(e.target.value)} />
      {currency}
    </span>
  )
}

function CustomRows({ d, errors, subject, subjectName, onChange }: { d: Draft; errors: Errors; subject: number; subjectName: string; onChange: (rows: Draft['customRows']) => void }) {
  const [name, setName] = useState('')
  const [section, setSection] = useState<Section>('expense')
  const mine = d.customRows.map((r, i) => ({ ...r, i })).filter((r) => r.subject === subject)
  function add() {
    if (!name.trim()) return
    onChange([...d.customRows, { subject, name: name.trim(), section, amount: '' }])
    setName('')
  }
  return (
    <div className="space-y-2 rounded-md border border-dashed p-3">
      <p className="text-sm font-medium">Your own rows for {subjectName}</p>
      {mine.map((r) => (
        <div key={r.i} className="space-y-1">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className={cn('size-2 rounded-full', SECTION_DOT[r.section])} aria-hidden />
            <span className="min-w-0 flex-1">{r.name} <span className="text-xs text-muted-foreground">· {SECTION_INFO[r.section].label}</span></span>
            <AmountField label={r.name} value={r.amount} currency={d.currency} error={errors.amounts[customKey(r.i)]} onChange={(v) => onChange(d.customRows.map((x, j) => (j === r.i ? { ...x, amount: v } : x)))} />
            <Button size="icon" variant="ghost" aria-label={`Remove ${r.name}`} onClick={() => onChange(d.customRows.filter((_, j) => j !== r.i))}><Trash2 /></Button>
          </div>
          {errors.amounts[customKey(r.i)] && <p className="ml-4 text-xs text-destructive">{errors.amounts[customKey(r.i)]}</p>}
        </div>
      ))}
      <div className="flex flex-wrap gap-2">
        <Input aria-label="Your own row name" className="w-48" value={name} placeholder="e.g. Subscriptions – Netflix" onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add() } }} />
        <NativeSelect aria-label="Your own row section" value={section} onChange={(e) => setSection(e.target.value as Section)}>
          {SECTIONS.map((sec) => <option key={sec} value={sec}>{SECTION_INFO[sec].label}</option>)}
        </NativeSelect>
        <Button size="sm" variant="outline" onClick={add} disabled={!name.trim()}>Add row</Button>
      </div>
    </div>
  )
}

/** The last step: what "Create household" will make, so nothing is a surprise. */
function Preview({ d }: { d: Draft }) {
  const kept = keptEntities(d)
  const subjects: Subject[] = [{ name: 'the household', kind: null, at: 'h' }, ...kept.map((e) => ({ name: e.name, kind: e.kind as EntityKind | null, at: e.at as SubjectAt }))]
  const money = (v: string | undefined, currency = d.currency) => {
    const n = v?.trim() ? parseAmount(v, currency, d.locale) : null
    return n == null ? null : formatAmount(n, currency, d.locale)
  }
  const perMonth = (v: string | undefined) => { const m = money(v); return m ? `${m} per month` : '' }
  const ownerName = (at: number | null) => (at == null ? 'the household' : kept.find((e) => e.at === at)?.name ?? 'the household')
  const accounts = namedAccounts(d)
  const savings = accounts.find(({ account }) => account.type === 'savings')
  const rows: Array<{ section: Section; name: string; detail: string }> = []
  const pools: string[] = []
  subjects.forEach((s, i) => {
    const chosen = s.kind ? d.entityTemplates[s.at as number] ?? recommended(s.kind) : d.householdTemplates
    for (const t of templatesFor(d, s.kind)) {
      if (!chosen.has(t.key)) continue
      const link = linkFor(d, s.at, t)
      const name = templateTitle(t, s.kind ? s.name : undefined)
      const detail = isAutomatic(d, t) ? 'automatic' : perMonth(d.amounts[rowKey(s.at, t.key)])
      if (t.pool) {
        // a pool template's amount is what is set aside each month: it lives on the "<name> pool" transfer row
        pools.push(name)
        rows.push({ section: t.section, name, detail: '' }, { section: 'transfer', name: `${name} pool`, detail })
        continue
      }
      rows.push({ section: t.section, name: link != null ? `${name} → ${d.accounts[link].name}` : name, detail })
    }
    for (const c of d.customRows) if (c.subject === i && c.name.trim()) rows.push({ section: c.section, name: s.kind ? `${s.name} – ${c.name.trim()}` : c.name.trim(), detail: perMonth(c.amount) })
  })
  for (const { account, at } of depositTargets(d)) if (!d.depositsOff.has(at)) rows.push({ section: 'transfer', name: `To ${account.name}`, detail: perMonth(d.amounts[depositKey(at)]) })
  const adults = kept.filter((e) => e.kind === 'adult').length
  return (
    <div className="space-y-3 text-sm">
      <p><strong>{d.name.trim() || 'Our household'}</strong> · {d.currency} · {localeLabel(d.locale)} · from {formatMonth(d.startMonth, d.locale, 'long')}</p>
      {d.moneyMode === 'pooled' && money(d.pocketTotal) && <p className="text-muted-foreground">Pocket money {money(d.pocketTotal)} per month, split between {adults} adult{adults === 1 ? '' : 's'}.</p>}
      <section>
        <h3 className="text-xs font-medium text-muted-foreground">Accounts</h3>
        <ul className="mt-1 space-y-0.5">
          {accounts.map(({ account: a, at }) => (
            <li key={at}>{a.name} · {typeLabel(a.type)} · {ownerName(a.ownerAt)}{money(a.openingBalance, a.currency ?? d.currency) ? ` · opening ${money(a.openingBalance, a.currency ?? d.currency)}` : ''}</li>
          ))}
          {accounts.length === 0 && <li className="text-muted-foreground">No accounts yet.</li>}
        </ul>
      </section>
      {pools.length > 0 && (
        <section>
          <h3 className="text-xs font-medium text-muted-foreground">Pool accounts</h3>
          <p className="mt-1">{pools.join(', ')}{savings ? ` · held in ${savings.account.name}` : ' · need a savings account to exist'}</p>
        </section>
      )}
      {SECTIONS.map((section) => {
        const list = rows.filter((r) => r.section === section)
        if (list.length === 0) return null
        return (
          <section key={section}>
            <h3 className="flex items-center gap-2 text-xs font-medium text-muted-foreground"><span className={cn('size-2 rounded-full', SECTION_DOT[section])} aria-hidden />{SECTION_INFO[section].label}</h3>
            <ul className="mt-1 space-y-0.5">
              {list.map((r) => <li key={r.name} className="flex justify-between gap-3"><span>{r.name}</span><span className="text-muted-foreground">{r.detail}</span></li>)}
            </ul>
          </section>
        )
      })}
      <p className="text-muted-foreground">{rows.length} rows. Recurring payments such as rent or insurance are added afterwards from any grid cell with "Make recurring". Everything can be changed later.</p>
    </div>
  )
}
