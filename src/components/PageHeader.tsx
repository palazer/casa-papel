import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Redo2, Undo2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useStore } from '@/app/store'
import { useStoreVersion } from '@/app/useStoreVersion'
import { SyncIndicator } from '@/features/sync/SyncIndicator'

/**
 * The toolbar, with what stands above it, as a bar that stays at the top of the window (DESIGN.md §2), from `md` up:
 * on the page ground, as wide as the page with its padding, so what scrolls under it does not show beside or through
 * it. The header itself makes no box then (`contents`), so the bar sticks for the length of the page and not only of
 * the header.
 */
const BAR = 'md:sticky md:top-0 md:z-30 md:-mx-6 md:mb-2 md:bg-background md:px-6 md:py-2 md:data-[stuck=true]:shadow-[0_1px_0_var(--color-border)]'

/**
 * The top of every screen (DESIGN.md §2, after nfl-fantasy's page header): open on the page ground, no card. The
 * screen's name as the H1 over a muted subline (the household), and under them the toolbar, ordered by what a
 * control is about: the screen's own controls at the left (`children`), and at the right end how the page is shown
 * (`tools`, quiet buttons), then the app's own: Undo, Redo and the sync cloud. `notes` are lines of their own under
 * the row (an alert, a warning).
 *
 * `sticky` keeps the toolbar in view while a long page scrolls, and with it what stands right above it (`above`: the
 * Statement's strip of months): the name scrolls away, the months and the month's line stay.
 */
export function PageHeader({ title, subline, children, tools, notes, controls = true, sticky = false, above }: {
  title: string; subline?: ReactNode; children?: ReactNode; controls?: boolean
  /** How the page is shown (view buttons, the legend): quiet, at the right end, before Undo and Redo. */
  tools?: ReactNode
  /** Lines of their own under the toolbar's row: what failed, what the engine warns about. */
  notes?: ReactNode
  /** Right above the toolbar, one bar with it: it stays in view when the toolbar does. */
  above?: ReactNode
  /** The toolbar stays at the top of the window while the page scrolls (from `md` up). */
  sticky?: boolean
}) {
  const { mark, stuck } = useStuck(sticky)
  return (
    <header className={cn('flex flex-col gap-y-2', sticky && 'md:contents')}>
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold leading-8 tracking-tight">{title}</h1>
        {subline && <p className="text-xs leading-4 text-muted-foreground">{subline}</p>}
      </div>
      {/* where the bar stands while nothing is scrolled: once this is above the window, the bar is stuck */}
      {sticky && <div ref={mark} className="-mb-px h-px max-md:hidden" aria-hidden />}
      <div className={cn(sticky && BAR)} data-stuck={sticky ? stuck : undefined} data-sticky-bar={sticky || undefined}>
        {above && <div className="mb-2 min-w-0">{above}</div>}
        <div className="flex min-h-[28px] flex-wrap items-center gap-x-2.5 gap-y-1 text-xs">
          {children}
          {(tools || controls) && (
            // on a phone the group takes a line of its own: the page's tools from the left, the app's at the right
            <div className="ml-auto flex flex-wrap items-center gap-x-1 gap-y-1 max-md:w-full">
              {tools}
              {controls && <HistoryControls />}
              {controls && <SyncIndicator />}
            </div>
          )}
        </div>
        {/* a line that says nothing takes no room */}
        {notes && <div className="mt-1 space-y-1 text-xs empty:hidden">{notes}</div>}
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
    <span className="ml-auto inline-flex items-center gap-0.5 pl-1.5">
      <Button variant="ghost" size="icon-xs" aria-label="Undo" disabled={!store.canUndo} onClick={() => void store.undo()}><Undo2 /></Button>
      <Button variant="ghost" size="icon-xs" aria-label="Redo" disabled={!store.canRedo} onClick={() => void store.redo()}><Redo2 /></Button>
    </span>
  )
}
