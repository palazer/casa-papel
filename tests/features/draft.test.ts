import { describe, expect, it } from 'vitest'
import { buildSetupMutations } from '@/store'
import { defaultLink, depositTargets, keptEntities, recommended, templatesFor, toSetupInput, validate, type Draft } from '@/features/setup/draft'

const base: Draft = {
  name: 'T', currency: 'EUR', locale: 'en-IE', startMonth: '2026-11', closingRule: 'savings-plug', moneyMode: 'pooled', pocketTotal: '',
  adults: [{ name: '' }, { name: 'Bo' }],
  dependents: [{ kind: 'child', name: 'Cal', paidByIndex: 1 }, { kind: 'pet', name: '', paidByIndex: null }],
  accounts: [],
  householdTemplates: new Set(),
  entityTemplates: { 0: new Set(['a.extra']), 1: new Set(['a.salary', 'a.personal']), 2: new Set(['c.benefit']), 3: new Set(['p.vet']) },
  depositsOff: new Set(),
  amounts: {},
  links: {},
  customRows: [],
}
const acc = (name: string, type: Draft['accounts'][number]['type'], ownerAt: number | null = null): Draft['accounts'][number] => ({ name, type, openingBalance: '', currency: null, ownerAt })

describe('the wizard draft', () => {
  it('keeps only named people and things, and carries their templates and "paid by" onto the kept list', () => {
    expect(keptEntities(base).map((e) => [e.at, e.name])).toEqual([[1, 'Bo'], [2, 'Cal']])
    const input = toSetupInput(base)
    expect(input.adults).toEqual([{ name: 'Bo' }])
    expect(input.dependents).toEqual([{ kind: 'child', name: 'Cal', paidByIndex: 0 }])
    expect(input.entityTemplates).toEqual({ 0: [{ key: 'a.salary', amount: null }, { key: 'a.personal', amount: null }], 1: [{ key: 'c.benefit', amount: null }] })
    // and the store creates exactly those rows, named subject first
    const names = buildSetupMutations(input).mutations.filter((m) => m.table === 'rows').map((m) => (m as unknown as { record: { name: string } }).record.name)
    expect(names).toEqual(['Bo – Salary', 'Bo – Personal', 'Cal – Child benefit'])
  })

  it('a household with no named adult gets "Me" with the first adult slot\'s templates', () => {
    const d = { ...base, adults: [{ name: '' }, { name: '' }], dependents: [] }
    expect(keptEntities(d)).toEqual([{ at: 0, kind: 'adult', name: 'Me' }])
    expect(toSetupInput(d).entityTemplates[0].map((c) => (typeof c === 'string' ? c : c.key))).toEqual(['a.extra'])
    expect(toSetupInput({ ...d, entityTemplates: {} }).entityTemplates[0].map((c) => (typeof c === 'string' ? c : c.key))).toEqual([...recommended('adult')])
  })

  it('deposit rows replace "To investments": one per investment account, savings too when the user decides the amount', () => {
    const d: Draft = { ...base, accounts: [acc('Main', 'checking'), acc('Savings', 'savings'), acc('Fund', 'investment'), acc('', 'investment')] }
    expect(templatesFor(d, null).map((t) => t.key)).not.toContain('h.toInvestments')
    expect(templatesFor(d, null).map((t) => t.key)).toContain('h.toSavings')
    expect(depositTargets(d).map((x) => x.account.name)).toEqual(['Fund'])
    const leftover: Draft = { ...d, closingRule: 'leftover-plug' }
    expect(templatesFor(leftover, null).map((t) => t.key)).not.toContain('h.toSavings')
    expect(depositTargets(leftover).map((x) => x.account.name)).toEqual(['Savings', 'Fund'])
    // unticked deposits stay out; blank accounts never count, so indexes point into the named list
    const input = toSetupInput({ ...leftover, depositsOff: new Set([1]), amounts: { 'dep:2': '250' } })
    expect(input.deposits).toEqual([{ accountIndex: 2, amount: 25000 }])
  })

  it('a row that needs an account points at the subject\'s own account first, then the first of the type', () => {
    const d: Draft = {
      ...base,
      accounts: [acc('Fund A', 'investment', 1), acc('Cal fund', 'investment', 2)],
      entityTemplates: { ...base.entityTemplates, 2: new Set(['c.benefit', 'c.longterm']) },
    }
    expect(defaultLink(d, 2, 'investment')).toBe(1)
    expect(defaultLink(d, 1, 'investment')).toBe(0)
    expect(defaultLink(d, 'h', 'investment')).toBe(0)
    expect(toSetupInput(d).entityTemplates[1]).toContainEqual({ key: 'c.longterm', accountIndex: 1, amount: null })
    // a chosen account wins while it exists and fits
    expect(toSetupInput({ ...d, links: { '2:c.longterm': 0 } }).entityTemplates[1]).toContainEqual({ key: 'c.longterm', accountIndex: 0, amount: null })
    expect(toSetupInput({ ...d, links: { '2:c.longterm': 7 } }).entityTemplates[1]).toContainEqual({ key: 'c.longterm', accountIndex: 1, amount: null })
    // owners travel as indexes into the kept entities
    expect(toSetupInput(d).accounts.map((a) => a.ownerIndex)).toEqual([0, 1])
  })

  it('amounts are parsed in the household currency, automatic rows take none, and bad numbers are reported by row', () => {
    const d: Draft = {
      ...base,
      householdTemplates: new Set(['h.groceries', 'h.toSavings']),
      accounts: [acc('Savings', 'savings')],
      amounts: { 'h:h.groceries': '600', 'h:h.toSavings': '999', '1:a.salary': '3,200.50' },
      customRows: [{ subject: 0, name: 'Garden', section: 'expense', amount: '40' }, { subject: 2, name: 'Piano', section: 'expense', amount: 'abc' }],
    }
    const input = toSetupInput(d)
    expect(input.householdTemplates).toEqual([{ key: 'h.groceries', amount: 60000 }, { key: 'h.toSavings', accountIndex: 0, amount: null }])
    expect(input.entityTemplates[0]).toContainEqual({ key: 'a.salary', amount: 320050 })
    expect(input.customRows).toEqual([{ name: 'Garden', section: 'expense', entityIndex: null, amount: 4000 }, { name: 'Piano', section: 'expense', entityIndex: 1, amount: null }])
    expect(Object.keys(validate(d).amounts)).toEqual(['custom:1'])
    expect(Object.keys(validate({ ...d, amounts: { ...d.amounts, 'h:h.groceries': 'x' } }).amounts)).toEqual(['h:h.groceries', 'custom:1'])
  })
})
