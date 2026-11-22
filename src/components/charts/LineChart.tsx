import type { ReactNode } from 'react'
import type { MonthKey } from '@/model'
import { cn } from '@/lib/utils'
import { AXIS_TEXT, GRID_LINE, cut, tickText } from './frame'
import { Plot } from './Plot'
import { amountScale, monthTicks, spreadLabels, yOf } from './scale'

export interface ChartLine {
  id: string
  label: string
  /** A CSS colour, usually a token (`var(--worth)`). */
  color: string
  /** One amount per month. */
  values: number[]
}

/** An amount a line is meant to reach: drawn as a dotted line across, with a flag where it is due and a dot where the line gets there. */
export interface ChartTarget {
  id: string
  label: string
  value: number
  /** The first month the target counts from. */
  from: number
  /** The month it is due, when it has one and that month is in view. */
  due: number | null
  /** The first month the line it belongs to meets it, when that is in view; `line` says which line. */
  reached: number | null
  line: string
}

const TOP = 14
const BOTTOM = 22

/**
 * Amounts over the months as lines on one scale (DESIGN.md §11). What is over is a solid line; from `planFrom` on the
 * line is dotted, because that is the plan. An upright hairline marks the current month. Every line is named at its
 * right end where the chart is wide enough, so colour is never the only thing that tells two lines apart.
 */
export function LineChart({ months, lines, planFrom, now, at, onAt, unit, axisText, locale, tip, label, targets = [], height = 260, className }: {
  months: MonthKey[]
  lines: ChartLine[]
  /** The first month that is the plan and not the past: the current month. Past the end when everything is over. */
  planFrom: number
  /** The current month, when it is in view. */
  now: number | null
  /** The month pointed at. */
  at: number | null
  onAt: (i: number | null) => void
  /** The currency's main unit in its smallest (100 for cents). */
  unit: number
  axisText: (amount: number) => string
  locale: string
  /** What the pointed month holds, shown beside the pointer. */
  tip?: (i: number) => ReactNode
  /** What the chart shows, for a reader who cannot see it. */
  label: string
  targets?: ChartTarget[]
  height?: number
  className?: string
}) {
  const n = months.length
  const bottom = height - BOTTOM
  const all = [...lines.flatMap((l) => l.values), ...targets.map((t) => t.value)]
  const scale = amountScale(Math.min(0, ...all), Math.max(0, ...all), unit)
  const y = (v: number) => yOf(scale, v, TOP, bottom)
  // the last month that is over; the dotted part starts there, so the two parts meet
  const lastPast = Math.min(planFrom, n) - 1

  return (
    <Plot count={n} height={height} label={label} at={at} onAt={onAt} start={now} tip={tip} kind="lines" className={className}>
      {({ left, right, plotRight, axis, x }) => {
        const path = (values: number[], from: number, to: number) => values.slice(from, to + 1).map((v, k) => `${k === 0 ? 'M' : 'L'}${x(from + k).toFixed(1)} ${y(v).toFixed(1)}`).join(' ')
        const named = right > 12
        const ends = named ? spreadLabels(lines.map((l) => y(l.values[n - 1] ?? 0)), 14, TOP + 4, bottom - 2) : []
        return (
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
            {now != null && (
              <g data-now>
                <line x1={x(now)} x2={x(now)} y1={TOP - 2} y2={bottom} className="stroke-muted-foreground/60" />
                <text x={x(now)} y={TOP - 5} textAnchor="middle" className={AXIS_TEXT}>now</text>
              </g>
            )}
            {targets.map((t) => (
              <g key={t.id} data-target={t.id}>
                <line x1={x(t.from)} x2={plotRight} y1={y(t.value)} y2={y(t.value)} strokeDasharray="6 4" strokeWidth={1.5} style={{ stroke: 'var(--goal)' }} />
                {/* the month it is due: a small flag on the line */}
                {t.due != null && (
                  <g transform={`translate(${x(t.due).toFixed(1)} ${y(t.value).toFixed(1)})`} data-due>
                    <line x1={0} x2={0} y1={0} y2={-13} strokeWidth={1.5} style={{ stroke: 'var(--goal)' }} />
                    <path d="M0 -13 L9 -10 L0 -7 Z" style={{ fill: 'var(--goal)' }} />
                  </g>
                )}
                <text x={x(t.from) + 2} y={y(t.value) - 5} className="fill-foreground text-[10px]">{cut(t.label, Math.max(12, Math.floor((plotRight - x(t.from)) / 6)))}</text>
              </g>
            ))}
            {lines.map((l) => (
              <g key={l.id} data-line={l.id} fill="none" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" style={{ stroke: l.color }}>
                {lastPast >= 1 && <path d={path(l.values, 0, lastPast)} data-part="past" />}
                {lastPast < n - 1 && <path d={path(l.values, Math.max(0, lastPast), n - 1)} strokeDasharray="1 5" data-part="plan" />}
                {/* one month alone is a point, not a line */}
                {n === 1 && <circle cx={x(0)} cy={y(l.values[0])} r={3} style={{ fill: l.color }} stroke="none" />}
              </g>
            ))}
            {targets.map((t) => {
              const line = lines.find((l) => l.id === t.line)
              if (t.reached == null || !line) return null
              // where the line gets there: a dot on it, ringed in the ground so it reads on the line
              return <circle key={t.id} data-reached={t.id} cx={x(t.reached)} cy={y(line.values[t.reached])} r={4.5} strokeWidth={2} className="stroke-card" style={{ fill: 'var(--goal)' }} />
            })}
            {named && lines.map((l, k) => {
              const end = y(l.values[n - 1] ?? 0)
              return (
                <g key={l.id} data-end={l.id}>
                  {Math.abs(ends[k] - end) > 1 && <line x1={plotRight} x2={plotRight + 8} y1={end} y2={ends[k]} className="stroke-muted-foreground/50" />}
                  <line x1={plotRight + 8} x2={plotRight + 20} y1={ends[k]} y2={ends[k]} strokeWidth={2} strokeLinecap="round" style={{ stroke: l.color }} />
                  <text x={plotRight + 24} y={ends[k]} dy="0.32em" className="fill-foreground text-[11px]">{cut(l.label, 13)}</text>
                </g>
              )
            })}
            {at != null && (
              <g data-pointer>
                <line x1={x(at)} x2={x(at)} y1={TOP} y2={bottom} className="stroke-foreground/50" />
                {lines.map((l) => <circle key={l.id} cx={x(at)} cy={y(l.values[at])} r={4} strokeWidth={2} className="stroke-card" style={{ fill: l.color }} />)}
              </g>
            )}
          </>
        )
      }}
    </Plot>
  )
}
