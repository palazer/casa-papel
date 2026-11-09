import { describe, expect, it } from 'vitest'
import { computeEngine } from '@/engine'
import { account, cellValue, household, row, tables } from './helpers'

const months = ['2026-01', '2026-02', '2026-03']

describe('missing-rate warnings', () => {
  it('come once per row, once per account balance and once per account\'s deposits, not once per month', () => {
    const broker = account({ name: 'Broker', type: 'investment', currency: 'USD', openingBalance: 0 })
    const deposits = row({ name: 'To broker', section: 'transfer', kind: 'to-investment', accountId: broker.id })
    const bonus = row({ name: 'Bonus', section: 'income', currency: 'USD', order: 'a1' })
    const t = tables({ household: [household()], accounts: [broker], rows: [deposits, bonus], cells: [cellValue(deposits.id, '2026-01', 10000), cellValue(bonus.id, '2026-01', 50000)] })
    const { warnings } = computeEngine({ tables: t, months })
    expect(warnings.filter((w) => w.includes('(Bonus)'))).toEqual(['No USD→EUR rate for 2026-01 (Bonus)'])
    expect(warnings.filter((w) => w.includes('(Broker)')).sort()).toEqual(['No EUR→USD rate for 2026-01 (Broker)', 'No USD→EUR rate for 2026-01 (Broker)'])
  })
})
