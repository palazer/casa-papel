import { describe, expect, it } from 'vitest'
import { RAIL, SCREENS, SETTINGS_PAGES, groupOf, isUtility, screenDef, type Screen } from '@/app/screens'

describe('screens and the rail', () => {
  it('the rail covers every screen exactly once: four pages, then the Settings group', () => {
    const keys = RAIL.flatMap((it) => (it.kind === 'page' ? [it.key] : it.pages))
    expect(keys).toEqual(SCREENS.map((s) => s.key))
    expect(RAIL.map((it) => it.kind)).toEqual(['page', 'page', 'page', 'page', 'group'])
    expect(screenDef('statement').label).toBe('Statement')
    expect(SETTINGS_PAGES).toEqual(['household', 'data', 'guide'])
    expect(screenDef('guide').label).toBe('Guide')
  })
  it('knows which screens live under Settings', () => {
    const grouped: Record<Screen, 'settings' | null> = { statement: null, grid: null, month: null, moves: null, household: 'settings', data: 'settings', guide: 'settings' }
    for (const [k, v] of Object.entries(grouped)) expect(groupOf(k as Screen)).toBe(v)
  })
  it('Data and the Guide are the utilities: they open without a household and are never the screen to land on', () => {
    expect(SCREENS.filter((s) => s.utility).map((s) => s.key)).toEqual(['data', 'guide'])
    expect(isUtility('guide')).toBe(true)
    expect(isUtility('household')).toBe(false)
  })
})
