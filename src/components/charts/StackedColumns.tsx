import type { ReactNode } from 'react'
import type { MonthKey } from '@/model'
import { cn } from '@/lib/utils'
import { AXIS_TEXT, GRID_LINE, tickText } from './frame'
import { Plot } from './Plot'
import { amountScale, barPath, barWidth, monthTicks, yOf } from './scale'
import { txt } from '@/i18n'

const T = txt.components.charts

export interface StackPart {
  id: string
  label: string
  color: string
}

/** A column: the months it stands for (one, or a year's) and the amount of each part, by the part's id. */
export interface StackColumn {
  from: number
  to: number
  parts: Record<string, number>
}

const TOP = 14
const BOTTOM = 22
/** The ground showing between two parts of a column: what separates them, where a stroke would add ink that is no data. */
const GAP = 2

/**
 * One subject as its parts (DESIGN.md §11): a column per month, or per year on a long range, stacked from the parts
 * in the order given, so the column's height is the subject's total. A part that is owed (the debts under net worth)
 * is stacked downwards from zero. `across` draws a line over the columns for a total that is not their height: net
 * worth, which is what stands above zero less what stands below. The columns of the plan are paler. The parts are
 * named in the legend under the chart, in the order they are stacked.
 */
export function StackedColumns({ months, columns, parts, across, planFrom, now, at, onAt, unit, axisText, locale, tip, label, height = 260 }: {
  months: MonthKey[]
  columns: StackColumn[]
  /** From the bottom of the stack up. */
  parts: StackPart[]
  across?: { label: string; color: string; values: number[] }
  planFrom: number
  now: number | null
  at: number | null
  onAt: (i: number | null) => void
  unit: number
  axisText: (amount: number) => string
  locale: string
  tip?: (i: number) => ReactNode
  label: string
  height?: number
}) {
  const n = months.length
  const bottom = height - BOTTOM
  const sums = columns.map((c) => {
    let up = 0
    let down = 0
    for (const p of parts) {
      const v = c.parts[p.id] ?? 0
      if (v >= 0) up += v
      else down += v
    }
    return { up, down }
  })
  const scale = amountScale(Math.min(0, ...sums.map((s) => s.down), ...(across?.values ?? [])), Math.max(0, ...sums.map((s) => s.up), ...(across?.values ?? [])), unit)
  const y = (v: number) => yOf(scale, v, TOP, bottom)

  return (
    <div>
      <Plot count={n} height={height} label={label} at={at} onAt={onAt} start={now} tip={tip} kind="parts">
        {({ left, plotRight, axis, x }) => (
          <>
            {scale.ticks.map((t) => (
              <g key={t}>
                <line x1={left} x2={plotRight} y1={y(t)} y2={y(t)} className={cn(GRID_LINE, t === 0 && scale.min < 0 && 'stroke-muted-foreground/50')} />
                <text x={left - 6} y={y(t)} dy="0.32em" textAnchor="end" className={AXIS_TEXT}>{axisText(t)}</text>
              </g>
            ))}
            {monthTicks(months, axis.slot).map((t) => (
              <text key={t.month} x={x(t.i)} y={height - 6} textAnchor="middle" className={AXIS_TEXT}>{tickText(t, locale)}</text>
            ))}
            {now != null && <line x1={x(now)} x2={x(now)} y1={TOP - 2} y2={bottom} className="stroke-muted-foreground/60" data-now />}
            {columns.map((c) => {
              const w = barWidth(axis.slot, c.to - c.from + 1)
              const cx = (x(c.from) + x(c.to)) / 2
              const pointed = at != null && at >= c.from && at <= c.to
              let up = 0
              let down = 0
              // the part that ends the stack, on each side of zero, is the one with the rounded end
              const lastUp = [...parts].reverse().find((p) => (c.parts[p.id] ?? 0) > 0)?.id
              const lastDown = [...parts].reverse().find((p) => (c.parts[p.id] ?? 0) < 0)?.id
              return (
                <g key={c.from} data-column={c.from} data-plan={c.to >= planFrom || undefined} style={{ opacity: pointed ? 1 : c.to >= planFrom ? 0.5 : 0.95 }}>
                  {parts.map((p) => {
                    const v = c.parts[p.id] ?? 0
                    if (v === 0) return null
                    const from = v > 0 ? up : down
                    const to = from + v
                    if (v > 0) up = to
                    else down = to
                    const y0 = y(from)
                    const y1 = y(to)
                    // the ground shows between two parts: each gives up the gap at the end it starts from, except at zero
                    const base = from === 0 ? y0 : y0 + (v > 0 ? -GAP : GAP)
                    if (Math.abs(y1 - base) < 0.5 || (v > 0 ? y1 > base : y1 < base)) return null
                    const end = p.id === (v > 0 ? lastUp : lastDown)
                    return end
                      ? <path key={p.id} d={barPath(cx - w / 2, w, base, y1)} data-part={p.id} style={{ fill: p.color }} />
                      : <rect key={p.id} x={cx - w / 2} y={Math.min(base, y1)} width={w} height={Math.abs(y1 - base)} data-part={p.id} style={{ fill: p.color }} />
                  })}
                </g>
              )
            })}
            {across && (
              <g data-across fill="none" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" style={{ stroke: across.color }}>
                {columns.length > 1 && <path d={columns.map((c, k) => `${k === 0 ? 'M' : 'L'}${((x(c.from) + x(c.to)) / 2).toFixed(1)} ${y(across.values[k]).toFixed(1)}`).join(' ')} />}
                {columns.map((c, k) => <circle key={c.from} cx={(x(c.from) + x(c.to)) / 2} cy={y(across.values[k])} r={columns.length > 40 ? 0 : 3} strokeWidth={1.5} className="stroke-card" style={{ fill: across.color }} />)}
              </g>
            )}
            {at != null && <line x1={x(at)} x2={x(at)} y1={TOP} y2={bottom} className="stroke-foreground/50" data-pointer />}
          </>
        )}
      </Plot>
      <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 px-1 text-[11px]" data-testid="chart-legend" aria-label={T.parts}>
        {parts.map((p) => (
          <li key={p.id} className="flex items-center gap-1.5">
            <span className="size-2.5 shrink-0 rounded-[3px]" style={{ background: p.color }} aria-hidden />
            {p.label}
          </li>
        ))}
        {across && (
          <li className="flex items-center gap-1.5">
            <span className="h-0.5 w-3 shrink-0 rounded-full" style={{ background: across.color }} aria-hidden />
            {across.label}
          </li>
        )}
      </ul>
    </div>
  )
}
