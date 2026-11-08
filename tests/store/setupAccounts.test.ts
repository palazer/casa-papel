import { describe, expect, it } from 'vitest'
import { buildSetupMutations } from '@/store'
import type { Account } from '@/model'

describe('setup wizard accounts', () => {
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
