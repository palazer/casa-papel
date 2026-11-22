import { useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { chartFrame, type ChartFrame } from './frame'
import { monthAt, xOf } from './scale'
import { useWidth } from './useWidth'

export interface PlotArea extends ChartFrame {
  /** Where the plot ends at the right, before the room for the lines' names. */
  plotRight: number
  x: (i: number) => number
}

/**
 * What every chart of a page shares (DESIGN.md §11): it is drawn in real pixels at its measured width, the pointer
 * finds a month anywhere over the plot, and with the keyboard the chart is one stop for the Tab key where Left, Right,
 * Home and End move along the months and Escape lets go. The month pointed at comes from outside (`at`), so every
 * chart of the page marks the same month; only the chart the pointer or the focus is in says what that month holds
 * (`tip`), beside the pointer on the side that has room.
 */
export function Plot({ count, height, label, at, onAt, start, tip, kind, className, children }: {
  /** How many months the chart shows. */
  count: number
  height: number
  /** What the chart shows, for a reader who cannot see it. */
  label: string
  at: number | null
  onAt: (i: number | null) => void
  /** Where the arrow keys start from when no month is pointed at: the current month. */
  start?: number | null
  tip?: (i: number) => ReactNode
  /** Names the chart in the page (`data-chart`). */
  kind: string
  className?: string
  children: (area: PlotArea) => ReactNode
}) {
  const { ref, width } = useWidth<HTMLDivElement>()
  /** The pointer or the focus is in this chart: it is the one that speaks. */
  const [mine, setMine] = useState(false)
  const frame = chartFrame(width, count)
  const plotRight = width - frame.right
  const x = (i: number) => xOf(frame.axis, i)

  function onPointer(e: PointerEvent<SVGSVGElement>) {
    const px = e.clientX - e.currentTarget.getBoundingClientRect().left
    if (px < frame.left || px > plotRight) return
    setMine(true)
    const i = monthAt(frame.axis, px)
    if (i !== at) onAt(i)
  }
  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const to = e.key === 'ArrowRight' ? (at == null ? (start ?? 0) : at + 1)
      : e.key === 'ArrowLeft' ? (at == null ? (start ?? count - 1) : at - 1)
      : e.key === 'Home' ? 0 : e.key === 'End' ? count - 1 : null
    if (e.key === 'Escape' && at != null) onAt(null)
    if (to == null) return
    e.preventDefault()
    setMine(true)
    onAt(Math.max(0, Math.min(count - 1, to)))
  }
  const leave = () => { setMine(false); onAt(null) }

  return (
    <div
      ref={ref} role="group" aria-label={label} tabIndex={0} onKeyDown={onKeyDown} onBlur={leave}
      className={cn('relative rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring', className)} style={{ height }} data-chart={kind}
    >
      {width > 0 && count > 0 && (
        <svg width={width} height={height} aria-hidden className="block touch-pan-y" onPointerMove={onPointer} onPointerDown={onPointer} onPointerLeave={(e) => { if (e.pointerType === 'mouse') leave() }}>
          {children({ ...frame, plotRight, x })}
        </svg>
      )}
      {at != null && mine && tip && width > 0 && (
        <div
          role="status" data-testid="chart-tip"
          className="pointer-events-none absolute top-2 z-10 w-max max-w-[min(18rem,80vw)] rounded-md border bg-popover px-2.5 py-2 text-xs text-popover-foreground shadow-md"
          style={x(at) < width / 2 ? { left: x(at) + 12 } : { right: width - x(at) + 12 }}
        >
          {tip(at)}
        </div>
      )}
    </div>
  )
}
