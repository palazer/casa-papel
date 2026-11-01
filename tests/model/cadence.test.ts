import { describe, expect, it } from 'vitest'
import { describeCadence, dueMonthNumbers, isDue } from '@/model'

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
})
