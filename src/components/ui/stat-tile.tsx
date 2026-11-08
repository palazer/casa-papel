import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'
import type { Hue } from '@/app/hues'

/** A read-only number under a small-caps label (DESIGN.md §7). `tone` colours the label in a kind-of-money hue;
 *  the number stays ink. `meta` is a muted third line. A missing value renders `—`. */
export function StatTile({ label, value, meta, tone, title, className, big = false }: { label: ReactNode; value: ReactNode; meta?: ReactNode; tone?: Hue; title?: string; className?: string; big?: boolean }) {
  return (
    <div className={cn('min-w-0 rounded-md border bg-card px-2 py-1', className)} title={title}>
      <div className={cn('truncate text-[10px] font-medium uppercase tracking-wider text-muted-foreground', tone?.text)}>{label}</div>
      <div className={cn('tabular-nums', big ? 'text-lg font-semibold leading-6' : 'text-sm font-semibold leading-5')}>{value ?? '—'}</div>
      {meta != null && <div className="truncate text-[11px] leading-[15px] text-muted-foreground">{meta}</div>}
    </div>
  )
}
