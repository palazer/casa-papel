import { describe, expect, it } from 'vitest'
import { FxRateSchema } from '@/model'
import { computeEngine } from '@/engine'
import { T0, account, cellValue, household, row, tables } from './helpers'

const months = ['2026-01', '2026-02']
const fx = (pair: string, month: string, rate: number) => FxRateSchema.parse({ pair, month, rate, source: 'manual', updatedAt: T0 })

describe('engine: balances in the household currency', () => {
  it('reports every balance in the base currency and warns when the rate is missing', () => {
    const h = household()
    const broker = account({ name: 'Broker', type: 'investment', currency: 'USD', openingBalance: 1000000 })
    const noRate = computeEngine({ tables: tables({ household: [h], accounts: [broker] }), months })
    const jan = noRate.accounts[broker.id].months['2026-01']
    expect(jan.balanceBase).toBe(jan.balance)
    expect(jan.missingRate).toBe(true)
    expect(noRate.warnings).toContain('No USD→EUR rate for 2026-01 (Broker)')
    // one line per account, not one per month
    expect(noRate.warnings.filter((w) => w.includes('(Broker)'))).toHaveLength(1)

    const out = computeEngine({ tables: tables({ household: [h], accounts: [broker], fxRates: [fx('EUR/USD', '2026-01', 1.25)] }), months })
    const r = out.accounts[broker.id].months['2026-01']
    expect(r.balance).toBe(1000000)
    expect(r.balanceBase).toBe(800000)
    expect(r.missingRate).toBe(false)
    expect(out.netWorth['2026-01']).toBe(800000)
    expect(out.warnings).toEqual([])
  })
  it('a liability in another currency counts against net worth in the base currency', () => {
    const h = household()
    const card = account({ name: 'Visa', type: 'credit-card', currency: 'USD', openingBalance: 125000 })
    const out = computeEngine({ tables: tables({ household: [h], accounts: [card], fxRates: [fx('EUR/USD', '2026-01', 1.25)] }), months })
    expect(out.accounts[card.id].months['2026-01'].balanceBase).toBe(100000)
    expect(out.netWorth['2026-01']).toBe(-100000)
  })
  it('a row in a third currency reaches a foreign account through the base currency', () => {
    const h = household()
    const broker = account({ name: 'Broker', type: 'investment', currency: 'GBP', openingBalance: 0 })
    const deposit = row({ name: 'To broker', section: 'transfer', kind: 'to-investment', accountId: broker.id, currency: 'USD' })
    const out = computeEngine({
      tables: tables({ household: [h], accounts: [broker], rows: [deposit], cells: [cellValue(deposit.id, '2026-01', 100000)], fxRates: [fx('EUR/USD', '2026-01', 1.25), fx('EUR/GBP', '2026-01', 0.8)] }),
      months: ['2026-01'],
    })
    // 1,000 USD = 800 EUR = 640 GBP
    expect(out.accounts[broker.id].months['2026-01'].inflow).toBe(64000)
    expect(out.warnings).toEqual([])
  })
})
