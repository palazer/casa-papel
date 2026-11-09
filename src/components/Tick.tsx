import type { DoneState } from '@/app/display'
import { DoneDot } from './DoneDot'
import { cn } from '@/lib/utils'

interface Props {
  done: number
  total: number
  state: DoneState
  /** The accessible name, `<line> done`; the state travels through aria-checked. */
  label: string
  disabled?: boolean
  onToggle: () => void
  className?: string
  /** The Statement's desktop rows are 28 px: a smaller dot there. */
  dotClassName?: string
}

/**
 * The Month view's tick (DESIGN.md §8): a 44 px checkbox whose face is the done dot, so done keeps its one mark.
 * One tap marks the line done, a second tap goes back to the row's default; a partly done itemized line is `mixed`.
 */
export function Tick({ done, total, state, label, disabled, onToggle, className, dotClassName }: Props) {
  return (
    <button
      type="button" role="checkbox" aria-checked={state === 'all' ? true : state === 'partial' ? 'mixed' : false} aria-label={label} disabled={disabled} onClick={onToggle}
      className={cn('flex size-11 shrink-0 items-center justify-center rounded-lg outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:opacity-60 disabled:hover:bg-transparent', className)}
    >
      <DoneDot done={done} total={total} state={state} className={cn('size-5', dotClassName)} decorative />
    </button>
  )
}
