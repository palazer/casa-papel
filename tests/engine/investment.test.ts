import { describe, expect, it } from 'vitest'
import { cellKey, computeEngine } from '@/engine'
import { FxRateSchema, monthRange } from '@/model'
import { account, actual, cellValue, household, row, tables } from './helpers'

const months = monthRange('2026-01', '2026-04')
const yearly = 0.12
const monthly = Math.pow(1 + yearly, 1 / 12) - 1

function setup(inv: Partial<NonNullable<ReturnType<typeof account>['investment']>>, opts: { currency?: string; fx?: boolean; actuals?: Array<[string, number]> } = {}) {
  const h = household()
  const broker = account({ name: 'Broker', type: 'investment', currency: opts.currency ?? 'EUR', openingBalance: 1_000_00, investment: { projectionMode: 'fixed-rate', annualRate: yearly, depositTiming: 'start', depositFxMode: 'monthly-rate', fixedRate: null, ...inv } })
  const salary = row({ name: 'Salary', section: 'income', kind: 'salary' })
  const toInv = row({ name: 'To investments', section: 'transfer', kind: 'to-investment', accountId: broker.id })
  const fromInv = row({ name: 'From investments', section: 'income', kind: 'from-investment', accountId: broker.id })
  const t = tables({
    household: [h], accounts: [broker], rows: [salary, toInv, fromInv],
    cells: [cellValue(salary.id, '2026-01', 3_000_00), cellValue(toInv.id, '2026-01', 100_00), cellValue(toInv.id, '2026-03', 0), cellValue(fromInv.id, '2026-04', 50_00)],
    accountMonths: (opts.actuals ?? []).map(([m, v]) => actual(broker.id, m, v)),
    fxRates: opts.fx ? [FxRateSchema.parse({ pair: 'EUR/USD', month: '2026-01', rate: 1.25, source: 'manual', updatedAt: 0 })] : [],
  })
  return { out: computeEngine({ tables: t, months }), broker, toInv }
}

describe('investment accounts', () => {
  it('deposit at start of month: grows the deposit too', () => {
    const { out, broker } = setup({ depositTiming: 'start' })
    const s = out.accounts[broker.id]
    const jan = Math.round((1_000_00 + 100_00) * (1 + monthly))
    expect(s.months['2026-01']).toMatchObject({ inflow: 100_00, startValue: 1_100_00, computed: jan, balance: jan, capital: 1_100_00, projected: true })
    expect(s.months['2026-02'].inflow).toBe(100_00) // carried forward deposit row
    expect(s.months['2026-03'].inflow).toBe(0)
    // April withdraws 50 before growing
    const mar = s.months['2026-03'].balance
    expect(s.months['2026-04'].startValue).toBe(mar - 50_00)
    expect(s.months['2026-04'].outflow).toBe(50_00)
    expect(s.months['2026-04'].capital).toBe(1_100_00 + 100_00 - 50_00)
  })
  it('deposit at end of month: grows the old value, then adds the deposit', () => {
    const { out, broker } = setup({ depositTiming: 'end' })
    const jan = Math.round(1_000_00 * (1 + monthly)) + 100_00
    expect(out.accounts[broker.id].months['2026-01'].balance).toBe(jan)
  })
  it('a real value pins the month, shows the gap, and feeds the historical average', () => {
    const { out, broker } = setup({ projectionMode: 'historical-average' }, { actuals: [['2026-01', 1_210_00]] })
    const s = out.accounts[broker.id]
    expect(s.months['2026-01']).toMatchObject({ balance: 1_210_00, projected: false })
    expect(s.months['2026-01'].adjustment).toBe(1_210_00 - Math.round(1_100_00 * (1 + monthly)))
    expect(s.months['2026-01'].monthlyReturn).toBeCloseTo(0.1, 9) // 1100 → 1210
    // February projects with the realised 10%: (1210 + 100) × 1.1
    expect(s.months['2026-02'].computed).toBe(Math.round(1_310_00 * 1.1))
    expect(s.months['2026-02'].projected).toBe(true)
  })
  it('a USD account converts EUR deposits at the monthly rate, or at a fixed rate when asked', () => {
    const live = setup({}, { currency: 'USD', fx: true })
    expect(live.out.accounts[live.broker.id].months['2026-01'].inflow).toBe(125_00)
    expect(live.out.warnings).toEqual([])
    const fixed = setup({ depositFxMode: 'fixed', fixedRate: 1.1 }, { currency: 'USD' })
    expect(fixed.out.accounts[fixed.broker.id].months['2026-01'].inflow).toBe(110_00)
    const missing = setup({}, { currency: 'USD' })
    expect(missing.out.warnings.some((w) => w.includes('EUR→USD'))).toBe(true)
    expect(missing.out.cells[cellKey(missing.toInv.id, '2026-01')].valueBase).toBe(100_00)
  })
})
