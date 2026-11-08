import { describe, expect, it } from 'vitest'
import { defaultMonths } from '@/app/useEngine'
import { EMPTY_TABLES, HouseholdSchema, MonthStateSchema, RecurringItemSchema, RowSchema, newId, type Cell, type Tables } from '@/model'
import { planEnd, planRecurringPosts } from '@/store'

const TODAY = '2026-11'
const ts = Date.now()
const base = () => ({ id: newId(), createdAt: ts, updatedAt: ts, deletedAt: null })
const household = HouseholdSchema.parse({ ...base(), name: 'H', baseCurrency: 'EUR', locale: 'en-IE', startMonth: '2026-09', closingRule: 'savings-plug', moneyMode: 'pooled', pocketTotal: 0 })
const row = RowSchema.parse({ ...base(), name: 'Rent', section: 'expense', order: 'a0', defaultStatus: 'committed' })
const item = RecurringItemSchema.parse({ ...base(), name: 'Rent', rowId: row.id, amount: 100000, startMonth: '2026-09', cadence: { intervalMonths: 1, anchorMonth: 1 } })
const tables: Tables = { ...EMPTY_TABLES, household: [household], rows: [row], recurringItems: [item] }
const userCell = (month: string): Cell => ({ rowId: row.id, month, mode: 'value', value: 5000, items: [], note: null, currencyOverride: null, markedDone: false, updatedAt: ts })
const last = (months: string[]) => months[months.length - 1]

describe('defaultMonths', () => {
  it('ends in a December: this year until September, next year from October on', () => {
    expect(last(defaultMonths(household, tables, '2026-09'))).toBe('2026-12')
    expect(last(defaultMonths(household, tables, '2026-10'))).toBe('2027-12')
    expect(last(defaultMonths(household, tables, TODAY))).toBe('2027-12')
    expect(last(defaultMonths(household, tables, '2027-01'))).toBe('2027-12')
    expect(defaultMonths(household, tables, '2026-09')[0]).toBe('2026-09')
  })
  it('is a fixed point under recurring posting', () => {
    const months = defaultMonths(household, tables, TODAY)
    expect(months).toHaveLength(16)
    const cells = planRecurringPosts(tables, months).map((m) => (m as { record: Cell }).record)
    expect(cells).toHaveLength(months.length)
    const posted = { ...tables, cells }
    expect(defaultMonths(household, posted, TODAY)).toEqual(months)
    expect(planRecurringPosts(posted, months)).toEqual([])
  })
  it('still extends past a cell the user edited, to that year\'s December', () => {
    expect(last(defaultMonths(household, { ...tables, cells: [userCell('2028-02')] }, TODAY))).toBe('2028-12')
    // a posting-only cell does not count
    const managed: Cell = { ...userCell('2028-02'), mode: 'items', value: null, items: [{ id: newId(), label: 'Rent', amount: 100000, status: 'committed', fundedBy: 'cash', date: null, note: null, recurringItemId: item.id, kind: 'normal', skipped: false, pinned: false }] }
    expect(last(defaultMonths(household, { ...tables, cells: [managed] }, TODAY))).toBe('2027-12')
    // a cell of a removed row does not count either
    const gone = { ...tables, rows: [{ ...row, deletedAt: ts }], cells: [userCell('2028-02')] }
    expect(last(defaultMonths(household, gone, TODAY))).toBe('2027-12')
  })
  it('a closed month and "Add <year>" raise the end to their December', () => {
    const closed = MonthStateSchema.parse({ month: '2028-03', closed: true, closedAt: ts, updatedAt: ts })
    expect(planEnd(household, { ...tables, monthStates: [closed] }, TODAY)).toBe('2028-12')
    expect(planEnd({ ...household, planUntil: '2029-12' }, tables, TODAY)).toBe('2029-12')
    // the rule still wins when the stored year is behind it
    expect(planEnd({ ...household, planUntil: '2026-12' }, tables, TODAY)).toBe('2027-12')
  })
  it('never starts after it ends', () => {
    const late = { ...household, startMonth: '2028-03' }
    const months = defaultMonths(late, tables, TODAY)
    expect(months[0]).toBe('2028-03')
    expect(last(months)).toBe('2028-12')
  })
})
