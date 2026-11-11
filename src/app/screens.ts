import { createContext, useContext } from 'react'
import { BookOpen, Database, Scale, Settings, Table2, Users, type LucideIcon } from 'lucide-react'
import { readPref, writePref } from './prefs'

export type Screen = 'statement' | 'grid' | 'household' | 'data' | 'guide'

export interface ScreenDef {
  key: Screen
  label: string
  icon: LucideIcon
  /** A utility, not a place to land: it opens without a household and is never remembered as the screen to return to. */
  utility?: boolean
}

/** Every screen, in rail order; the last three are the Settings group's pages. */
export const SCREENS: ScreenDef[] = [
  { key: 'statement', label: 'Statement', icon: Scale },
  { key: 'grid', label: 'Grid', icon: Table2 },
  { key: 'household', label: 'Household', icon: Users },
  { key: 'data', label: 'Data', icon: Database, utility: true },
  { key: 'guide', label: 'Guide', icon: BookOpen, utility: true },
]

export const screenDef = (s: Screen): ScreenDef => SCREENS.find((d) => d.key === s) ?? SCREENS[0]

/** Data and the Guide: they work without a household and a fresh visit never lands on them. */
export const isUtility = (s: Screen): boolean => !!screenDef(s).utility

/** The pages behind the rail's Settings entry, in order. */
export const SETTINGS_PAGES: Screen[] = ['household', 'data', 'guide']

export type RailItem = { kind: 'page'; key: Screen } | { kind: 'group'; key: 'settings'; label: string; icon: LucideIcon; pages: Screen[] }

/** The rail and the phone bar (DESIGN.md §2): the Statement and the Grid, then Settings, which groups Household, Data and the Guide. */
export const RAIL: RailItem[] = [
  { kind: 'page', key: 'statement' },
  { kind: 'page', key: 'grid' },
  { kind: 'group', key: 'settings', label: 'Settings', icon: Settings, pages: SETTINGS_PAGES },
]

export const groupOf = (s: Screen): 'settings' | null => (SETTINGS_PAGES.includes(s) ? 'settings' : null)

export const isScreen = (s: unknown): s is Screen => SCREENS.some((d) => d.key === s)

/**
 * `?screen=` wins, then the screen open last on this device, then the Statement: the first screen on every device. A
 * remembered screen that no longer exists (the Month view, Moves) falls back to it too.
 */
export function readScreen(): Screen {
  const fromUrl = new URLSearchParams(window.location.search).get('screen')
  if (isScreen(fromUrl)) return fromUrl
  const stored = readPref<string | null>('screen', null)
  if (isScreen(stored)) return stored
  return 'statement'
}

/**
 * The address of a screen, keeping every other parameter (`?demo=1` picks the database). The hash is kept too, unless
 * it names a Guide topic (`#guide-…`) and the screen is not the Guide; `hash` sets it outright (the legend's jump).
 */
export function screenHref(s: Screen, hash?: string): string {
  const params = new URLSearchParams(window.location.search)
  params.set('screen', s)
  const current = window.location.hash
  const kept = hash ?? (current.startsWith('#guide-') && s !== 'guide' ? '' : current)
  return `${window.location.pathname}?${params.toString()}${kept}`
}

/** The Settings page open last on this device (Household at first): the group's tile and the phone tab return to it. */
export function settingsPage(): Screen {
  const stored = readPref<string | null>('settings.page', null)
  return isScreen(stored) && groupOf(stored) ? stored : 'household'
}

/** Whether the rail shows the Settings pages; unfolded until someone folds it. */
export const settingsOpen = (): boolean => readPref<boolean>('settings.open', true)
export const setSettingsOpen = (open: boolean): void => writePref('settings.open', open)

/**
 * Remember the open screen and let the address bar follow, so every screen is bookmarkable and Back never walks through
 * screen changes. Utility screens (Data, the Guide) are not places to land: a reload keeps them through the address, a
 * fresh visit opens the household (or the welcome screen when there is none). The Settings group remembers its own
 * page, so its tile returns to it. `hash` names a spot on the new screen (a Guide topic).
 */
export function rememberScreen(s: Screen, hash?: string): void {
  if (!isUtility(s)) writePref('screen', s)
  if (groupOf(s)) writePref('settings.page', s)
  window.history.replaceState(null, '', screenHref(s, hash))
}

/**
 * A month one screen hands to the Statement ("Open in the Statement" in the Grid). The Statement opens on it and
 * clears it once it is on screen, so a later visit starts on the current month again.
 */
let handedMonth: string | null = null
export const handMonth = (month: string): void => { handedMonth = month }
export const handedOverMonth = (): string | null => handedMonth
export const clearHandedMonth = (): void => { handedMonth = null }

export const ScreenContext = createContext<{ screen: Screen; go: (s: Screen, hash?: string) => void }>({ screen: 'statement', go: () => undefined })
export const useScreen = () => useContext(ScreenContext)
