import type { ReactNode } from 'react'
import { Redo2, Undo2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useStore } from '@/app/store'
import { useStoreVersion } from '@/app/useStoreVersion'
import { SyncIndicator } from '@/features/sync/SyncIndicator'

/**
 * The top of every screen (DESIGN.md §2, after nfl-fantasy's page header): open on the page ground, no card. The
 * screen's name as the H1 over a muted subline (the household, the month), and under them the toolbar in its own
 * grammar: Undo and Redo first, the screen's controls, the sync cloud at the end. A `basis-full` child (an alert, a
 * notice) wraps onto a line of its own.
 */
export function PageHeader({ title, subline, children, controls = true }: { title: string; subline?: ReactNode; children?: ReactNode; controls?: boolean }) {
  return (
    <header className="flex flex-col gap-y-2">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold leading-8 tracking-tight">{title}</h1>
        {subline && <p className="text-xs leading-4 text-muted-foreground">{subline}</p>}
      </div>
      <div className="flex min-h-[28px] flex-wrap items-center gap-x-2.5 gap-y-1 text-xs">
        {controls && <HistoryControls />}
        {children}
        {controls && <SyncIndicator className="ml-auto" />}
      </div>
    </header>
  )
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
