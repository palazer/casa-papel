import { describe, expect, it } from 'vitest'
import { addMonths, compareMonths, isPastMonth, lastDayOfMonth, monthDiff, monthKey, monthOfDate, monthRange, parseMonth } from '@/model'

describe('month keys', () => {
  it('builds and parses', () => {
    expect(monthKey(2026, 1)).toBe('2026-01')
    expect(parseMonth('2026-12')).toEqual({ year: 2026, month: 12 })
    expect(() => parseMonth('2026-13')).toThrow()
  })
  it('adds across year boundaries', () => {
    expect(addMonths('2026-12', 1)).toBe('2027-01')
    expect(addMonths('2026-01', -1)).toBe('2025-12')
    expect(addMonths('2026-10', 15)).toBe('2028-01')
  })
  it('ranges and diffs', () => {
    expect(monthRange('2026-11', '2027-02')).toEqual(['2026-11', '2026-12', '2027-01', '2027-02'])
    expect(monthRange('2026-11', '2026-10')).toEqual([])
    expect(monthDiff('2026-10', '2027-12')).toBe(14)
    expect(compareMonths('2026-01', '2026-02')).toBe(-1)
  })
  it('a month is over when it lies before the current one', () => {
    expect(isPastMonth('2026-10', '2026-11')).toBe(true)
    expect(isPastMonth('2026-11', '2026-11')).toBe(false)
    expect(isPastMonth('2026-12', '2026-11')).toBe(false)
    expect(isPastMonth('2025-12', '2026-01')).toBe(true)
    // left out, today is the calendar's
    expect(isPastMonth(addMonths(monthOfDate(), -1))).toBe(true)
    expect(isPastMonth(monthOfDate())).toBe(false)
  })
  it('last day of month', () => {
    expect(lastDayOfMonth('2026-02')).toBe('2026-02-28')
    expect(lastDayOfMonth('2028-02')).toBe('2028-02-29')
    expect(lastDayOfMonth('2025-10')).toBe('2025-10-31')
  })
})
