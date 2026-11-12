import { Plus } from 'lucide-react'
import { cn } from '@/lib/utils'
import { CHEVRON_SLOT, TICK_GAP } from './lead'

/**
 * The lead of an add control on the Statement (DESIGN.md §7): the columns a row has before its name, with the "+" in
 * the last of them. Among ticked rows that is the tick's column, elsewhere the arrow's, so a suggestion, "Add row" and
 * the rows above them share one indent: the "+" under the ticks, the words under the names. It goes first inside a
 * flex line with a 6 px gap (`gap-1.5`), like a row's own columns.
 */
export function AddLead({ ticks }: { ticks: boolean }) {
  const plus = <Plus className="size-3.5 text-muted-foreground" />
  if (!ticks) return <span className={CHEVRON_SLOT} data-lead="plus" aria-hidden>{plus}</span>
  return (
    <>
      <span className={CHEVRON_SLOT} aria-hidden />
      <span className={cn(TICK_GAP, 'flex items-center justify-center')} data-lead="plus" aria-hidden>{plus}</span>
    </>
  )
}
