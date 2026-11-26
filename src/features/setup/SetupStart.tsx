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
import { saveError } from '@/app/saveError'
import { lower, txt } from '@/i18n'

const T = txt.setup.form

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
      setError(saveError(e, T.couldNotSetUp))
      setBusy(false)
    }
  }

  return (
    <Island
      air title={T.setUpYourHousehold} className="mx-auto max-w-2xl" bodyClassName="space-y-5"
      description={T.aFewFactsFirst}
      right={onBack ? <Button size="xs" variant="ghost" onClick={onBack}>{T.backToStart}</Button> : undefined}
    >
      {notice && <p className="text-xs text-muted-foreground">{notice}</p>}
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="s-name">{T.householdName}</Label>
          <Input id="s-name" autoFocus value={d.name} onChange={(e) => patch({ name: e.target.value })} placeholder={T.ourHousehold} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="s-ccy">{txt.common.currency}</Label>
          <NativeSelect id="s-ccy" className="w-full" value={d.currency} onChange={(e) => patch({ currency: e.target.value })}>{CURRENCIES.map((c) => <option key={c}>{c}</option>)}</NativeSelect>
          <p className="text-xs text-muted-foreground">{T.whatTheHouseholdCounts}</p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="s-locale">{T.numberAndDateFormat}</Label>
          <NativeSelect id="s-locale" className="w-full" value={d.locale} onChange={(e) => patch({ locale: e.target.value })}>
            {LOCALES.map((l) => <option key={l} value={l}>{localeLabel(l)} — {localeExample(l)}</option>)}
          </NativeSelect>
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="s-start">{T.firstMonth}</Label>
          <MonthField id="s-start" label={T.firstMonth} value={d.startMonth} onChange={(m) => patch({ startMonth: m })} locale={d.locale} />
          <p className="text-xs text-muted-foreground">{T.theFirstMonthYou}</p>
        </div>
      </div>

      <div className="space-y-4">
        <div>
          <h3 className="text-sm font-semibold">{T.peopleThings}</h3>
          <p className="text-xs text-muted-foreground">{T.whoLivesOnThis}</p>
        </div>
        <div className="space-y-2">
          <Label>{T.adults}</Label>
          <p className="text-xs text-muted-foreground">{T.adultsHelp(ENTITY_KIND_HELP.adult)}</p>
          {d.adults.map((name, i) => (
            <div key={i} className="flex items-center gap-2">
              <Input aria-label={T.adultName(i)} className="sm:w-64" value={name} placeholder={T.adult(i)} onChange={(e) => patch({ adults: d.adults.map((x, j) => (j === i ? e.target.value : x)) })} />
              <Button size="icon" variant="ghost" aria-label={T.removeAdult(i)} disabled={d.adults.length === 1} onClick={() => patch({ adults: d.adults.filter((_, j) => j !== i) })}><Trash2 /></Button>
            </div>
          ))}
          <Button size="sm" variant="outline" onClick={() => patch({ adults: [...d.adults, ''] })}>{T.addAdult}</Button>
        </div>
        <div className="space-y-2">
          <Label>{T.childrenPetsCarsHomes}</Label>
          {d.things.map((t, i) => (
            <div key={i} className="space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <NativeSelect aria-label={T.kindOfPersonOr(i)} value={t.kind} onChange={(e) => setThing(i, { kind: e.target.value as ThingKind })}>
                  {THING_KINDS.map((k) => <option key={k} value={k}>{ENTITY_KIND_LABEL[k]}</option>)}
                </NativeSelect>
                <Input aria-label={T.nameOf(ENTITY_KIND_LABEL[t.kind])} className="w-52" value={t.name} placeholder={t.kind === 'property' ? T.eGTheFlat : t.kind === 'vehicle' ? T.eGTheCar : txt.common.name} onChange={(e) => setThing(i, { name: e.target.value })} />
                <Button size="icon" variant="ghost" aria-label={T.removeThing(t.name.trim(), lower(ENTITY_KIND_LABEL[t.kind]))} onClick={() => patch({ things: d.things.filter((_, j) => j !== i) })}><Trash2 /></Button>
              </div>
              <p className="text-xs text-muted-foreground">{firstSentence(ENTITY_KIND_HELP[t.kind])}</p>
            </div>
          ))}
          <div className="flex flex-wrap gap-2">
            {THING_KINDS.map((k) => (
              <Button key={k} size="sm" variant="outline" title={ENTITY_KIND_HELP[k]} onClick={() => patch({ things: [...d.things, { kind: k, name: '' }] })}>{T.addKind(lower(ENTITY_KIND_LABEL[k]))}</Button>
            ))}
          </div>
        </div>
        {twice.length > 0 && <p role="alert" className="text-xs text-destructive">{T.usedMoreThanOnce(twice.map((n) => `"${n}"`).join(', '), twice.length)}</p>}
      </div>

      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-3">
        <p className="text-xs text-muted-foreground" data-testid="start-summary">
          {T.makesAndTheUsual(kept.adults.join(', '), kept.things.length, kept.things.map((t) => t.name).join(', '))}
        </p>
        <Button onClick={() => void create()} disabled={busy || twice.length > 0}>{T.openTheStatement}</Button>
      </div>
    </Island>
  )
}
