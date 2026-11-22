/**
 * A subject's months as a small line with no axis (DESIGN.md §11), for a tile: where it has been, solid, and where
 * the plan takes it, dotted like the plan in the large chart. It says the shape only; the figures stand beside it.
 */
export function Sparkline({ values, planFrom, color, className }: { values: number[]; planFrom: number; color: string; className?: string }) {
  const n = values.length
  if (n < 2) return <svg viewBox="0 0 100 24" className={className} aria-hidden />
  const lo = Math.min(...values)
  const hi = Math.max(...values)
  const x = (i: number) => (i / (n - 1)) * 100
  // a line that does not move runs through the middle
  const y = (v: number) => (hi === lo ? 12 : 21 - ((v - lo) / (hi - lo)) * 18)
  const path = (from: number, to: number) => values.slice(from, to + 1).map((v, k) => `${k === 0 ? 'M' : 'L'}${x(from + k).toFixed(2)} ${y(v).toFixed(2)}`).join(' ')
  const lastPast = Math.min(planFrom, n) - 1
  return (
    // stretched to the tile's width; the stroke keeps its own width
    <svg viewBox="0 0 100 24" preserveAspectRatio="none" className={className} aria-hidden fill="none" strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" style={{ stroke: color }}>
      {lastPast >= 1 && <path d={path(0, lastPast)} vectorEffect="non-scaling-stroke" />}
      {lastPast < n - 1 && <path d={path(Math.max(0, lastPast), n - 1)} vectorEffect="non-scaling-stroke" strokeDasharray="1 4" />}
    </svg>
  )
}
