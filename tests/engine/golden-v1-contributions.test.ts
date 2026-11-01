import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { computeContributions, computeEngine } from '@/engine'
import { AccountSchema, EntitySchema, HouseholdSchema, RowSchema, CellSchema, EMPTY_TABLES, newId, type Tables } from '@/model'
import type { RawCell, RawFixture } from './fixtures/rawFixture'

/**
 * Private golden for the proportional mode, from the v1 workbook's Contributions sheet:
 * shared costs split by salary share, one adult's own line, a child benefit and the child's
 * long-term savings routed to the adult who pays for the child, and each adult's remainder.
 * Only cell addresses live here; names and amounts stay in the private fixture.
 */
const PATH = new URL('../private/v1-raw.json', import.meta.url)
const present = existsSync(PATH)

describe.skipIf(!present)('golden: v1 contributions (private)', () => {
  if (!present) return
  const fixture = JSON.parse(readFileSync(PATH, 'utf8')) as RawFixture
  const sheet = fixture.sheets.Contributions as Record<string, RawCell>
  const n = (addr: string) => (typeof sheet[addr]?.v === 'number' ? (sheet[addr].v as number) : 0)
  const text = (addr: string) => String(sheet[addr]?.v ?? addr)
  const minor = (addr: string) => Math.round(Math.abs(n(addr)) * 100)
  const signed = (addr: string) => Math.round(n(addr) * 100)
  const M = '2026-01'
  const T0 = Date.UTC(2026, 0, 1)
  const base = () => ({ id: newId(), createdAt: T0, updatedAt: T0, deletedAt: null })

  const adult1 = EntitySchema.parse({ ...base(), kind: 'adult', name: text('A3'), order: 'a0' })
  const adult2 = EntitySchema.parse({ ...base(), kind: 'adult', name: text('A11'), order: 'a1' })
  const child = EntitySchema.parse({ ...base(), kind: 'child', name: 'Child', paidBy: adult2.id, order: 'a2' })
  const acc = (name: string, type: 'checking' | 'joint' | 'savings' | 'investment') => AccountSchema.parse({ ...base(), name, type, currency: 'EUR', openingMonth: M, tracked: false })
  const payments = acc('Payments', 'checking')
  const joint = acc('Joint', 'joint')
  const savingsJoint = acc('Savings joint', 'savings')
  const invest1 = acc('Investments 1', 'investment')
  const invest2 = acc('Investments 2', 'investment')
  const household = HouseholdSchema.parse({ ...base(), name: 'v1', baseCurrency: 'EUR', locale: 'de-DE', startMonth: M, closingRule: 'leftover-plug', moneyMode: 'proportional', shareBasis: 'basis-rows' })

  let order = 0
  const mk = (spec: Partial<Parameters<typeof RowSchema.parse>[0]> & { name: string; section: 'income' | 'expense' | 'transfer' }) =>
    RowSchema.parse({ ...base(), order: String(order++).padStart(2, '0'), ...spec })
  const salary1 = mk({ name: 'Salary 1', section: 'income', kind: 'salary', scope: adult1.id, inShareBasis: true })
  const salary2 = mk({ name: 'Salary 2', section: 'income', kind: 'salary', scope: adult2.id, inShareBasis: true })
  const benefit = mk({ name: 'Child benefit', section: 'income', scope: child.id })
  const expenses = mk({ name: 'Expenses', section: 'expense', accountId: payments.id })
  const expensesPlus = mk({ name: 'Expenses plus', section: 'expense', scope: adult1.id, accountId: payments.id })
  const monthlyJoint = mk({ name: 'Monthly joint', section: 'expense', accountId: joint.id })
  const toSavings = mk({ name: 'To savings', section: 'transfer', kind: 'to-savings', accountId: savingsJoint.id })
  const toInvest = mk({ name: 'To investments', section: 'transfer', kind: 'to-investment', accountId: invest1.id })
  const childLT = mk({ name: 'Child long-term', section: 'transfer', kind: 'to-investment', scope: child.id, accountId: invest2.id })
  const cell = (rowId: string, addr: string) => CellSchema.parse({ rowId, month: M, mode: 'value', value: minor(addr), items: [], updatedAt: T0 })

  const tables: Tables = {
    ...EMPTY_TABLES,
    household: [household], entities: [adult1, adult2, child], accounts: [payments, joint, savingsJoint, invest1, invest2],
    rows: [salary1, salary2, benefit, expenses, expensesPlus, monthlyJoint, toSavings, toInvest, childLT],
    cells: [cell(salary1.id, 'D4'), cell(salary2.id, 'D12'), cell(benefit.id, 'D13'), cell(expenses.id, 'D22'), cell(expensesPlus.id, 'D23'), cell(monthlyJoint.id, 'D24'), cell(toSavings.id, 'D25'), cell(toInvest.id, 'D26'), cell(childLT.id, 'D27')],
  }
  const out = computeEngine({ tables, months: [M] })
  const c = computeContributions(tables, out, M)
  const A = c.adults.find((x) => x.entityId === adult1.id)!
  const B = c.adults.find((x) => x.entityId === adult2.id)!
  const line = (rowId: string) => c.lines.find((l) => l.rowId === rowId)!

  it('shares follow the salary basis (E4, E12)', () => {
    expect(A.share).toBeCloseTo(n('E4'), 6)
    expect(B.share).toBeCloseTo(n('E12'), 6)
  })
  it('each adult owes their share of every shared line (D6–D9, D14–D17)', () => {
    const pairs: Array<[string, string, string]> = [[expenses.id, 'D6', 'D14'], [monthlyJoint.id, 'D7', 'D15'], [toSavings.id, 'D8', 'D16'], [toInvest.id, 'D9', 'D17']]
    for (const [rowId, a1, a2] of pairs) {
      expect(Math.abs(line(rowId).byAdult[adult1.id] - minor(a1))).toBeLessThanOrEqual(1)
      expect(Math.abs(line(rowId).byAdult[adult2.id] - minor(a2))).toBeLessThanOrEqual(1)
    }
  })
  it('own and paid-for lines go to one adult in full (D5, D10, D18)', () => {
    expect(line(expensesPlus.id).byAdult).toEqual({ [adult1.id]: minor('D5'), [adult2.id]: 0 })
    expect(line(childLT.id).byAdult).toEqual({ [adult1.id]: minor('D10'), [adult2.id]: minor('D18') })
    expect(B.income).toBe(minor('D12') + minor('D13'))
    expect(B.owedByDestination[invest2.id]).toBe(minor('D27'))
  })
  it('remainders match (D3, D11) and add up to the household total (D19)', () => {
    expect(Math.abs(A.remainder - signed('D3'))).toBeLessThanOrEqual(5)
    expect(Math.abs(B.remainder - signed('D11'))).toBeLessThanOrEqual(5)
    expect(Math.abs(A.remainder + B.remainder - signed('D19'))).toBeLessThanOrEqual(5)
  })
})
