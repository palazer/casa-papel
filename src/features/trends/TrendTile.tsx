import { ArrowDownRight, ArrowUpRight } from 'lucide-react'
import { Sparkline } from '@/components/charts/Sparkline'
import { cn } from '@/lib/utils'

/**
 * A subject of the Trends page as a tile that is a switch (DESIGN.md §11): its figure for the current month, how it
 * moved from the month before, and its months as a small line. Pressed, the subject is on the charts; the square
 * before its name is filled then and wears the colour its line has, so the tiles are the charts' legend.
 */
export function TrendTile({ label, color, on, onToggle, value, change, changeText, since, values, planFrom }: {
  label: string
  color: string
  on: boolean
  onToggle: () => void
  /** The current month's figure, formatted. */
  value: string
  /** How it moved from the month before: null when there is no month before. */
  change: number | null
  changeText: string
  /** The month before, by name. */
  since: string
  values: number[]
  planFrom: number
}) {
  const moved = change == null ? 'nothing before it to compare with' : change === 0 ? `no change from ${since}` : `${change > 0 ? 'up' : 'down'} ${changeText} from ${since}`
  return (
    <button
      type="button" aria-pressed={on} onClick={onToggle} aria-label={`${label}: ${value}, ${moved}`} data-subject-tile
      className={cn(
        'min-w-0 rounded-md border bg-card px-2.5 py-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring',
        on ? 'border-primary shadow-[inset_0_0_0_1px_var(--color-primary)]' : 'hover:bg-muted/50',
      )}
    >
      <span className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
        <span className="size-2.5 shrink-0 rounded-[3px]" style={on ? { background: color } : { boxShadow: `inset 0 0 0 1.5px ${color}` }} aria-hidden />
        <span className="truncate">{label}</span>
      </span>
      <span className="mt-0.5 block truncate text-lg font-semibold leading-6">{value}</span>
      <span className="flex items-center gap-0.5 text-[11px] leading-[15px] text-muted-foreground" title={change == null ? undefined : `From ${since}`}>
        {change == null ? '–' : change === 0 ? 'no change' : (
          <>
            {change > 0 ? <ArrowUpRight className="size-3" aria-hidden /> : <ArrowDownRight className="size-3" aria-hidden />}
            <span className="tabular-nums">{changeText}</span>
          </>
        )}
      </span>
      <Sparkline values={values} planFrom={planFrom} color={color} className="mt-1 block h-6 w-full" />
    </button>
  )
}
