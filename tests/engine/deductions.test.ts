import { describe, expect, it } from 'vitest'
import { cellKey, computeEngine } from '@/engine'
import { newId } from '@/model'
import { cellValue, household, row, tables } from './helpers'

const M = '2026-01'

describe('expenses deducted from an income', () => {
  it('lower the income\'s net and leave every total gross', () => {
    const salary = row({ name: 'Salary', section: 'income', kind: 'salary' })
    const tax = row({ name: 'Tax', section: 'expense', deductedFromRowId: salary.id, order: 'b0' })
    const pension = row({ name: 'Pension', section: 'expense', deductedFromRowId: salary.id, order: 'b1' })
    const t = tables({
      household: [household({ closingRule: 'leftover-plug' })],
      rows: [salary, tax, pension],
      cells: [cellValue(salary.id, M, 400000), cellValue(tax.id, M, 100000), cellValue(pension.id, M, 20000)],
    })
    const out = computeEngine({ tables: t, months: [M] })
    expect(out.cells[cellKey(salary.id, M)]).toMatchObject({ valueBase: 400000, deductionsBase: 120000, netBase: 280000 })
    // the deductions themselves are ordinary cells
    expect(out.cells[cellKey(tax.id, M)]).toMatchObject({ valueBase: 100000, deductionsBase: 0, netBase: 100000 })
    expect(out.totals[M].income).toBe(400000)
    expect(out.totals[M].cashExpense).toBe(120000)
    expect(out.warnings).toEqual([])
  })

  it('a deduction that follows its income row with a share gets its amount first, whatever the row order', () => {
    const salary = row({ name: 'Salary', section: 'income', kind: 'salary', order: 'a1' })
    const tax = row({ name: 'Tax', section: 'expense', followsRowId: salary.id, followShare: 0.25, deductedFromRowId: salary.id, order: 'a0' })
    const t = tables({ household: [household({ closingRule: 'leftover-plug' })], rows: [tax, salary], cells: [cellValue(salary.id, M, 400000)] })
    const out = computeEngine({ tables: t, months: [M] })
    expect(out.cells[cellKey(tax.id, M)]).toMatchObject({ value: 100000, source: 'derived' })
    expect(out.cells[cellKey(salary.id, M)]).toMatchObject({ deductionsBase: 100000, netBase: 300000 })
    expect(out.warnings).toEqual([])
  })

  it('warns when the income row is gone, and stops at an archived income row', () => {
    const orphan = row({ name: 'Tax', section: 'expense', deductedFromRowId: newId() })
    const lost = computeEngine({ tables: tables({ household: [household()], rows: [orphan], cells: [cellValue(orphan.id, M, 500)] }), months: [M] })
    expect(lost.cells[cellKey(orphan.id, M)]).toMatchObject({ value: 500, netBase: 500 })
    expect(lost.warnings).toEqual(['"Tax" is deducted from a row that no longer exists.'])

    const old = row({ name: 'Old salary', section: 'income', archivedMonth: '2026-02' })
    const oldTax = row({ name: 'Old tax', section: 'expense', deductedFromRowId: old.id, order: 'b0' })
    const out = computeEngine({
      tables: tables({ household: [household()], rows: [old, oldTax], cells: [cellValue(old.id, M, 400000), cellValue(oldTax.id, M, 100000)] }),
      months: [M, '2026-02'],
    })
    expect(out.cells[cellKey(old.id, M)].netBase).toBe(300000)
    expect(out.cells[cellKey(old.id, '2026-02')]).toMatchObject({ source: 'archived', deductionsBase: 0 })
    expect(out.warnings).toEqual([])
  })
})
