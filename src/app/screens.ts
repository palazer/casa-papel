import { createContext, useContext } from 'react'
import { ArrowLeftRight, CalendarDays, Database, Table2, Users, type LucideIcon } from 'lucide-react'
import { readPref, writePref } from './prefs'

export type Screen = 'grid' | 'month' | 'moves' | 'household' | 'data'

export interface ScreenDef {
  key: Screen
  label: string
  icon: LucideIcon
}

/** The five screens, in rail order. */
export const SCREENS: ScreenDef[] = [
  { key: 'grid', label: 'Grid', icon: Table2 },
  { key: 'month', label: 'Month', icon: CalendarDays },
  { key: 'moves', label: 'Moves', icon: ArrowLeftRight },
  { key: 'household', label: 'Household', icon: Users },
  { key: 'data', label: 'Data', icon: Database },
]

export const isScreen = (s: unknown): s is Screen => SCREENS.some((d) => d.key === s)

/** Under 768 px the app is the phone app: the Month view opens first and the bottom tabs replace the rail. */
export const isPhone = (): boolean => typeof window !== 'undefined' && window.innerWidth < 768

/** `?screen=` wins, then the screen open last on this device, then the device's natural first screen. */
export function readScreen(): Screen {
  const fromUrl = new URLSearchParams(window.location.search).get('screen')
  if (isScreen(fromUrl)) return fromUrl
  const stored = readPref<string | null>('screen', null)
  if (isScreen(stored)) return stored
  return isPhone() ? 'month' : 'grid'
}

/** The address of a screen, keeping every other parameter (`?demo=1` picks the database). */
export function screenHref(s: Screen): string {
  const params = new URLSearchParams(window.location.search)
  params.set('screen', s)
  return `${window.location.pathname}?${params.toString()}${window.location.hash}`
}

/**
 * Remember the open screen and let the address bar follow, so every screen is bookmarkable and Back never walks through
 * screen changes. Data is a utility screen, not a place to land: a reload keeps it through the address, a fresh visit
 * opens the household (or the welcome screen when there is none).
 */
export function rememberScreen(s: Screen): void {
  if (s !== 'data') writePref('screen', s)
  window.history.replaceState(null, '', screenHref(s))
}

export const ScreenContext = createContext<{ screen: Screen; go: (s: Screen) => void }>({ screen: 'grid', go: () => undefined })
export const useScreen = () => useContext(ScreenContext)
