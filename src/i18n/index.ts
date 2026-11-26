import { en } from './en'

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
export type Messages = typeof en

/** The languages the app speaks. */
export type Lang = 'en'

/** The language of this page. */
export const lang: Lang = 'en'

/** The catalogue of this page's language. */
export const txt: Messages = en

/** A label in lower case, by the rules of the page's language (plain lower-casing gets the Turkish İ and ı wrong). */
export const lower = (text: string): string => text.toLocaleLowerCase(lang)
