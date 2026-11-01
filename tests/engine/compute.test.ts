import { describe, expect, it } from 'vitest'
import { FxRateSchema, poolRef } from '@/model'
import { cellKey, computeEngine } from '@/engine'
import { T0, account, actual, cellItems, cellValue, closedMonth, household, pool, row, tables } from './helpers'

const months = ['2026-01', '2026-02', '2026-03']

describe('engine: cell resolution', () => {
  it('inherits forward until overridden, and shows empty before the first value', () => {
    const h = household()
    const rent = row({ name: 'Rent', section: 'expense', defaultStatus: 'committed' })
    const out = computeEngine({ tables: tables({ household: [h], rows: [rent], cells: [cellValue(rent.id, '2026-02', 150000)] }), months })
    expect(out.cells[cellKey(rent.id, '2026-01')]).toMatchObject({ value: 0, source: 'empty' })
    expect(out.cells[cellKey(rent.id, '2026-02')]).toMatchObject({ value: 150000, source: 'value', status: 'committed' })
    expect(out.cells[cellKey(rent.id, '2026-03')]).toMatchObject({ value: 150000, source: 'inherit', status: 'committed' })
  })

  it('sums items, resolves carry, skips skipped, and aggregates status', () => {
    const h = household()
    const other = row({ name: 'Other', section: 'expense' })
    const cells = [
      cellValue(other.id, '2026-01', 10000),
      cellItems(other.id, '2026-02', [
        { amount: 0, kind: 'carry', status: 'done' },
        { amount: 2500, label: 'Extra', status: 'projected' },
        { amount: 99900, label: 'Skipped', skipped: true },
      ]),
    ]
    const out = computeEngine({ tables: tables({ household: [h], rows: [other], cells }), months })
    const feb = out.cells[cellKey(other.id, '2026-02')]
    expect(feb.value).toBe(12500)
    expect(feb.status).toBe('projected')
    expect(feb.items.find((i) => i.kind === 'carry')?.effectiveAmount).toBe(10000)
    expect(out.cells[cellKey(other.id, '2026-03')].value).toBe(12500)
  })

  it('closed months show done, archived rows vanish from totals', () => {
    const h = household()
    const gym = row({ name: 'Gym', section: 'expense', archivedMonth: '2026-03' })
    const out = computeEngine({
      tables: tables({ household: [h], rows: [gym], cells: [cellValue(gym.id, '2026-01', 4000)], monthStates: [closedMonth('2026-01')] }),
      months,
    })
    expect(out.cells[cellKey(gym.id, '2026-01')].status).toBe('done')
    expect(out.cells[cellKey(gym.id, '2026-02')].status).toBe('projected')
    expect(out.cells[cellKey(gym.id, '2026-03')].source).toBe('archived')
    expect(out.totals['2026-02'].expensesTotal).toBe(4000)
    expect(out.totals['2026-03'].expensesTotal).toBe(0)
  })
})

describe('engine: closing rules and funding', () => {
  function setup(rule: 'savings-plug' | 'leftover-plug') {
    const savings = account({ name: 'Savings', type: 'savings', openingBalance: 100000 })
    const h = household({ closingRule: rule, cashBuffer: 5000 })
    const salary = row({ name: 'Salary', section: 'income', kind: 'salary' })
    const rent = row({ name: 'Rent', section: 'expense' })
    const toSav = row({ name: 'To savings', section: 'transfer', kind: 'to-savings', accountId: savings.id })
    const cells = [cellValue(salary.id, '2026-01', 300000), cellValue(rent.id, '2026-01', 120000), cellValue(toSav.id, '2026-01', 50000)]
    return { h, salary, rent, toSav, savings, cells }
  }

  it('savings is the plug: whatever is left after the buffer goes to savings', () => {
    const s = setup('savings-plug')
    const out = computeEngine({ tables: tables({ household: [s.h], rows: [s.salary, s.rent, s.toSav], cells: s.cells, accounts: [s.savings] }), months: ['2026-01'] })
    const t = out.totals['2026-01']
    expect(t.toSavings).toBe(300000 - 120000 - 5000)
    expect(t.leftover).toBe(5000)
    expect(out.cells[cellKey(s.toSav.id, '2026-01')]).toMatchObject({ value: 175000, source: 'derived' })
    expect(out.accounts[s.savings.id].months['2026-01'].balance).toBe(100000 + 175000)
  })

  it('leftover is the plug: the user decides savings, the rest is leftover', () => {
    const s = setup('leftover-plug')
    const out = computeEngine({ tables: tables({ household: [s.h], rows: [s.salary, s.rent, s.toSav], cells: s.cells, accounts: [s.savings] }), months: ['2026-01'] })
    const t = out.totals['2026-01']
    expect(t.toSavings).toBe(50000)
    expect(t.leftover).toBe(300000 - 120000 - 50000)
    expect(out.cells[cellKey(s.toSav.id, '2026-01')].source).toBe('value')
    expect(out.accounts[s.savings.id].months['2026-01'].balance).toBe(150000)
  })

  it('savings- and pool-funded spend bypass the plug and draw the savings account once', () => {
    const savings = account({ name: 'Savings', type: 'savings', openingBalance: 100000 })
    const travelPool = pool({ name: 'Travel', accountId: savings.id, openingBalance: 30000 })
    const h = household()
    const salary = row({ name: 'Salary', section: 'income' })
    const travel = row({ name: 'Travel', section: 'expense', defaultFundedBy: poolRef(travelPool.id) })
    const alloc = row({ name: 'Travel pool', section: 'transfer', kind: 'pool-allocation', accountId: savings.id })
    const laptop = row({ name: 'Laptop', section: 'expense' })
    const toSav = row({ name: 'To savings', section: 'transfer', kind: 'to-savings', accountId: savings.id })
    travelPool.allocationRowId = alloc.id
    const cells = [
      cellValue(salary.id, '2026-01', 300000),
      cellValue(alloc.id, '2026-01', 20000),
      cellValue(travel.id, '2026-01', 45000),
      cellItems(laptop.id, '2026-01', [{ amount: 120000, fundedBy: 'savings', label: 'Laptop' }]),
    ]
    const out = computeEngine({ tables: tables({ household: [h], rows: [salary, travel, alloc, laptop, toSav], cells, accounts: [savings], pools: [travelPool] }), months: ['2026-01'] })
    const t = out.totals['2026-01']
    expect(t.cashExpense).toBe(0)
    expect(t.poolFunded).toBe(45000)
    expect(t.savingsFunded).toBe(120000)
    expect(t.toSavings).toBe(300000 - 20000) // income minus allocation only
    expect(t.fromSavingsDerived).toBe(165000)
    expect(t.expensesTotal).toBe(165000)
    expect(out.pools[travelPool.id].months['2026-01'].balance).toBe(30000 + 20000 - 45000)
    // savings: +280000 plug, +20000 allocation, −120000 laptop, −45000 travel
    expect(out.accounts[savings.id].months['2026-01'].balance).toBe(100000 + 280000 + 20000 - 120000 - 45000)
  })

  it('pocket total is shared, debts and investments are outflows, actual balances pin the chain', () => {
    const savings = account({ name: 'Savings', type: 'savings', openingBalance: 0 })
    const h = household({ pocketTotal: 100000 })
    const salary = row({ name: 'Salary', section: 'income' })
    const pA = row({ name: 'Pocket A', section: 'transfer', kind: 'pocket-money', pocketMode: 'share-of-pocket-total', pocketShare: 0.6 })
    const pB = row({ name: 'Pocket B', section: 'transfer', kind: 'pocket-money', pocketMode: 'share-of-pocket-total', pocketShare: 0.4 })
    const loan = row({ name: 'Car loan', section: 'expense', kind: 'debt-payment' })
    const inv = row({ name: 'To investments', section: 'transfer', kind: 'to-investment' })
    const toSav = row({ name: 'To savings', section: 'transfer', kind: 'to-savings', accountId: savings.id })
    const cells = [
      cellValue(salary.id, '2026-01', 500000), cellValue(loan.id, '2026-01', 50000), cellValue(inv.id, '2026-01', 30000),
      cellValue(salary.id, '2026-02', 500000),
    ]
    const out = computeEngine({
      tables: tables({ household: [h], rows: [salary, pA, pB, loan, inv, toSav], cells, accounts: [savings], accountMonths: [actual(savings.id, '2026-01', 999999)] }),
      months: ['2026-01', '2026-02'],
    })
    const jan = out.totals['2026-01']
    expect(jan.pocket).toBe(100000)
    expect(out.cells[cellKey(pA.id, '2026-01')].value).toBe(60000)
    expect(jan.toSavings).toBe(500000 - 100000 - 50000 - 30000)
    const sJan = out.accounts[savings.id].months['2026-01']
    expect(sJan.computed).toBe(320000)
    expect(sJan.balance).toBe(999999)
    expect(sJan.adjustment).toBe(999999 - 320000)
    // february starts from the pinned actual
    const feb = out.totals['2026-02']
    expect(feb.toSavings).toBe(500000 - 100000 - 50000 - 30000)
    expect(out.accounts[savings.id].months['2026-02'].balance).toBe(999999 + 320000)
  })
})

describe('engine: currency and totals', () => {
  it('converts foreign-currency rows with the month rate, falling back to the nearest month', () => {
    const h = household({ baseCurrency: 'TRY', locale: 'tr-TR' })
    const usd = row({ name: 'Salary USD', section: 'income', currency: 'USD' })
    const fx = [
      FxRateSchema.parse({ pair: 'USD/TRY', month: '2026-01', rate: 49.03, source: 'manual', updatedAt: T0 }),
      FxRateSchema.parse({ pair: 'USD/TRY', month: '2026-02', rate: 49.76545, source: 'manual', updatedAt: T0 }),
    ]
    const out = computeEngine({ tables: tables({ household: [h], rows: [usd], cells: [cellValue(usd.id, '2026-01', 400000), cellValue(usd.id, '2026-02', 650000)], fxRates: fx }), months })
    expect(out.cells[cellKey(usd.id, '2026-01')].valueBase).toBe(19612000)
    expect(out.cells[cellKey(usd.id, '2026-02')].valueBase).toBe(32347543)
    expect(out.cells[cellKey(usd.id, '2026-03')].valueBase).toBe(32347543) // nearest known rate
    expect(out.warnings).toEqual([])
    expect(out.rowTotals[usd.id].shareOfIncome).toBeCloseTo(1, 9)
  })

  it('flags a missing rate and keeps the amount 1:1', () => {
    const h = household()
    const r = row({ name: 'Remote salary', section: 'income', currency: 'GBP' })
    const out = computeEngine({ tables: tables({ household: [h], rows: [r], cells: [cellValue(r.id, '2026-01', 1000)] }), months: ['2026-01'] })
    expect(out.cells[cellKey(r.id, '2026-01')]).toMatchObject({ valueBase: 1000, missingRate: true })
    expect(out.warnings[0]).toMatch(/GBP→EUR/)
  })

  it('computes row totals and share of income over the requested range', () => {
    const h = household()
    const salary = row({ name: 'Salary', section: 'income' })
    const rent = row({ name: 'Rent', section: 'expense' })
    const out = computeEngine({ tables: tables({ household: [h], rows: [salary, rent], cells: [cellValue(salary.id, '2026-01', 400000), cellValue(rent.id, '2026-01', 100000)] }), months })
    expect(out.rowTotals[salary.id].total).toBe(1200000)
    expect(out.rowTotals[rent.id]).toEqual({ total: 300000, shareOfIncome: 0.25 })
    expect(out.incomeTotal).toBe(1200000)
  })
})
