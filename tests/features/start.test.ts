import { describe, expect, it } from 'vitest'
import { computeEngine } from '@/engine'
import { newId } from '@/model'
import { CasaDb, Store, createHouseholdFromSetup, loadTables, rowSuggestions, setupSteps } from '@/store'
import { duplicateNames, keptStart, newStart, toSetupInput, type StartDraft } from '@/features/setup/start'

const draft = (over: Partial<StartDraft> = {}): StartDraft => ({ ...newStart('2026-09', 'de-DE'), ...over })

describe('the first screen of a new household', () => {
  it('starts with two adults to name, in the browser\'s own format when the app has it', () => {
    expect(newStart('2026-09', 'de-DE')).toEqual({ name: '', currency: 'EUR', locale: 'de-DE', startMonth: '2026-09', adults: ['', ''], things: [] })
    expect(newStart('2026-09', 'xx-XX').locale).toBe('en-IE')
  })

  it('keeps the named people and things; a household with no named adult gets "Me"', () => {
    expect(keptStart(draft())).toEqual({ adults: ['Me'], things: [] })
    const d = draft({ adults: [' Sam ', '', 'Alex'], things: [{ kind: 'child', name: 'Robin' }, { kind: 'pet', name: '  ' }, { kind: 'property', name: 'The flat' }] })
    expect(keptStart(d)).toEqual({ adults: ['Sam', 'Alex'], things: [{ kind: 'child', name: 'Robin' }, { kind: 'property', name: 'The flat' }] })
  })

  it('names a name that is used twice, whatever its case', () => {
    expect(duplicateNames(draft({ adults: ['Sam', 'Alex'] }))).toEqual([])
    expect(duplicateNames(draft({ adults: ['Sam', 'sam '], things: [{ kind: 'pet', name: 'Rex' }, { kind: 'vehicle', name: 'REX' }] }))).toEqual(['Sam', 'Rex'])
  })

  it('hands the store the facts and nothing else: no accounts, no rows, nothing taking the rest, the strip showing', async () => {
    const input = toSetupInput(draft({ name: ' Home ', currency: 'CHF', adults: ['Sam', 'Alex'], things: [{ kind: 'child', name: 'Robin' }] }))
    expect(input.household).toEqual({ name: 'Home', baseCurrency: 'CHF', locale: 'de-DE', startMonth: '2026-09', closingRule: 'leftover-plug', setupOpen: true })
    expect(input).toMatchObject({ adults: [{ name: 'Sam' }, { name: 'Alex' }], dependents: [{ kind: 'child', name: 'Robin' }], accounts: [], householdTemplates: [], entityTemplates: {} })
    expect(toSetupInput(draft()).household.name).toBe('Our household')

    const store = new Store(new CasaDb(`test-${newId()}`))
    await createHouseholdFromSetup(store, input)
    const t = await loadTables(store)
    expect(t.household[0]).toMatchObject({ setupOpen: true, closingRule: 'leftover-plug', moneyMode: 'pooled', pocketTotal: 0, dismissedSuggestions: [] })
    expect(t.entities.map((e) => [e.kind, e.name])).toEqual([['adult', 'Sam'], ['adult', 'Alex'], ['child', 'Robin']])
    expect(t.categories.map((c) => c.name)).toEqual(['Housing', 'Living', 'Transport', 'Family & pets', 'Fun', 'Personal'])
    expect([t.accounts.length, t.rows.length, t.cells.length, t.pools.length, t.goals.length]).toEqual([0, 0, 0, 0, 0])
    // the page it opens on has everything still to do, and something to offer for everyone
    expect(setupSteps(t).filter((s) => s.done)).toEqual([])
    expect(rowSuggestions(t).filter((s) => s.usual && s.place === 'income').map((s) => s.title)).toEqual(['Sam – Salary', 'Alex – Salary', 'Robin – Child benefit', 'Other income'])
    // and an empty first month is a sound one: nothing in, nothing out
    const month = computeEngine({ tables: t, months: ['2026-09'] }).totals['2026-09']
    expect(month).toMatchObject({ income: 0, leftover: 0, rest: null })
  })
})
