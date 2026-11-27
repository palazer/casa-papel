import type { EntityKind, MonthKey } from '@/model'
import type { SetupInput } from '@/store'
import { foldName, lang, txt } from '@/i18n'

const T = txt.setup.start

/**
 * The first screen of a new household: the facts the Statement needs before it can open. The format, the first
 * month, and who and what the household is. Everything else (accounts, rows, rules, goals) is added on the
 * Statement, where it will show. This is the pure part; `SetupStart.tsx` is the screen.
 */
export type ThingKind = Exclude<EntityKind, 'adult'>

export interface StartDraft {
  name: string
  currency: string
  locale: string
  startMonth: MonthKey
  adults: string[]
  things: Array<{ kind: ThingKind; name: string }>
}

export const LOCALES = ['en-IE', 'en-GB', 'en-US', 'de-DE', 'de-AT', 'tr-TR', 'fr-FR', 'es-ES', 'nl-NL', 'it-IT', 'pt-PT', 'sv-SE']
export const THING_KINDS: ThingKind[] = ['child', 'pet', 'vehicle', 'property', 'company', 'other']

/**
 * A fresh draft: two adults to name, nothing else; the browser's own format when the app has it. A device that
 * speaks Turkish starts with the Turkish format and the lira; both can be changed on the form.
 */
export function newStart(today: MonthKey, language: string, turkish = lang === 'tr'): StartDraft {
  const locale = turkish ? 'tr-TR' : LOCALES.includes(language) ? language : 'en-IE'
  return { name: '', currency: turkish ? 'TRY' : 'EUR', locale, startMonth: today, adults: ['', ''], things: [] }
}

const key = foldName

/** The people and things that will be made: blank names are skipped, and a household with no named adult gets "Me". */
export function keptStart(d: StartDraft): { adults: string[]; things: Array<{ kind: ThingKind; name: string }> } {
  const adults = d.adults.map((n) => n.trim()).filter(Boolean)
  return { adults: adults.length ? adults : [T.me], things: d.things.map((t) => ({ kind: t.kind, name: t.name.trim() })).filter((t) => t.name) }
}

/**
 * Names used twice. Rows are named after the person or thing they belong to ("Sam – Salary"), so two of the same
 * name would give rows nobody can tell apart.
 */
export function duplicateNames(d: StartDraft): string[] {
  const { adults, things } = keptStart(d)
  const first = new Map<string, string>()
  const twice = new Set<string>()
  for (const name of [...adults, ...things.map((t) => t.name)]) {
    const seen = first.get(key(name))
    if (seen != null) twice.add(seen)
    else first.set(key(name), name)
  }
  return [...twice]
}

/**
 * The draft as the store takes it. No accounts and no rows: those are added on the Statement. Nothing takes the rest
 * of the month until an account is given it, and the Statement shows its setup strip.
 */
export function toSetupInput(d: StartDraft): SetupInput {
  const { adults, things } = keptStart(d)
  return {
    household: { name: d.name.trim() || T.ourHousehold, baseCurrency: d.currency, locale: d.locale, startMonth: d.startMonth, closingRule: 'leftover-plug', setupOpen: true },
    adults: adults.map((name) => ({ name })),
    dependents: things,
    accounts: [],
    householdTemplates: [],
    entityTemplates: {},
  }
}
