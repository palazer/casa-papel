import { describe, expect, it } from 'vitest'
import { amountScale, barPath, barWidth, monthAt, monthAxis, monthTicks, spreadLabels, xOf, yOf } from '@/components/charts/scale'
import { monthRange } from '@/model'

describe('the amount axis of a chart', () => {
  it('runs from round number to round number in round steps, and always holds zero', () => {
    expect(amountScale(38_000_00, 61_500_00)).toEqual({ min: 0, max: 80_000_00, ticks: [0, 20_000_00, 40_000_00, 60_000_00, 80_000_00] })
    expect(amountScale(0, 7_405_00)).toEqual({ min: 0, max: 8_000_00, ticks: [0, 2_000_00, 4_000_00, 6_000_00, 8_000_00] })
    expect(amountScale(0, 950_00).ticks).toEqual([0, 250_00, 500_00, 750_00, 1_000_00])
  })

  it('goes below zero when an amount does', () => {
    const s = amountScale(-1_400_00, 2_300_00)
    expect(s.ticks).toEqual([-2_000_00, -1_000_00, 0, 1_000_00, 2_000_00, 3_000_00])
    expect(s.min).toBe(-2_000_00)
    expect(s.max).toBe(3_000_00)
  })

  it('a little below zero gets the room it needs, and no step of its own', () => {
    const s = amountScale(-78_00, 61_000_00)
    expect(s.min).toBe(-78_00)
    expect(s.ticks).toEqual([0, 20_000_00, 40_000_00, 60_000_00, 80_000_00])
    // a quarter of a step or more is a step
    expect(amountScale(-5_000_00, 61_000_00).ticks[0]).toBe(-20_000_00)
  })

  it('has something to draw when every amount is zero', () => {
    expect(amountScale(0, 0)).toEqual({ min: 0, max: 100, ticks: [0, 100] })
  })

  it('a step of 2.5 does not drift', () => {
    expect(amountScale(0, 9_800_00, 100, 4).ticks).toEqual([0, 2_500_00, 5_000_00, 7_500_00, 10_000_00])
  })

  it('puts the largest amount at the top and the smallest at the bottom', () => {
    const s = amountScale(0, 8_000_00)
    expect(yOf(s, 8_000_00, 10, 210)).toBe(10)
    expect(yOf(s, 0, 10, 210)).toBe(210)
    expect(yOf(s, 4_000_00, 10, 210)).toBe(110)
  })
})

describe('the months of a chart', () => {
  it('every month stands in the middle of a slot of its own, and a point of the plot finds its month', () => {
    const axis = monthAxis(50, 400, 16)
    expect(axis.slot).toBe(25)
    expect(xOf(axis, 0)).toBe(62.5)
    expect(xOf(axis, 15)).toBe(437.5)
    expect(monthAt(axis, 50)).toBe(0)
    expect(monthAt(axis, 449)).toBe(15)
    expect(monthAt(axis, 0)).toBe(0)
    expect(monthAt(axis, 999)).toBe(15)
  })

  it('labels every month where there is room, and says the year on the first one and on every January', () => {
    const ticks = monthTicks(monthRange('2026-09', '2027-03'), 60)
    expect(ticks.map((t) => t.month)).toEqual(monthRange('2026-09', '2027-03'))
    expect(ticks.filter((t) => t.year).map((t) => t.month)).toEqual(['2026-09', '2027-01'])
  })

  it('thins the labels out on the same months whatever month the range starts in', () => {
    // 30 px a month: every second month fits, counted from January
    expect(monthTicks(monthRange('2026-09', '2027-06'), 30).map((t) => t.month)).toEqual(['2026-09', '2026-11', '2027-01', '2027-03', '2027-05'])
    // 20 px: quarters
    expect(monthTicks(monthRange('2026-09', '2027-12'), 20).map((t) => t.month)).toEqual(['2026-10', '2027-01', '2027-04', '2027-07', '2027-10'])
  })

  it('a long range is labelled by year', () => {
    const ticks = monthTicks(monthRange('2026-09', '2036-12'), 6)
    expect(ticks.map((t) => t.month)).toEqual(['2027-01', '2028-01', '2029-01', '2030-01', '2031-01', '2032-01', '2033-01', '2034-01', '2035-01', '2036-01'])
    expect(ticks.every((t) => t.only)).toBe(true)
    // tighter still: every second year
    expect(monthTicks(monthRange('2026-09', '2036-12'), 3).map((t) => t.month)).toEqual(['2028-01', '2030-01', '2032-01', '2034-01', '2036-01'])
  })

  it('a range that holds none of its label months still names its first month', () => {
    expect(monthTicks(monthRange('2026-10', '2026-12'), 3).map((t) => t.month)).toEqual(['2026-10'])
  })
})

describe('the labels at the end of the lines', () => {
  it('stay where their lines end when there is room', () => {
    expect(spreadLabels([20, 80, 150], 14, 0, 200)).toEqual([20, 80, 150])
  })
  it('move apart where they would overlap, in the order given', () => {
    expect(spreadLabels([100, 104, 60], 14, 0, 200)).toEqual([100, 114, 60])
  })
  it('stay inside the plot', () => {
    expect(spreadLabels([195, 198, 199], 14, 0, 200)).toEqual([172, 186, 200])
  })
})

describe('a bar', () => {
  it('is never wider than 24 px and always leaves air beside it', () => {
    expect(barWidth(80, 1)).toBe(24)
    expect(barWidth(20, 1)).toBe(14)
    expect(barWidth(6, 1)).toBeCloseTo(4.2)
    // a bar for a year of narrow months
    expect(barWidth(6, 12)).toBe(24)
    expect(barWidth(0.2, 1)).toBe(1)
  })
  it('is rounded at the end that says its amount and square at the line it grows from, upwards and downwards', () => {
    expect(barPath(10, 20, 100, 40)).toBe('M10 100 L10 44 Q10 40 14 40 L26 40 Q30 40 30 44 L30 100 Z')
    expect(barPath(10, 20, 100, 160)).toBe('M10 100 L10 156 Q10 160 14 160 L26 160 Q30 160 30 156 L30 100 Z')
    // a bar shorter than its corners is rounded no further than it is high
    expect(barPath(10, 20, 100, 98)).toBe('M10 100 L10 100 Q10 98 12 98 L28 98 Q30 98 30 100 L30 100 Z')
  })
})
