import { useState, type ReactNode } from 'react'
import { Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Island } from '@/components/ui/island'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { MonthField } from '@/components/MonthField'
import { NativeSelect } from '@/components/NativeSelect'
import { CURRENCIES } from '@/app/currencies'
import { localeExample, localeLabel } from '@/app/format'
import { useStore } from '@/app/store'
import { ENTITY_KIND_HELP, ENTITY_KIND_LABEL, monthOfDate } from '@/model'
import { createHouseholdFromSetup } from '@/store'
import { LOCALES, THING_KINDS, duplicateNames, keptStart, newStart, toSetupInput, type StartDraft, type ThingKind } from './start'

/** What a kind brings, without the sentences about settings this screen does not have. */
const firstSentence = (text: string) => `${text.split('. ')[0].replace(/\.$/, '')}.`

/**
 * The first screen of a new household (DESIGN.md §2): its name and format, its first month, and the people and
 * things in it. One screen, then the Statement opens on the first month and everything else is added there.
 * `onBack` adds "Back to start" (the welcome screen's chooser); `notice` is the signed-in line above the fields.
 */
export function SetupStart({ onCreated, onBack, notice }: { onCreated: () => void; onBack?: () => void; notice?: ReactNode }) {
  const store = useStore()
  const [d, setD] = useState<StartDraft>(() => newStart(monthOfDate(), navigator.language))
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const patch = (p: Partial<StartDraft>) => setD((prev) => ({ ...prev, ...p }))
  const setThing = (i: number, p: Partial<StartDraft['things'][number]>) => patch({ things: d.things.map((t, j) => (j === i ? { ...t, ...p } : t)) })
  const twice = duplicateNames(d)
  const kept = keptStart(d)

  async function create() {
    setBusy(true)
    setError(null)
    try {
      await createHouseholdFromSetup(store, toSetupInput(d))
      onCreated()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not set up the household.')
      setBusy(false)
    }
  }

  return (
    <Island
      air title="Set up your household" className="mx-auto max-w-2xl" bodyClassName="space-y-5"
      description="A few facts first. Accounts, income and expenses are added on the next page, the Statement, where you see them fall into place."
      right={onBack ? <Button size="xs" variant="ghost" onClick={onBack}>Back to start</Button> : undefined}
    >
      {notice && <p className="text-xs text-muted-foreground">{notice}</p>}
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="s-name">Household name</Label>
          <Input id="s-name" autoFocus value={d.name} onChange={(e) => patch({ name: e.target.value })} placeholder="Our household" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="s-ccy">Currency</Label>
          <NativeSelect id="s-ccy" className="w-full" value={d.currency} onChange={(e) => patch({ currency: e.target.value })}>{CURRENCIES.map((c) => <option key={c}>{c}</option>)}</NativeSelect>
          <p className="text-xs text-muted-foreground">What the household counts in. A single account or row can be in another currency later.</p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="s-locale">Number and date format</Label>
          <NativeSelect id="s-locale" className="w-full" value={d.locale} onChange={(e) => patch({ locale: e.target.value })}>
            {LOCALES.map((l) => <option key={l} value={l}>{localeLabel(l)} — {localeExample(l)}</option>)}
          </NativeSelect>
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="s-start">First month</Label>
          <MonthField id="s-start" label="First month" value={d.startMonth} onChange={(m) => patch({ startMonth: m })} locale={d.locale} />
          <p className="text-xs text-muted-foreground">The first month you fill in. The currency and the first month cannot be changed afterwards; everything else can.</p>
        </div>
      </div>

      <div className="space-y-4">
        <div>
          <h3 className="text-sm font-semibold">People & things</h3>
          <p className="text-xs text-muted-foreground">Who lives on this money, and what it pays for. Each one brings its own suggested rows on the Statement, named after it ("Sam – Salary", "The flat – Rent or mortgage"). More can be added later under Household.</p>
        </div>
        <div className="space-y-2">
          <Label>Adults</Label>
          <p className="text-xs text-muted-foreground">{ENTITY_KIND_HELP.adult} Blank names are skipped.</p>
          {d.adults.map((name, i) => (
            <div key={i} className="flex items-center gap-2">
              <Input aria-label={`Adult ${i + 1} name`} className="sm:w-64" value={name} placeholder={`Adult ${i + 1}`} onChange={(e) => patch({ adults: d.adults.map((x, j) => (j === i ? e.target.value : x)) })} />
              <Button size="icon" variant="ghost" aria-label={`Remove adult ${i + 1}`} disabled={d.adults.length === 1} onClick={() => patch({ adults: d.adults.filter((_, j) => j !== i) })}><Trash2 /></Button>
            </div>
          ))}
          <Button size="sm" variant="outline" onClick={() => patch({ adults: [...d.adults, ''] })}>Add adult</Button>
        </div>
        <div className="space-y-2">
          <Label>Children, pets, cars, homes</Label>
          {d.things.map((t, i) => (
            <div key={i} className="space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <NativeSelect aria-label={`Kind of person or thing ${i + 1}`} value={t.kind} onChange={(e) => setThing(i, { kind: e.target.value as ThingKind })}>
                  {THING_KINDS.map((k) => <option key={k} value={k}>{ENTITY_KIND_LABEL[k]}</option>)}
                </NativeSelect>
                <Input aria-label={`${ENTITY_KIND_LABEL[t.kind]} name`} className="w-52" value={t.name} placeholder={t.kind === 'property' ? 'e.g. The flat' : t.kind === 'vehicle' ? 'e.g. The car' : 'Name'} onChange={(e) => setThing(i, { name: e.target.value })} />
                <Button size="icon" variant="ghost" aria-label={`Remove ${t.name.trim() || ENTITY_KIND_LABEL[t.kind].toLowerCase()}`} onClick={() => patch({ things: d.things.filter((_, j) => j !== i) })}><Trash2 /></Button>
              </div>
              <p className="text-xs text-muted-foreground">{firstSentence(ENTITY_KIND_HELP[t.kind])}</p>
            </div>
          ))}
          <div className="flex flex-wrap gap-2">
            {THING_KINDS.map((k) => (
              <Button key={k} size="sm" variant="outline" title={ENTITY_KIND_HELP[k]} onClick={() => patch({ things: [...d.things, { kind: k, name: '' }] })}>Add {ENTITY_KIND_LABEL[k].toLowerCase()}</Button>
            ))}
          </div>
        </div>
        {twice.length > 0 && <p role="alert" className="text-xs text-destructive">{twice.map((n) => `"${n}"`).join(', ')} {twice.length === 1 ? 'is' : 'are'} used more than once. Rows are named after the person or thing they belong to, so give each a name of its own.</p>}
      </div>

      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-3">
        <p className="text-xs text-muted-foreground" data-testid="start-summary">
          Makes {kept.adults.join(', ')}{kept.things.length ? `, ${kept.things.map((t) => t.name).join(', ')}` : ''} and the usual expense categories. Nothing else yet.
        </p>
        <Button onClick={() => void create()} disabled={busy || twice.length > 0}>Open the Statement</Button>
      </div>
    </Island>
  )
}
