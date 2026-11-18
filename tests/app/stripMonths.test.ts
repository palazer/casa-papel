import { describe, expect, it } from 'vitest'
import { buildStatement, computeEngine } from '@/engine'
import { newId } from '@/model'
import { CasaDb, Store, defaultMonths, loadTables } from '@/store'
import { loadDemo } from '@/demo/loadDemo'
import { stripFigures, stripMonths, stripStart } from '@/features/statement/stripMonths'
import { cellValue, household, row, tables } from '../engine/helpers'

/** The demo as the app holds it in November 2026, with its schedules landed. */
async function demo() {
  const store = new Store(new CasaDb(`test-${newId()}`))
  await loadDemo(store)
  const t = await loadTables(store)
  const months = defaultMonths(t.household[0], t, '2026-11')
  return { t, months, engine: computeEngine({ tables: t, months }) }
}

describe('the strip of months', () => {
  it('every chip says what its month\'s page says, and its two lines come to the same total', async () => {
    const { t, months, engine } = await demo()
    const strip = stripMonths(t, engine, months)
    expect(strip.map((s) => s.month)).toEqual(months)
    for (const chip of strip) {
      const s = buildStatement(t, engine, chip.month)!
      const amount = (lines: typeof s.flow.left.lines, id: string) => lines.find((l) => l.id === id)?.amount ?? 0
      // each figure is the total of its group on the page
      expect(chip.income, chip.month).toBe(amount(s.flow.left.lines, 'income'))
      expect(chip.fromAccounts, chip.month).toBe(amount(s.flow.left.lines, 'from-accounts'))
      expect(chip.expenses, chip.month).toBe(amount(s.flow.right.lines, 'expenses'))
      expect(chip.left, chip.month).toBe(amount(s.flow.right.lines, 'set-aside') + amount(s.flow.right.lines, 'moved'))
      // line one is "Total in", line two is "Total out", and they agree
      expect(chip.income + chip.fromAccounts, chip.month).toBe(s.flow.left.total)
      expect(chip.expenses + chip.left, chip.month).toBe(s.flow.right.total)
      expect(chip.income + chip.fromAccounts, chip.month).toBe(chip.expenses + chip.left)
    }
  })

  it('the demo\'s September and November', async () => {
    const { t, months, engine } = await demo()
    const of = (m: string) => stripMonths(t, engine, months).find((s) => s.month === m)
    // nothing came out of an account in September: line one is the income alone
    expect(of('2026-09')).toEqual({ month: '2026-09', income: 7255_00, fromAccounts: 0, expenses: 3357_00, left: 3898_00 })
    // in November 660.00 comes out of virtual accounts: 7,405 + 660 is 3,896 + 4,169
    expect(of('2026-11')).toEqual({ month: '2026-11', income: 7405_00, fromAccounts: 660_00, expenses: 3896_00, left: 4169_00 })
  })

  it('what is moved out of the plan counts with what is left, so the lines still agree', () => {
    const h = household({ closingRule: 'leftover-plug' })
    const salary = row({ name: 'Salary', section: 'income' })
    const rent = row({ name: 'Rent', section: 'expense' })
    const away = row({ name: 'To my parents', section: 'transfer' })
    const t = tables({ household: [h], rows: [salary, rent, away], cells: [cellValue(salary.id, '2026-01', 3000_00), cellValue(rent.id, '2026-01', 1200_00), cellValue(away.id, '2026-01', 200_00)] })
    const s = buildStatement(t, computeEngine({ tables: t, months: ['2026-01'] }), '2026-01')!
    expect(s.flow.right.lines.map((l) => l.id)).toEqual(['expenses', 'moved', 'set-aside'])
    // 200.00 moved elsewhere and 1,600.00 left over
    expect(stripFigures(s)).toEqual({ income: 3000_00, fromAccounts: 0, expenses: 1200_00, left: 1800_00 })
  })

  it('opens three months before the current one', () => {
    const plan = ['2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08']
    expect(stripStart(plan, '2026-06')).toBe(2) // March, April, May, then June
    // fewer than three months before today: the plan's first month
    expect(stripStart(plan, '2026-02')).toBe(0)
    // today outside the plan: its start, or its last months
    expect(stripStart(plan, '2025-11')).toBe(0)
    expect(stripStart(plan, '2027-03')).toBe(4)
    expect(stripStart([], '2026-06')).toBe(0)
  })
})
