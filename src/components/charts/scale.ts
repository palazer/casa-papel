import { parseMonth, type MonthKey } from '@/model'

/**
 * Geometry for the charts (DESIGN.md §11), without React: round steps for an amount axis, where the months stand,
 * and which of them get a label. Amounts are numbers in the currency's smallest unit, as everywhere in the app.
 */

export interface AmountScale {
  min: number
  max: number
  ticks: number[]
}

/**
 * An axis from round number to round number that holds `lo` to `hi` and always zero: lines and bars of different
 * subjects share it, and a bar must grow from zero. The step is 1, 2, 2.5 or 5 times a power of ten (in the currency's
 * main unit: `unit` is 100 for cents), chosen so that about `about` steps cover the range.
 */
export function amountScale(lo: number, hi: number, unit = 100, about = 4): AmountScale {
  const low = Math.min(0, lo)
  const high = Math.max(0, hi)
  if (high === low) return { min: 0, max: unit, ticks: [0, unit] }
  const rough = (high - low) / about / unit
  const power = 10 ** Math.floor(Math.log10(rough))
  const step = ([1, 2, 2.5, 5, 10].find((m) => m * power >= rough) ?? 10) * power * unit
  const min = Math.floor(low / step) * step
  const max = Math.ceil(high / step) * step
  const ticks: number[] = []
  // counted in whole steps, so a step of 2.5 never drifts
  for (let i = Math.round(min / step); i <= Math.round(max / step); i++) ticks.push(i * step)
  return { min, max, ticks }
}

/** Where a value stands between the top and the bottom of a plot: the scale's `max` at `top`, its `min` at `bottom`. */
export function yOf(scale: AmountScale, value: number, top: number, bottom: number): number {
  return bottom - ((value - scale.min) / (scale.max - scale.min)) * (bottom - top)
}

/** The months across a plot: every month has a slot of the same width, and stands in the middle of its own. */
export interface MonthAxis {
  left: number
  slot: number
  count: number
}
export const monthAxis = (left: number, width: number, count: number): MonthAxis => ({ left, slot: count > 0 ? width / count : width, count })
export const xOf = (axis: MonthAxis, i: number): number => axis.left + (i + 0.5) * axis.slot
/** The month under a point of the plot, by its distance from the plot's left edge. */
export const monthAt = (axis: MonthAxis, x: number): number => Math.max(0, Math.min(axis.count - 1, Math.floor((x - axis.left) / axis.slot)))

/**
 * Which months get a label under the axis, so that labels stand at least `room` apart: every month, every second,
 * every quarter, every half year, or only the Januaries (every year, every second, every fifth). A label that starts a
 * year, and the first one, say the year; from a label per year on they say nothing else.
 */
export function monthTicks(months: MonthKey[], slot: number, room = 56): Array<{ i: number; month: MonthKey; year: boolean; only: boolean }> {
  if (months.length === 0) return []
  const every = [1, 2, 3, 6, 12, 24, 60].find((n) => n * slot >= room) ?? 120
  const out: Array<{ i: number; month: MonthKey; year: boolean; only: boolean }> = []
  months.forEach((m, i) => {
    const { year, month } = parseMonth(m)
    // counted from January, so the labels fall on the same months whatever month the range starts in
    const on = every >= 12 ? month === 1 && year % (every / 12) === 0 : (month - 1) % every === 0
    if (on) out.push({ i, month: m, year: month === 1 || out.length === 0, only: every >= 12 })
  })
  // a short range that starts after its only label month still names its first month
  if (out.length === 0) out.push({ i: 0, month: months[0], year: true, only: false })
  return out
}

/**
 * Labels at the right end of their lines, kept at least `gap` apart: where two would overlap they are moved apart
 * around the place they share, inside `top` to `bottom`. Returns the place of each label in the order given.
 */
export function spreadLabels(wanted: number[], gap: number, top: number, bottom: number): number[] {
  const order = wanted.map((y, i) => ({ y, i })).sort((a, b) => a.y - b.y)
  const placed = order.map((o) => o.y)
  // downwards: nothing closer than `gap` to the one above it
  for (let k = 1; k < placed.length; k++) placed[k] = Math.max(placed[k], placed[k - 1] + gap)
  // what ran out of the bottom is pushed back up
  if (placed.length && placed[placed.length - 1] > bottom) {
    placed[placed.length - 1] = bottom
    for (let k = placed.length - 2; k >= 0; k--) placed[k] = Math.min(placed[k], placed[k + 1] - gap)
  }
  const out = new Array<number>(wanted.length)
  order.forEach((o, k) => { out[o.i] = Math.max(top, placed[k]) })
  return out
}
