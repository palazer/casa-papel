import { en, type Messages } from './en'
import { tr } from './tr'

/**
 * The language layer (DESIGN.md §13). Every text the app shows comes from a catalogue: `txt.statement.parts.paid`,
 * `txt.errors.archived(name)`. A text is a plain string, or a small function where a number or a name goes in, so that
 * each language words the sentence its own way.
 *
 * One language per page load: it is read once, here, when this module is first evaluated, which is before any table
 * that is built from the catalogue (`HELP`, `SCREENS`, `ACCOUNT_TYPE_INFO`, …). The calculation and the store read the
 * same catalogue as the screens, so no function takes a language. A change of language reloads the page.
 *
 * This module is a leaf: it imports types from the model and nothing else from the app.
 */
export type { Messages }

/** The languages the app speaks. */
export type Lang = 'en' | 'tr'

/** The languages as a choice names them: each in its own words, whatever the page's language is. */
export const LANGUAGES: Array<{ lang: Lang; name: string }> = [{ lang: 'en', name: 'English' }, { lang: 'tr', name: 'Türkçe' }]

const CATALOGUES: Record<Lang, Messages> = { en, tr }
const isLang = (v: unknown): v is Lang => v === 'en' || v === 'tr'

/** Where the device keeps its choice: beside the other things it remembers (`src/app/prefs.ts`), never in a household. */
const KEY = 'casa.lang'

/** The language chosen on this device, if one was. */
function chosen(): Lang | null {
  try {
    if (typeof window === 'undefined') return null
    const raw = window.localStorage.getItem(KEY)
    const value: unknown = raw == null ? null : JSON.parse(raw)
    return isLang(value) ? value : null
  } catch {
    return null
  }
}

/** The language the browser itself speaks, when the app speaks it too. Its first language counts, not the ones after it. */
function ofTheBrowser(): Lang | null {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return null
  const first = (navigator.language ?? '').split('-')[0].toLowerCase()
  return isLang(first) ? first : null
}

/** The language of this page: what was chosen on this device, else the browser's own, else English. */
export const lang: Lang = chosen() ?? ofTheBrowser() ?? 'en'

/** The catalogue of this page's language. */
export const txt: Messages = CATALOGUES[lang]

/** Sets this device's language and loads the page again in it: every table built from the catalogue is built anew. */
export function chooseLanguage(to: Lang): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(to))
  } catch {
    /* storage unavailable: the page stays as it is */
    return
  }
  window.location.reload()
}

/** A label in lower case, by the rules of the page's language (plain lower-casing gets the Turkish İ and ı wrong). */
export const lower = (text: string): string => text.toLocaleLowerCase(lang)

const formats = new Map<string, Intl.DateTimeFormat>()
function dateTimeFormat(locale: string | undefined, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = `${locale ?? ''}|${JSON.stringify(options)}`
  let format = formats.get(key)
  if (!format) formats.set(key, format = new Intl.DateTimeFormat(locale, options))
  return format
}

const languageOf = (locale: string): string => locale.split('-')[0].toLowerCase()

/**
 * A date as the household's "Number format" writes it, with the names of months and weekdays in the page's language.
 * The order of day, month and year, the digits and the signs between them are the household's; a name is a word, and
 * words are the device's. A household whose format is in the page's language is written exactly as its format says
 * ("Sept" for en-IE).
 */
export function formatDate(date: Date, locale: string, options: Intl.DateTimeFormatOptions): string {
  const own = dateTimeFormat(locale, options)
  if (languageOf(locale) === lang) return own.format(date)
  const named = dateTimeFormat(lang, options).formatToParts(date)
  return own.formatToParts(date).map((p) => (p.type === 'month' || p.type === 'weekday' ? named.find((n) => n.type === p.type)?.value ?? p.value : p.value)).join('')
}

/**
 * The locale for a date that belongs to no household (when a file was exported, when the device last synced): the
 * browser's own while it speaks the page's language, else the page's language.
 */
export function deviceLocale(): string | undefined {
  const own = typeof navigator === 'undefined' ? undefined : navigator.language
  return own && languageOf(own) === lang ? undefined : lang
}

/**
 * A name without what does not tell two names apart: the spaces around it, and its case, by a rule that holds in
 * every language the app speaks (I, İ, ı and i are one letter here, so "Living" is "LİVİNG" and "lıvıng").
 */
export const foldName = (name: string): string => name.trim().toLocaleLowerCase('en').replace(/\u0307/g, '').replace(/ı/g, 'i')

/** Whether two names are the same name. */
export const sameText = (a: string, b: string): boolean => foldName(a) === foldName(b)

/**
 * One text in every language the app speaks. For telling a name the app wrote itself ("Housing", "To Travel"),
 * whichever device wrote it: a household can be shared by an English and a Turkish device.
 */
export const inEveryLanguage = <T>(pick: (messages: Messages) => T): T[] => [en, tr].map(pick)
