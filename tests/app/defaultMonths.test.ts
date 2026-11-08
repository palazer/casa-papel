import { describe, expect, it } from 'vitest'
import { defaultMonths } from '@/app/useEngine'
import { EMPTY_TABLES, HouseholdSchema, RecurringItemSchema, RowSchema, addMonths, monthOfDate, newId, type Cell, type Tables } from '@/model'
import { planRecurringPosts } from '@/store'

const ts = Date.now()
const base = () => ({ id: newId(), createdAt: ts, updatedAt: ts, deletedAt: null })
const household = HouseholdSchema.parse({ ...base(), name: 'H', baseCurrency: 'EUR', locale: 'en-IE', startMonth: '2026-09', closingRule: 'savings-plug', moneyMode: 'pooled', pocketTotal: 0 })
const row = RowSchema.parse({ ...base(), name: 'Rent', section: 'expense', order: 'a0', defaultStatus: 'committed' })
const item = RecurringItemSchema.parse({ ...base(), name: 'Rent', rowId: row.id, amount: 100000, startMonth: '2026-09', cadence: { intervalMonths: 1, anchorMonth: 1 } })
const tables: Tables = { ...EMPTY_TABLES, household: [household], rows: [row], recurringItems: [item] }

describe('defaultMonths', () => {
  it('is a fixed point under recurring posting', () => {
    const months = defaultMonths(household, tables)
    expect(months[months.length - 1]).toBe(addMonths(monthOfDate(), 12))
    const cells = planRecurringPosts(tables, months).map((m) => (m as { record: Cell }).record)
    expect(cells).toHaveLength(months.length)
    const posted = { ...tables, cells }
    expect(defaultMonths(household, posted)).toEqual(months)
    expect(planRecurringPosts(posted, months)).toEqual([])
  })
  it('still extends past a cell the user edited', () => {
    const far = addMonths(monthOfDate(), 15)
    const userCell: Cell = { rowId: row.id, month: far, mode: 'value', value: 5000, items: [], note: null, currencyOverride: null, markedDone: false, updatedAt: ts }
    const months = defaultMonths(household, { ...tables, cells: [userCell] })
    expect(months[months.length - 1]).toBe(addMonths(far, 12))
  })
})
