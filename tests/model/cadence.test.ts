import { describe, expect, it } from 'vitest'
import { RecurringItemSchema, describeCadence, dueMonthNumbers, isDue, newId, nextDue, repeatsText, runningSchedules } from '@/model'

const base = { startMonth: '2026-01', endMonth: null as string | null, dueMonths: null as number[] | null }

describe('cadence', () => {
  it('derives due months from interval and anchor', () => {
    expect(dueMonthNumbers({ cadence: { intervalMonths: 3, anchorMonth: 1 }, dueMonths: null })).toEqual([1, 4, 7, 10])
    expect(dueMonthNumbers({ cadence: { intervalMonths: 3, anchorMonth: 3 }, dueMonths: null })).toEqual([3, 6, 9, 12])
    expect(dueMonthNumbers({ cadence: { intervalMonths: 6, anchorMonth: 5 }, dueMonths: null })).toEqual([5, 11])
    expect(dueMonthNumbers({ cadence: { intervalMonths: 12, anchorMonth: 11 }, dueMonths: null })).toEqual([11])
    expect(dueMonthNumbers({ cadence: { intervalMonths: 2, anchorMonth: 12 }, dueMonths: null })).toEqual([2, 4, 6, 8, 10, 12])
    expect(dueMonthNumbers({ cadence: null, dueMonths: null })).toHaveLength(12)
    expect(dueMonthNumbers({ cadence: null, dueMonths: [9, 3, 3] })).toEqual([3, 9])
  })
  it('respects start and end months', () => {
    const q = { ...base, cadence: { intervalMonths: 3 as const, anchorMonth: 1 }, startMonth: '2026-04', endMonth: '2026-10' }
    expect(isDue(q, '2026-01')).toBe(false)
    expect(isDue(q, '2026-04')).toBe(true)
    expect(isDue(q, '2026-05')).toBe(false)
    expect(isDue(q, '2026-10')).toBe(true)
    expect(isDue(q, '2027-01')).toBe(false)
  })
  it('describes itself', () => {
    expect(describeCadence({ cadence: { intervalMonths: 1, anchorMonth: 1 }, dueMonths: null })).toBe('Monthly')
    expect(describeCadence({ cadence: { intervalMonths: 3, anchorMonth: 1 }, dueMonths: null })).toBe('Every 3 months (Jan, Apr, Jul, Oct)')
    expect(describeCadence({ cadence: { intervalMonths: 12, anchorMonth: 5 }, dueMonths: null })).toBe('Yearly (May)')
    expect(describeCadence({ cadence: null, dueMonths: [3, 9] })).toBe('Months: Mar, Sep')
  })
  it('names the next month it falls due in, from a month on', () => {
    const yearly = { ...base, cadence: { intervalMonths: 12 as const, anchorMonth: 1 } }
    expect(nextDue(yearly, '2026-01')).toBe('2026-01')
    expect(nextDue(yearly, '2026-02')).toBe('2027-01')
    expect(nextDue(yearly, '2026-12')).toBe('2027-01')
    // before it starts, its first month; once it has ended, none
    expect(nextDue({ ...yearly, startMonth: '2027-06' }, '2026-03')).toBe('2028-01')
    expect(nextDue({ ...yearly, endMonth: '2026-12' }, '2026-02')).toBeNull()
    expect(nextDue({ ...base, cadence: null, dueMonths: [3, 9] }, '2026-04')).toBe('2026-09')
    expect(nextDue({ ...base, cadence: null }, '2026-04')).toBe('2026-04')
  })
  it('a row repeats while one of its schedules has not ended: one says its rhythm, several say how many', () => {
    const [r1, r2] = [newId(), newId()]
    const item = (over: Record<string, unknown>) => RecurringItemSchema.parse({ id: newId(), createdAt: 0, updatedAt: 0, name: 'x', rowId: r1, amount: 100, startMonth: '2026-01', ...over })
    const yearly = item({ cadence: { intervalMonths: 12, anchorMonth: 1 } })
    const ended = item({ endMonth: '2026-03' })
    const gone = item({ deletedAt: 5 })
    const other = item({ rowId: r2 })
    const all = [yearly, ended, gone, other]
    expect(runningSchedules(all, r1, '2026-03')).toEqual([yearly, ended])
    expect(runningSchedules(all, r1, '2026-04')).toEqual([yearly])
    expect(repeatsText([yearly])).toBe('Yearly (Jan)')
    expect(repeatsText([yearly, ended])).toBe('2 items repeat')
  })
})
