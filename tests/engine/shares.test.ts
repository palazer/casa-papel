import { describe, expect, it } from 'vitest'
import { computeContributions, computeEngine, computePersonBudgets } from '@/engine'
import { EntitySchema, newId } from '@/model'
import { T0, account, cellValue, household, row, tables } from './helpers'

const M = '2026-01'
const ent = (kind: 'adult' | 'child', name: string, paidBy: string | null = null, order = 'a0') => EntitySchema.parse({ id: newId(), createdAt: T0, updatedAt: T0, kind, name, paidBy, order })

function world(over: Partial<Parameters<typeof household>[0]> = {}) {
  const a = ent('adult', 'A', null, 'a0')
  const b = ent('adult', 'B', null, 'a1')
  const kid = ent('child', 'Kid', b.id, 'a2')
  const joint = account({ name: 'Joint', type: 'joint', tracked: false })
  const savings = account({ name: 'Savings', type: 'savings' })
  const salaryA = row({ name: 'A salary', section: 'income', kind: 'salary', scope: a.id, inShareBasis: true })
  const salaryB = row({ name: 'B salary', section: 'income', kind: 'salary', scope: b.id, inShareBasis: true, order: 'a1' })
  const benefit = row({ name: 'Child benefit', section: 'income', scope: kid.id, order: 'a2' })
  const groceries = row({ name: 'Groceries', section: 'expense', accountId: joint.id, order: 'b0' })
  const phoneA = row({ name: 'A phone', section: 'expense', scope: a.id, order: 'b1' })
  const kidCare = row({ name: 'Daycare', section: 'expense', scope: kid.id, order: 'b2' })
  const travel = row({ name: 'Travel', section: 'expense', defaultFundedBy: 'savings', order: 'b3' })
  const toSavings = row({ name: 'To savings', section: 'transfer', kind: 'to-savings', accountId: savings.id, order: 'c0' })
  const pocketA = row({ name: 'Pocket A', section: 'transfer', kind: 'pocket-money', scope: a.id, pocketMode: 'fixed', order: 'c1' })
  const t = tables({
    household: [household({ moneyMode: 'proportional', closingRule: 'leftover-plug', ...over })],
    entities: [a, b, kid], accounts: [joint, savings],
    rows: [salaryA, salaryB, benefit, groceries, phoneA, kidCare, travel, toSavings, pocketA],
    cells: [
      cellValue(salaryA.id, M, 3000_00), cellValue(salaryB.id, M, 1000_00), cellValue(benefit.id, M, 250_00),
      cellValue(groceries.id, M, 800_00), cellValue(phoneA.id, M, 40_00), cellValue(kidCare.id, M, 300_00), cellValue(travel.id, M, 500_00),
      cellValue(toSavings.id, M, 1000_00), cellValue(pocketA.id, M, 100_00),
    ],
  })
  const out = computeEngine({ tables: t, months: [M] })
  return { t, out, a, b, kid, joint, savings, rows: { groceries, phoneA, kidCare, travel, toSavings, pocketA } }
}

describe('proportional contributions', () => {
  it('splits shared costs by salary share, routes own and paid-for rows, ignores savings-funded spend', () => {
    const { t, out, a, b, joint, savings, rows } = world()
    const c = computeContributions(t, out, M)
    const A = c.adults.find((x) => x.entityId === a.id)!
    const B = c.adults.find((x) => x.entityId === b.id)!
    expect(A.share).toBeCloseTo(0.75, 9)
    expect(B.share).toBeCloseTo(0.25, 9)
    const line = (id: string) => c.lines.find((l) => l.rowId === id)!
    expect(line(rows.groceries.id).byAdult).toEqual({ [a.id]: 600_00, [b.id]: 200_00 })
    expect(line(rows.phoneA.id)).toMatchObject({ routing: 'own', byAdult: { [a.id]: 40_00, [b.id]: 0 } })
    expect(line(rows.kidCare.id)).toMatchObject({ routing: 'paid-by', byAdult: { [a.id]: 0, [b.id]: 300_00 } })
    expect(c.lines.find((l) => l.rowId === rows.travel.id)).toBeUndefined() // comes out of savings: nobody pays it this month
    expect(line(rows.toSavings.id).byAdult).toEqual({ [a.id]: 750_00, [b.id]: 250_00 })
    expect(line(rows.pocketA.id).byAdult[a.id]).toBe(100_00)
    // B's income includes the child benefit because B pays for the child
    expect(B.income).toBe(1250_00)
    expect(A.owed).toBe(600_00 + 40_00 + 750_00 + 100_00)
    expect(B.owed).toBe(200_00 + 300_00 + 250_00)
    expect(A.remainder).toBe(3000_00 - A.owed)
    expect(B.remainder).toBe(1250_00 - B.owed)
    expect(A.owedByDestination).toEqual({ [joint.id]: 600_00, '': 140_00, [savings.id]: 750_00 })
  })
  it('splits exactly even when shares do not divide the cents', () => {
    const { t, out, rows } = world({ shareBasis: 'manual' })
    // manual shares missing → equal split; 40.01 between two must still add up
    const c = computeContributions(t, out, M)
    const line = c.lines.find((l) => l.rowId === rows.groceries.id)!
    expect(Object.values(line.byAdult).reduce((s, v) => s + v, 0)).toBe(line.total)
  })
  it('uses manual shares or all income when asked', () => {
    const base = world()
    const manual = computeContributions(tables({ ...base.t, household: [{ ...base.t.household[0], shareBasis: 'manual', manualShares: { [base.a.id]: 0.6, [base.b.id]: 0.4 } }] }), base.out, M)
    expect(manual.adults.map((x) => x.share)).toEqual([0.6, 0.4])
    const all = computeContributions(tables({ ...base.t, household: [{ ...base.t.household[0], shareBasis: 'all-income' }] }), base.out, M)
    // all income: A 3000, B 1000 + 250 benefit
    expect(all.adults.find((x) => x.entityId === base.b.id)!.share).toBeCloseTo(1250 / 4250, 9)
  })
})

describe('pooled per-person budgets', () => {
  it('reports income, own spending, pocket and the contribution to the household', () => {
    const { t, out, a, b } = world({ moneyMode: 'pooled' })
    const p = computePersonBudgets(t, out, M)
    expect(p.find((x) => x.entityId === a.id)).toMatchObject({ income: 3000_00, ownSpend: 40_00, pocket: 100_00, contribution: 2860_00 })
    expect(p.find((x) => x.entityId === b.id)).toMatchObject({ income: 1250_00, ownSpend: 300_00, pocket: 0, contribution: 950_00 })
  })
})
