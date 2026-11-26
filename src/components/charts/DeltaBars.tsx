import type { ReactNode } from 'react'
import type { MonthKey } from '@/model'
import { AXIS_TEXT, GRID_LINE, cut, tickText } from './frame'
import { Plot } from './Plot'
import { amountScale, barPath, barWidth, monthTicks, yOf } from './scale'
import { txt } from '@/i18n'

/** A bar of a chart of months: the months it stands for (one, or a year's), and its amount. Null: nothing to compare with. */
export interface SpanBar {
  from: number
  to: number
  value: number | null
}

export interface DeltaRow {
  id: string
  label: string
  color: string
  bars: SpanBar[]
}

const ROW = 64
const ROW_TOP = 18
const ROW_GAP = 10
const BOTTOM = 22

/**
 * How each subject moved from the point before, as bars on the months of the chart above (DESIGN.md §11): one row
 * per subject, each on its own scale, because a change in net worth and a change in expenses differ tenfold and one
 * scale would flatten the smaller. Up is above the row's line, down below it. The months of the plan are paler. A row
 * is named at its top left, with the largest change on its scale beside the line it stands for.
 */
export function DeltaBars({ months, rows, planFrom, now, at, onAt, unit, axisText, locale, tip, label }: {
  months: MonthKey[]
  rows: DeltaRow[]
  planFrom: number
  now: number | null
  at: number | null
  onAt: (i: number | null) => void
  unit: number
  axisText: (amount: number) => string
  locale: string
  tip?: (i: number) => ReactNode
  label: string
}) {
  const n = months.length
  const height = rows.length * ROW + Math.max(0, rows.length - 1) * ROW_GAP + BOTTOM
  return (
    <Plot count={n} height={height} label={label} at={at} onAt={onAt} start={now} tip={tip} kind="changes">
      {({ left, plotRight, axis, x }) => (
        <>
          {rows.map((row, k) => {
            const top = k * (ROW + ROW_GAP) + ROW_TOP
            const bottom = k * (ROW + ROW_GAP) + ROW
            const values = row.bars.map((b) => b.value ?? 0)
            // a subject that did not move has no scale to show: the row says so beside its name
            const still = values.every((v) => v === 0)
            const scale = amountScale(Math.min(0, ...values), Math.max(0, ...values), unit, 2)
            const y = (v: number) => yOf(scale, v, top, bottom)
            return (
              <g key={row.id} data-row={row.id}>
                <rect x={left} y={top - 12} width={8} height={8} rx={2} style={{ fill: row.color }} />
                <text x={left + 12} y={top - 5} className="fill-foreground text-[11px]">
                  {cut(row.label, 28)}{still && <tspan className="fill-muted-foreground"> · {txt.components.charts.noChange}</tspan>}
                </text>
                {/* the two ends of the row's own scale, and the line the bars grow from */}
                {!still && [scale.max, scale.min].filter((t) => t !== 0).map((t) => (
                  <g key={t}>
                    <line x1={left} x2={plotRight} y1={y(t)} y2={y(t)} className={GRID_LINE} />
                    <text x={left - 6} y={y(t)} dy="0.32em" textAnchor="end" className={AXIS_TEXT}>{axisText(t)}</text>
                  </g>
                ))}
                <line x1={left} x2={plotRight} y1={y(0)} y2={y(0)} className="stroke-muted-foreground/50" />
                {row.bars.map((b) => {
                  if (!b.value) return null
                  const w = barWidth(axis.slot, b.to - b.from + 1)
                  const cx = (x(b.from) + x(b.to)) / 2
                  const pointed = at != null && at >= b.from && at <= b.to
                  return (
                    <path
                      key={b.from} d={barPath(cx - w / 2, w, y(0), y(b.value))} data-bar={b.from} data-plan={b.to >= planFrom || undefined}
                      style={{ fill: row.color, opacity: pointed ? 1 : b.to >= planFrom ? 0.4 : 0.9 }}
                    />
                  )
                })}
              </g>
            )
          })}
          {now != null && <line x1={x(now)} x2={x(now)} y1={2} y2={height - BOTTOM} className="stroke-muted-foreground/60" data-now />}
          {at != null && <line x1={x(at)} x2={x(at)} y1={2} y2={height - BOTTOM} className="stroke-foreground/50" data-pointer />}
          {monthTicks(months, axis.slot).map((t) => (
            <text key={t.month} x={x(t.i)} y={height - 6} textAnchor="middle" className={AXIS_TEXT}>{tickText(t, locale)}</text>
          ))}
        </>
      )}
    </Plot>
  )
}
