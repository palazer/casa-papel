import { describe, expect, it } from 'vitest'
import { computeEngine } from '@/engine'
import { CellSchema } from '@/model'
import { monthProgress, progressText } from '@/features/statement/progress'
import { T0, cellItems, cellValue, closedMonth, household, row, tables } from '../engine/helpers'

const month = '2026-01'

function setup(rentAmount = 120000) {
  const h = household({ closingRule: 'savings-plug' })
  const salary = row({ name: 'Salary', section: 'income', defaultStatus: 'committed' })
  const rent = row({ name: 'Rent', section: 'expense', defaultStatus: 'committed' })
  const bills = row({ name: 'Bills', section: 'expense' })
  const gym = row({ name: 'Gym', section: 'expense' })
  const toSav = row({ name: 'To savings', section: 'transfer', kind: 'to-savings' })
  const cells = [
    cellValue(salary.id, month, 300000),
    cellValue(rent.id, month, rentAmount),
    cellItems(bills.id, month, [{ amount: 4000, label: 'Gas', status: 'done' }, { amount: 2500, label: 'Water' }, { amount: 999, label: 'Old', skipped: true }]),
  ]
  return { h, rows: [salary, rent, bills, gym, toSav], cells, toSav }
}

describe('month progress', () => {
  it('counts lines once and items one by one, and adds up what is still open', () => {
    const s = setup()
    const out = computeEngine({ tables: tables({ household: [s.h], rows: s.rows, cells: s.cells }), months: [month] })
    const p = monthProgress(out.rows, out.cells, month)
    // Salary, Rent, Bills (two live items), the savings plug of 300,000 − 126,500; the empty Gym row is not a line
    expect(p).toEqual({ lines: 4, done: 1, total: 5, toPay: 120000 + 2500 + 173500, toComeIn: 300000 })
    expect(progressText(p, false, 'EUR', 'en-IE')).toBe('1 of 5 done · €2,960.00 still to pay · €3,000.00 to come in')
  })

  it('a draw on savings is nothing to pay, and a ticked automatic row counts as done', () => {
    const s = setup(320000)
    const ticked = CellSchema.parse({ rowId: s.toSav.id, month, mode: 'inherit', markedDone: true, updatedAt: T0 })
    const out = computeEngine({ tables: tables({ household: [s.h], rows: s.rows, cells: [...s.cells, ticked] }), months: [month] })
    const p = monthProgress(out.rows, out.cells, month)
    expect(out.cells[`${s.toSav.id}|${month}`]?.value ?? out.totals[month].toSavings).toBeLessThan(0)
    expect(p).toEqual({ lines: 4, done: 2, total: 5, toPay: 320000 + 2500, toComeIn: 300000 })
  })

  it('says it in words: all done, closed, nothing yet', () => {
    const s = setup()
    // closing a month marks every item done (closeMonth does that); here the fixture does it by hand
    const cells = s.cells.map((c) => (c.mode === 'items' ? { ...c, items: c.items.map((i) => ({ ...i, status: 'done' as const })) } : c))
    const closed = computeEngine({ tables: tables({ household: [s.h], rows: s.rows, cells, monthStates: [closedMonth(month)] }), months: [month] })
    const p = monthProgress(closed.rows, closed.cells, month)
    expect(p.done).toBe(p.total)
    expect(progressText(p, false, 'EUR', 'en-IE')).toBe('All 5 done')
    expect(progressText(p, true, 'EUR', 'en-IE')).toBe('Closed · all done')
    expect(progressText({ lines: 0, done: 0, total: 0, toPay: 0, toComeIn: 0 }, false, 'EUR', 'en-IE')).toBe('Nothing in this month yet')
  })
})
