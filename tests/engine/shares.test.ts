import { describe, expect, it } from 'vitest'
import { computeEngine, computePersonBudgets } from '@/engine'
import { EntitySchema, newId } from '@/model'
import { T0, account, cellValue, household, row, tables } from './helpers'

const M = '2026-01'
const ent = (kind: 'adult' | 'child', name: string, order = 'a0') => EntitySchema.parse({ id: newId(), createdAt: T0, updatedAt: T0, kind, name, order })

describe('per person: what each adult brings, spends on themselves and takes', () => {
  it('counts the rows that belong to an adult; a child\'s rows and shared rows are the household\'s', () => {
    const a = ent('adult', 'A', 'a0')
    const b = ent('adult', 'B', 'a1')
    const kid = ent('child', 'Kid', 'a2')
    const savings = account({ name: 'Savings', type: 'savings' })
    const salaryA = row({ name: 'A salary', section: 'income', kind: 'salary', scope: a.id })
    const salaryB = row({ name: 'B salary', section: 'income', kind: 'salary', scope: b.id, order: 'a1' })
    const benefit = row({ name: 'Child benefit', section: 'income', scope: kid.id, order: 'a2' })
    const groceries = row({ name: 'Groceries', section: 'expense', order: 'b0' })
    const phoneA = row({ name: 'A phone', section: 'expense', scope: a.id, order: 'b1' })
    const kidCare = row({ name: 'Daycare', section: 'expense', scope: kid.id, order: 'b2' })
    const toSavings = row({ name: 'To savings', section: 'transfer', kind: 'to-savings', accountId: savings.id, order: 'c0' })
    const pocketA = row({ name: 'Pocket A', section: 'transfer', kind: 'pocket-money', scope: a.id, pocketMode: 'fixed', order: 'c1' })
    const t = tables({
      household: [household({ closingRule: 'leftover-plug' })],
      entities: [a, b, kid], accounts: [savings],
      rows: [salaryA, salaryB, benefit, groceries, phoneA, kidCare, toSavings, pocketA],
      cells: [
        cellValue(salaryA.id, M, 3000_00), cellValue(salaryB.id, M, 1000_00), cellValue(benefit.id, M, 250_00),
        cellValue(groceries.id, M, 800_00), cellValue(phoneA.id, M, 40_00), cellValue(kidCare.id, M, 300_00),
        cellValue(toSavings.id, M, 1000_00), cellValue(pocketA.id, M, 100_00),
      ],
    })
    const p = computePersonBudgets(t, computeEngine({ tables: t, months: [M] }), M)
    expect(p.map((x) => x.name)).toEqual(['A', 'B'])
    expect(p.find((x) => x.entityId === a.id)).toMatchObject({ income: 3000_00, ownSpend: 40_00, pocket: 100_00, contribution: 2860_00 })
    // the child benefit and the daycare belong to the child: neither is B's
    expect(p.find((x) => x.entityId === b.id)).toMatchObject({ income: 1000_00, ownSpend: 0, pocket: 0, contribution: 1000_00 })
  })

  it('shows net income; a tax deducted from it is not own spending, until the income is archived', () => {
    const a = ent('adult', 'A', 'a0')
    const salaryA = row({ name: 'A salary', section: 'income', kind: 'salary', scope: a.id })
    const tax = row({ name: 'Tax', section: 'expense', scope: a.id, followsRowId: salaryA.id, followShare: 0.25, deductedFromRowId: salaryA.id, order: 'b0' })
    const world = (over: Partial<typeof salaryA> = {}) => tables({
      household: [household({ closingRule: 'leftover-plug' })],
      entities: [a],
      rows: [{ ...salaryA, ...over }, { ...tax, followsRowId: over.archivedMonth ? null : tax.followsRowId }],
      cells: [cellValue(salaryA.id, M, 4000_00), ...(over.archivedMonth ? [cellValue(tax.id, M, 500_00)] : [])],
    })
    const live = world()
    expect(computePersonBudgets(live, computeEngine({ tables: live, months: [M] }), M)[0]).toMatchObject({ income: 3000_00, ownSpend: 0, contribution: 3000_00 })
    const archived = world({ archivedMonth: M })
    expect(computePersonBudgets(archived, computeEngine({ tables: archived, months: [M] }), M)[0]).toMatchObject({ income: 0, ownSpend: 500_00, contribution: -500_00 })
  })

  it('a payment to a card whose purchases are expense rows is nobody\'s spending a second time; a lump card\'s payment is', () => {
    const a = ent('adult', 'A', 'a0')
    const itemized = account({ name: 'Visa', type: 'credit-card', card: { cardMode: 'itemized' } })
    const lump = account({ name: 'Amex', type: 'credit-card', card: { cardMode: 'lump' } })
    const salaryA = row({ name: 'A salary', section: 'income', kind: 'salary', scope: a.id })
    const shoes = row({ name: 'A shoes', section: 'expense', scope: a.id, accountId: itemized.id, order: 'b0' })
    const visaPay = row({ name: 'Visa payment', section: 'expense', kind: 'card-payment', scope: a.id, accountId: itemized.id, order: 'b1' })
    const amexPay = row({ name: 'Amex payment', section: 'expense', kind: 'card-payment', scope: a.id, accountId: lump.id, order: 'b2' })
    const t = tables({
      household: [household({ closingRule: 'leftover-plug' })],
      entities: [a], accounts: [itemized, lump],
      rows: [salaryA, shoes, visaPay, amexPay],
      cells: [cellValue(salaryA.id, M, 1000_00), cellValue(shoes.id, M, 120_00), cellValue(visaPay.id, M, 120_00), cellValue(amexPay.id, M, 200_00)],
    })
    expect(computePersonBudgets(t, computeEngine({ tables: t, months: [M] }), M)[0]).toMatchObject({ income: 1000_00, ownSpend: 320_00, contribution: 680_00 })
  })
})
