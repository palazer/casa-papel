import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Redo2, Undo2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useStore } from '@/app/store'
import { useStoreVersion } from '@/app/useStoreVersion'
import { SyncIndicator } from '@/features/sync/SyncIndicator'

/**
 * The toolbar as a bar that stays at the top of the window (DESIGN.md §2), from `md` up: on the page ground, as wide
 * as the page with its padding, so what scrolls under it does not show beside or through it. The header itself makes
 * no box then (`contents`), so the bar sticks for the length of the page and not only of the header.
 */
const BAR = 'md:sticky md:top-0 md:z-30 md:-mx-6 md:mb-2 md:bg-background md:px-6 md:py-2 md:data-[stuck=true]:shadow-[0_1px_0_var(--color-border)]'

/**
 * The top of every screen (DESIGN.md §2, after nfl-fantasy's page header): open on the page ground, no card. The
 * screen's name as the H1 over a muted subline (the household, the month), and under them the toolbar in its own
 * grammar: Undo and Redo first, the screen's controls, the sync cloud at the end. A `basis-full` child (an alert, a
 * notice) wraps onto a line of its own.
 *
 * `sticky` keeps the toolbar, and `below` under it (the Statement's progress line), in view while a long page
 * scrolls: the name scrolls away, the month and its controls stay. `above` stands between the name and the toolbar
 * and scrolls away with the name (the Statement's strip of months).
 */
export function PageHeader({ title, subline, children, controls = true, sticky = false, above, below }: {
  title: string; subline?: ReactNode; children?: ReactNode; controls?: boolean
  /** Between the screen's name and the toolbar; it scrolls away with the name. */
  above?: ReactNode
  /** The toolbar stays at the top of the window while the page scrolls (from `md` up). */
  sticky?: boolean
  /** A line that belongs to the toolbar and stays with it. */
  below?: ReactNode
}) {
  const { mark, stuck } = useStuck(sticky)
  return (
    <header className={cn('flex flex-col gap-y-2', sticky && 'md:contents')}>
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold leading-8 tracking-tight">{title}</h1>
        {subline && <p className="text-xs leading-4 text-muted-foreground">{subline}</p>}
      </div>
      {/* the header makes no box when its bar is sticky, so what stands above the bar brings its own distance to the name */}
      {above && <div className={cn('min-w-0', sticky && 'md:mt-2')}>{above}</div>}
      {/* where the bar stands while nothing is scrolled: once this is above the window, the bar is stuck */}
      {sticky && <div ref={mark} className="-mb-px h-px max-md:hidden" aria-hidden />}
      <div className={cn(sticky && BAR)} data-stuck={sticky ? stuck : undefined} data-sticky-bar={sticky || undefined}>
        <div className="flex min-h-[28px] flex-wrap items-center gap-x-2.5 gap-y-1 text-xs">
          {controls && <HistoryControls />}
          {children}
          {controls && <SyncIndicator className="ml-auto" />}
        </div>
        {below && <div className={sticky ? 'mt-3 md:mt-1.5' : 'mt-4'}>{below}</div>}
      </div>
    </header>
  )
}

/** Whether a sticky bar has left its place: its mark, a line just above it, has scrolled out over the top of the window. */
function useStuck(on: boolean) {
  const mark = useRef<HTMLDivElement>(null)
  const [stuck, setStuck] = useState(false)
  useEffect(() => {
    const el = mark.current
    if (!on || !el || typeof IntersectionObserver === 'undefined') return
    const seen = new IntersectionObserver(([entry]) => setStuck(!entry.isIntersecting && entry.boundingClientRect.top < 0))
    seen.observe(el)
    return () => seen.disconnect()
  }, [on])
  return { mark, stuck: on && stuck }
}

function HistoryControls() {
  const store = useStore()
  useStoreVersion(store)
  return (
    <span className="inline-flex items-center gap-0.5">
      <Button variant="ghost" size="icon-xs" aria-label="Undo" disabled={!store.canUndo} onClick={() => void store.undo()}><Undo2 /></Button>
      <Button variant="ghost" size="icon-xs" aria-label="Redo" disabled={!store.canRedo} onClick={() => void store.redo()}><Redo2 /></Button>
    </span>
  )
}
