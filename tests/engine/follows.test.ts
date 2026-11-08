import { describe, expect, it } from 'vitest'
import { cellKey, computeEngine } from '@/engine'
import { newId } from '@/model'
import { account, cellValue, closedMonth, household, row, tables } from './helpers'

const months = ['2026-01', '2026-02', '2026-03']

describe('rows that follow another row', () => {
  it('mirror the followed row month by month as derived cells and feed the totals', () => {
    const benefit = row({ name: 'Child benefit', section: 'income', defaultStatus: 'committed' })
    const fund = account({ name: 'Fund', type: 'investment', openingBalance: 0 })
    const longTerm = row({ name: 'Long-term savings', section: 'transfer', kind: 'to-investment', accountId: fund.id, followsRowId: benefit.id })
    const t = tables({
      household: [household()],
      rows: [longTerm, benefit],
      accounts: [fund],
      cells: [cellValue(benefit.id, '2026-01', 25500), cellValue(benefit.id, '2026-03', 26000), cellValue(longTerm.id, '2026-02', 99)],
      monthStates: [closedMonth('2026-01')],
    })
    const out = computeEngine({ tables: t, months })
    const c = (m: string) => out.cells[cellKey(longTerm.id, m)]
    expect(c('2026-01')).toMatchObject({ value: 25500, source: 'derived', status: 'done' })
    // the follower's own cell (99) is ignored while it follows; the target's inherited value wins
    expect(c('2026-02')).toMatchObject({ value: 25500, source: 'derived', status: 'derived' })
    expect(c('2026-03')).toMatchObject({ value: 26000, source: 'derived' })
    expect(out.totals['2026-02'].toInvestment).toBe(25500)
    expect(out.accounts[fund.id].months['2026-03'].capital).toBe(25500 + 25500 + 26000)
    expect(out.warnings).toEqual([])
  })

  it('works whatever the display order and takes the followed row\'s currency', () => {
    const usd = row({ name: 'Bonus', section: 'income', currency: 'USD', order: 'a1' })
    const mirror = row({ name: 'Mirror', section: 'income', followsRowId: usd.id, order: 'a0' })
    const t = tables({
      household: [household()],
      rows: [mirror, usd],
      cells: [cellValue(usd.id, '2026-01', 1000)],
      fxRates: [{ pair: 'USD/EUR', month: '2026-01', rate: 0.5, source: 'manual', updatedAt: 0 }],
    })
    const out = computeEngine({ tables: t, months: ['2026-01'] })
    expect(out.cells[cellKey(mirror.id, '2026-01')]).toMatchObject({ value: 1000, valueBase: 500, currency: 'USD', source: 'derived' })
    expect(out.totals['2026-01'].income).toBe(1000)
  })

  it('shows zero and warns when the followed row is gone', () => {
    const orphan = row({ name: 'Orphan', section: 'transfer', followsRowId: newId() })
    const out = computeEngine({ tables: tables({ household: [household()], rows: [orphan], cells: [cellValue(orphan.id, '2026-01', 500)] }), months: ['2026-01'] })
    expect(out.cells[cellKey(orphan.id, '2026-01')]).toMatchObject({ value: 0, source: 'derived' })
    expect(out.warnings).toEqual(['"Orphan" follows a row that no longer exists.'])
  })
})

describe('rows that follow a share of another row', () => {
  it('take that share of the followed amount, rounded to the cent, in the followed row\'s currency', () => {
    const benefit = row({ name: 'Child benefit', section: 'income', currency: 'USD' })
    const quarter = row({ name: 'Quarter', section: 'transfer', followsRowId: benefit.id, followShare: 0.25, order: 'a1' })
    const t = tables({
      household: [household()],
      rows: [benefit, quarter],
      cells: [cellValue(benefit.id, '2026-01', 25500), cellValue(benefit.id, '2026-02', 25501)],
      fxRates: [{ pair: 'USD/EUR', month: '2026-01', rate: 0.5, source: 'manual', updatedAt: 0 }],
    })
    const out = computeEngine({ tables: t, months: ['2026-01', '2026-02'] })
    expect(out.cells[cellKey(quarter.id, '2026-01')]).toMatchObject({ value: 6375, currency: 'USD', source: 'derived' })
    expect(out.cells[cellKey(quarter.id, '2026-02')].value).toBe(6375)
  })
})
