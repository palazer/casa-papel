import { describe, expect, it } from 'vitest'
import { buildSetupMutations } from '@/store'
import { keptEntities, recommended, toSetupInput, type Draft } from '@/features/setup/draft'

const base: Draft = {
  name: 'T', currency: 'EUR', locale: 'en-IE', startMonth: '2026-11', closingRule: 'savings-plug', moneyMode: 'pooled', pocketTotal: '',
  adults: [{ name: '' }, { name: 'Bo' }],
  dependents: [{ kind: 'child', name: 'Cal', paidByIndex: 1 }, { kind: 'pet', name: '', paidByIndex: null }],
  accounts: [],
  householdTemplates: new Set(),
  entityTemplates: { 0: new Set(['a.extra']), 1: new Set(['a.salary', 'a.personal']), 2: new Set(['c.benefit']), 3: new Set(['p.vet']) },
  customRows: [],
}

describe('the wizard draft', () => {
  it('keeps only named people and things, and carries their templates and "paid by" onto the kept list', () => {
    expect(keptEntities(base).map((e) => [e.at, e.name])).toEqual([[1, 'Bo'], [2, 'Cal']])
    const input = toSetupInput(base)
    expect(input.adults).toEqual([{ name: 'Bo' }])
    expect(input.dependents).toEqual([{ kind: 'child', name: 'Cal', paidByIndex: 0 }])
    expect(input.entityTemplates).toEqual({ 0: ['a.salary', 'a.personal'], 1: ['c.benefit'] })
    // and the store creates exactly those rows, named subject first
    const names = buildSetupMutations(input).mutations.filter((m) => m.table === 'rows').map((m) => (m as unknown as { record: { name: string } }).record.name)
    expect(names).toEqual(['Bo – Salary', 'Bo – Personal', 'Cal – Child benefit'])
  })
  it('a household with no named adult gets "Me" with the first adult slot\'s templates', () => {
    const d = { ...base, adults: [{ name: '' }, { name: '' }], dependents: [] }
    expect(keptEntities(d)).toEqual([{ at: 0, kind: 'adult', name: 'Me' }])
    expect(toSetupInput(d).entityTemplates).toEqual({ 0: ['a.extra'] })
    expect(toSetupInput({ ...d, entityTemplates: {} }).entityTemplates).toEqual({ 0: [...recommended('adult')] })
  })
})
