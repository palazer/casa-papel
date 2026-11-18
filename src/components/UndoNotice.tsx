import { X } from 'lucide-react'
import { Button } from '@/components/ui/button'

/**
 * A short message about what was just done, with the way back: `Deleted "Gym".`, `Restored "Rent": its schedule
 * "Rent" runs again.` It floats at the foot of the window, because what it speaks of can be anywhere on a long page,
 * and it goes with the next change (`useUndoNotice`): by then "Undo" would take back something else.
 */
export function UndoNotice({ text, onUndo, onDismiss }: { text: string; onUndo: () => void; onDismiss: () => void }) {
  return (
    <div role="status" className="fixed bottom-20 left-1/2 z-40 flex w-max max-w-[min(calc(100vw-2rem),40rem)] -translate-x-1/2 items-center gap-2 rounded-lg border bg-card py-1.5 pl-3 pr-1.5 text-xs shadow-md md:bottom-6">
      <span className="min-w-0">{text}</span>
      <Button size="xs" variant="outline" className="shrink-0" onClick={onUndo}>Undo</Button>
      <button
        type="button" aria-label="Dismiss" onClick={onDismiss}
        className="inline-flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring pointer-coarse:size-8"
      >
        <X className="size-3.5" aria-hidden />
      </button>
    </div>
  )
}
