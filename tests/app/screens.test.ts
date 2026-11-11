import { afterEach, describe, expect, it, vi } from 'vitest'
import { RAIL, SCREENS, SETTINGS_PAGES, groupOf, isScreen, isUtility, readScreen, screenDef, type Screen } from '@/app/screens'

describe('screens and the rail', () => {
  it('the rail covers every screen exactly once: the Statement and the Grid, then the Settings group', () => {
    const keys = RAIL.flatMap((it) => (it.kind === 'page' ? [it.key] : it.pages))
    expect(keys).toEqual(SCREENS.map((s) => s.key))
    expect(keys).toEqual(['statement', 'grid', 'household', 'data', 'guide'])
    expect(RAIL.map((it) => it.kind)).toEqual(['page', 'page', 'group'])
    expect(screenDef('statement').label).toBe('Statement')
    expect(SETTINGS_PAGES).toEqual(['household', 'data', 'guide'])
    expect(screenDef('guide').label).toBe('Guide')
  })
  it('knows which screens live under Settings', () => {
    const grouped: Record<Screen, 'settings' | null> = { statement: null, grid: null, household: 'settings', data: 'settings', guide: 'settings' }
    for (const [k, v] of Object.entries(grouped)) expect(groupOf(k as Screen)).toBe(v)
  })
  it('Data and the Guide are the utilities: they open without a household and are never the screen to land on', () => {
    expect(SCREENS.filter((s) => s.utility).map((s) => s.key)).toEqual(['data', 'guide'])
    expect(isUtility('guide')).toBe(true)
    expect(isUtility('household')).toBe(false)
  })
  it('the Month view and Moves are gone', () => {
    expect(isScreen('month')).toBe(false)
    expect(isScreen('moves')).toBe(false)
  })
})

describe('the first screen', () => {
  /** The app as it starts with this address and this screen remembered on the device. */
  function start(search: string, remembered: string | null): Screen {
    vi.stubGlobal('window', {
      location: { search },
      localStorage: { getItem: (key: string) => (key === 'casa.screen' && remembered != null ? JSON.stringify(remembered) : null) },
    })
    return readScreen()
  }
  afterEach(() => vi.unstubAllGlobals())

  it('is the Statement when nothing says otherwise', () => {
    expect(start('', null)).toBe('statement')
    expect(start('?demo=1', null)).toBe('statement')
  })
  it('is the screen open last on this device, and the address wins over it', () => {
    expect(start('', 'grid')).toBe('grid')
    expect(start('?demo=1&screen=grid', 'household')).toBe('grid')
  })
  it('a remembered or bookmarked screen that no longer exists opens the Statement', () => {
    expect(start('', 'month')).toBe('statement')
    expect(start('', 'moves')).toBe('statement')
    expect(start('?screen=month', null)).toBe('statement')
    expect(start('?screen=moves', 'grid')).toBe('grid')
  })
})
