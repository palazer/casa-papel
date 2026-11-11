import { describe, expect, it } from 'vitest'
import { buildSetupMutations } from '@/store'
import type { Account } from '@/model'

describe('setup: accounts', () => {
  it('an account keeps the currency it was given; the others take the household currency', () => {
    const { mutations, household } = buildSetupMutations({
      household: { name: 'T', baseCurrency: 'EUR', locale: 'en-IE', startMonth: '2026-11' },
      adults: [{ name: 'A' }],
      dependents: [],
      accounts: [{ name: 'Main', type: 'checking' }, { name: 'Broker', type: 'investment', currency: 'USD', openingBalance: 1000000 }],
      householdTemplates: [],
      entityTemplates: {},
    })
    const accounts = mutations.filter((m) => m.table === 'accounts').map((m) => (m as unknown as { record: Account }).record)
    expect(accounts.find((a) => a.name === 'Main')).toMatchObject({ currency: 'EUR', tracked: false })
    expect(accounts.find((a) => a.name === 'Broker')).toMatchObject({ currency: 'USD', openingBalance: 1000000, openingMonth: household.startMonth, tracked: true })
  })
})

describe('setup: owners, destinations, first amounts, deposits and own rows', () => {
  const input = {
    household: { name: 'T', baseCurrency: 'EUR', locale: 'en-IE', startMonth: '2026-11' },
    adults: [{ name: 'A' }],
    dependents: [{ kind: 'child' as const, name: 'Kid' }],
    accounts: [
      { name: 'Main', type: 'checking' as const },
      { name: 'Savings', type: 'savings' as const },
      { name: 'Fund A', type: 'investment' as const, ownerIndex: 0 },
      { name: 'Kid fund', type: 'investment' as const, ownerIndex: 1 },
    ],
    householdTemplates: [{ key: 'h.groceries', amount: 50000 }, 'h.toSavings', { key: 'h.poolTravel', amount: 20000 }],
    entityTemplates: { 0: [{ key: 'a.salary', amount: 300000 }], 1: [{ key: 'c.longterm', accountIndex: 3, amount: 10000 }] },
    deposits: [{ accountIndex: 2, amount: 20000 }, { accountIndex: 3, amount: 5000 }, { accountIndex: 1, amount: 99 }],
    customRows: [{ name: 'Netflix', section: 'expense' as const, amount: 1500 }, { name: 'Piano', section: 'expense' as const, entityIndex: 1 }],
  }
  type Rec<T> = { record: T }

  it('accounts get their owner, rows their chosen account, and amounts land in the first month', () => {
    const { mutations, household } = buildSetupMutations(input)
    const entities = mutations.filter((m) => m.table === 'entities').map((m) => (m as unknown as Rec<{ id: string; name: string }>).record)
    const accounts = mutations.filter((m) => m.table === 'accounts').map((m) => (m as unknown as Rec<Account>).record)
    const rows = mutations.filter((m) => m.table === 'rows').map((m) => (m as unknown as Rec<{ id: string; name: string; kind: string; section: string; accountId: string | null; scope: string; entityTags: string[]; defaultStatus: string }>).record)
    const cells = mutations.filter((m) => m.table === 'cells').map((m) => (m as unknown as Rec<{ rowId: string; month: string; value: number }>).record)
    const byName = (n: string) => accounts.find((a) => a.name === n)!
    const id = (n: string) => entities.find((e) => e.name === n)!.id
    expect(byName('Fund A').ownerEntityId).toBe(id('A'))
    expect(byName('Kid fund').ownerEntityId).toBe(id('Kid'))
    expect(byName('Savings').ownerEntityId).toBeNull()

    const row = (n: string) => rows.find((r) => r.name === n)!
    expect(row('Kid – Long-term savings')).toMatchObject({ kind: 'to-investment', accountId: byName('Kid fund').id })
    expect(row('To Fund A')).toMatchObject({ section: 'transfer', kind: 'to-investment', accountId: byName('Fund A').id, defaultStatus: 'committed' })
    expect(row('To Kid fund').accountId).toBe(byName('Kid fund').id)
    expect(rows.find((r) => r.name === 'To Savings')).toBeUndefined() // the savings plug fills it already
    expect(row('To savings')).toMatchObject({ kind: 'to-savings', accountId: byName('Savings').id })
    expect(row('Netflix')).toMatchObject({ scope: 'shared', entityTags: [], defaultStatus: 'projected' })
    expect(row('Kid – Piano')).toMatchObject({ scope: id('Kid'), entityTags: [id('Kid')] })

    const amount = (n: string) => cells.find((c) => c.rowId === row(n).id)
    expect(amount('Groceries')).toMatchObject({ month: household.startMonth, value: 50000 })
    expect(amount('A – Salary')?.value).toBe(300000)
    expect(amount('Kid – Long-term savings')?.value).toBe(10000)
    expect(amount('To Fund A')?.value).toBe(20000)
    expect(amount('To Kid fund')?.value).toBe(5000)
    expect(amount('Netflix')?.value).toBe(1500)
    expect(amount('To savings')).toBeUndefined()
    expect(amount('Kid – Piano')).toBeUndefined()
    // a pool template's amount is the monthly set-aside: on the "To Travel" row, not on the spending row
    expect(amount('To Travel')?.value).toBe(20000)
    expect(amount('Travel')).toBeUndefined()
    expect(cells).toHaveLength(7)
  })

  it('a chosen account of the wrong type falls back to the first of the right type; a savings deposit is typed when the user decides the savings amount', () => {
    const { mutations } = buildSetupMutations({
      ...input,
      household: { ...input.household, closingRule: 'leftover-plug' },
      entityTemplates: { 0: [], 1: [{ key: 'c.longterm', accountIndex: 1 }] },
      householdTemplates: [],
      customRows: [],
    })
    const accounts = mutations.filter((m) => m.table === 'accounts').map((m) => (m as unknown as Rec<Account>).record)
    const rows = mutations.filter((m) => m.table === 'rows').map((m) => (m as unknown as Rec<{ name: string; kind: string; accountId: string | null }>).record)
    expect(rows.find((r) => r.name === 'Kid – Long-term savings')?.accountId).toBe(accounts.find((a) => a.name === 'Fund A')!.id)
    expect(rows.find((r) => r.name === 'To Savings')).toMatchObject({ kind: 'to-savings', accountId: accounts.find((a) => a.name === 'Savings')!.id })
  })
})
