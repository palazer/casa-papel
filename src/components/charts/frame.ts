import { formatMonth } from '@/app/format'
import { formatDate } from '@/i18n'
import { parseMonth, type MonthKey } from '@/model'
import { monthAxis, type MonthAxis } from './scale'

/**
 * The frame the Trends charts share (DESIGN.md §11): the same room at the left for the amounts and at the right for
 * the names of the lines, so that a month stands at the same place in every chart of the page and one upright line
 * can run through them all.
 */
export interface ChartFrame {
  width: number
  left: number
  right: number
  axis: MonthAxis
}

/** Room for an amount like "€120K" at the left; at the right, room for the lines' names where the page is wide enough for them. */
export const LEFT = 48
export const NAMES = 104
export const NAMES_FROM = 640

export function chartFrame(width: number, count: number): ChartFrame {
  const right = width >= NAMES_FROM ? NAMES : 12
  return { width, left: LEFT, right, axis: monthAxis(LEFT, Math.max(0, width - LEFT - right), count) }
}

/** A month under the axis: "Nov", "Jan 2027" where a year starts or the axis does, "2028" on an axis of years. */
export function tickText(t: { month: MonthKey; year: boolean; only: boolean }, locale: string): string {
  const { year, month } = parseMonth(t.month)
  if (t.only) return String(year)
  if (t.year) return formatMonth(t.month, locale)
  return formatDate(new Date(year, month - 1, 1), locale, { month: 'short' })
}

/** Text in a chart is ink, never a line's colour (the mark beside it carries that). */
export const AXIS_TEXT = 'fill-muted-foreground text-[10px] tabular-nums'
export const GRID_LINE = 'stroke-border'

/** A name cut to `n` characters, with "…" where it was cut: SVG text does not shorten itself. */
export const cut = (s: string, n: number): string => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s)
