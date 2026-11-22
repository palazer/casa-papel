import { describe, expect, it } from 'vitest'
import { OTHER_PART, TREND_SUBJECTS, buildStatement, buildTrends, byYear, computeEngine, foldParts, topParts, trendChange } from '@/engine'
import { monthRange, type Tables } from '@/model'
import { applyMutations, planRecurringPosts } from '@/store'
import { buildDemoTables } from '@/demo/demoHousehold'
import { account, cellValue, household, row, tables } from './helpers'

const demoMonths = monthRange('2026-09', '2027-12')
const base = buildDemoTables()
const demo = applyMutations(base, planRecurringPosts(base, demoMonths))
const sumOf = (o: Record<string, number>) => Object.values(o).reduce((s, v) => s + v, 0)

function trendsOf(t: Tables, months = demoMonths) {
  const engine = computeEngine({ tables: t, months })
  return { engine, trends: buildTrends(t, engine, months) }
}

describe('the figures of the Trends page', () => {
  const { engine, trends } = trendsOf(demo)

  it('every month says what its Statement says, and what the calculation says', () => {
    expect(trends.points.map((p) => p.month)).toEqual(demoMonths)
    for (const p of trends.points) {
      const s = buildStatement(demo, engine, p.month)!
      expect(p.totals.income).toBe(s.flow.left.lines.find((l) => l.id === 'income')!.amount)
      expect(p.totals.expenses).toBe(s.flow.right.lines.find((l) => l.id === 'expenses')!.amount)
      expect(p.totals.accounts).toBe(s.position.left.total)
      expect(p.totals.debts).toBe(s.position.right.lines.find((l) => l.id === 'debts')?.amount ?? 0)
      expect(p.totals.netWorth).toBe(s.position.right.lines.find((l) => l.id === 'net-worth')!.amount)
      // and by another way: the calculation's own totals
      expect(p.totals.netWorth).toBe(engine.netWorth[p.month])
      expect(p.totals.income).toBe(engine.totals[p.month].income)
      expect(p.totals.expenses).toBe(engine.totals[p.month].expensesTotal)
      expect(p.totals.accounts - p.totals.debts).toBe(p.totals.netWorth)
    }
  })

  it('the parts of every subject add up to it, in every month', () => {
    for (const p of trends.points) for (const s of TREND_SUBJECTS) expect(sumOf(p.parts[s]), `${s} ${p.month}`).toBe(p.totals[s])
  })

  it('the parts are the Statement\'s first level: categories, accounts, cards and loans, and the kinds under net worth', () => {
    expect(trends.parts.expenses.map((p) => p.label)).toEqual(['Housing', 'Living', 'Transport', 'Family & pets', 'Fun', 'Personal'])
    expect(trends.parts.accounts.map((p) => p.label)).toContain('Main account')
    expect(trends.parts.accounts.map((p) => p.label)).toContain('Savings')
    expect(trends.parts.debts.map((p) => p.label)).toEqual(['Credit card'])
    expect(trends.parts.netWorth.map((p) => p.id)).toEqual(['main', 'savings-accounts', 'investment-accounts', 'debts'])
    // what is owed pulls net worth down
    const last = trends.points[trends.points.length - 1]
    expect(last.parts.netWorth.debts).toBe(-last.totals.debts)
  })

  it('a section without categories is broken down by its rows', () => {
    const h = household()
    const salary = row({ name: 'Salary', section: 'income', order: 'a0' })
    const rent = row({ name: 'Rent', section: 'expense', order: 'a1' })
    const food = row({ name: 'Food', section: 'expense', order: 'a2' })
    const t = tables({ household: [h], rows: [salary, rent, food], cells: [cellValue(salary.id, '2026-01', 3000_00), cellValue(rent.id, '2026-01', 1200_00), cellValue(food.id, '2026-01', 400_00)] })
    const { trends: plain } = trendsOf(t, monthRange('2026-01', '2026-03'))
    expect(plain.parts.expenses.map((p) => p.label)).toEqual(['Rent', 'Food'])
    expect(plain.points[2].parts.expenses).toEqual({ [rent.id]: 1200_00, [food.id]: 400_00 })
    expect(plain.points[2].totals.expenses).toBe(1600_00)
  })

  it('an account left out of net worth is in neither the accounts nor net worth', () => {
    const h = household()
    const own = account({ name: 'Own money', type: 'cash', openingBalance: 500_00, outsideNetWorth: true })
    const kept = account({ name: 'Rainy day', type: 'savings', openingBalance: 2000_00 })
    const { trends: t } = trendsOf(tables({ household: [h], accounts: [own, kept] }), monthRange('2026-01', '2026-02'))
    expect(t.parts.accounts.map((p) => p.label)).not.toContain('Own money')
    expect(t.points[1].totals.accounts).toBe(sumOf(t.points[1].parts.accounts))
    expect(t.points[1].totals.netWorth).toBe(t.points[1].totals.accounts)
  })
})

describe('the largest parts and "Other"', () => {
  const h = household()
  const amounts = [900_00, 100_00, 800_00, 200_00, 700_00, 300_00, 600_00, 400_00]
  const rows = amounts.map((_, i) => row({ name: `Row ${i + 1}`, section: 'expense', order: `a${i}` }))
  const t = tables({ household: [h], rows, cells: rows.map((r, i) => cellValue(r.id, '2026-01', amounts[i])) })
  const { trends } = trendsOf(t, monthRange('2026-01', '2026-12'))

  it('six get a name, in the Statement\'s order, and the rest is "Other"', () => {
    const { shown, other } = topParts(trends, 'expenses', () => true)
    expect(other).toBe(true)
    expect(shown.map((p) => p.label)).toEqual(['Row 1', 'Row 3', 'Row 5', 'Row 6', 'Row 7', 'Row 8'])
    const folded = foldParts(trends.points[0], 'expenses', shown)
    expect(folded[OTHER_PART]).toBe(300_00)
    expect(sumOf(folded)).toBe(trends.points[0].totals.expenses)
  })

  it('with six parts or fewer there is no "Other"', () => {
    const { trends: few } = trendsOf({ ...t, rows: rows.slice(0, 6) }, monthRange('2026-01', '2026-03'))
    const { shown, other } = topParts(few, 'expenses', () => true)
    expect(other).toBe(false)
    expect(shown).toHaveLength(6)
  })

  it('the choice is made over the months it is given, so a longer range does not change it', () => {
    // a row that is small in the plan and large after it stays in "Other"
    const late = cellValue(rows[1].id, '2027-01', 5000_00)
    const { trends: long } = trendsOf({ ...t, cells: [...t.cells, late] }, monthRange('2026-01', '2027-12'))
    const plan = topParts(long, 'expenses', (m) => m <= '2026-12')
    expect(plan.shown.map((p) => p.label)).not.toContain('Row 2')
    expect(topParts(long, 'expenses', () => true).shown.map((p) => p.label)).toContain('Row 2')
  })
})

describe('by year, and the change from the point before', () => {
  const { trends } = trendsOf(demo)
  const years = byYear(trends.points)

  it('a year is what its months moved, and what there was at its end', () => {
    expect(years.map((y) => [y.month, y.span])).toEqual([['2026-12', 4], ['2027-12', 12]])
    const of2027 = trends.points.filter((p) => p.month.startsWith('2027'))
    expect(years[1].totals.income).toBe(of2027.reduce((s, p) => s + p.totals.income, 0))
    expect(years[1].totals.expenses).toBe(of2027.reduce((s, p) => s + p.totals.expenses, 0))
    expect(years[1].totals.netWorth).toBe(of2027[11].totals.netWorth)
    expect(years[1].totals.debts).toBe(of2027[11].totals.debts)
    for (const y of years) for (const s of TREND_SUBJECTS) expect(sumOf(y.parts[s]), `${s} ${y.month}`).toBe(y.totals[s])
  })

  it('the change is against the point before, and the first point has none', () => {
    expect(trendChange(trends.points, 0, 'netWorth')).toBeNull()
    expect(trendChange(trends.points, 3, 'netWorth')).toBe(trends.points[3].totals.netWorth - trends.points[2].totals.netWorth)
    expect(trendChange(years, 1, 'income')).toBe(years[1].totals.income - years[0].totals.income)
  })
})
