import { cn } from '@/lib/utils'
import { doneLabel, type DoneState } from './display'

interface Props {
  done: number
  total: number
  state: DoneState
  className?: string
  /** Inside a control that already says what it is (the Tick): no role, no label of its own. */
  decorative?: boolean
}

/** Traffic light for this month's cells: red ring = nothing done, amber half = partly, green disc = all done. */
export function DoneDot({ done, total, state, className, decorative = false }: Props) {
  const label = doneLabel({ done, total, state })
  return (
    <svg viewBox="0 0 10 10" role={decorative ? undefined : 'img'} aria-hidden={decorative || undefined} aria-label={decorative ? undefined : label} className={cn('size-2 shrink-0', className)}>
      {!decorative && <title>{label}</title>}
      {state === 'all' && <circle cx="5" cy="5" r="4.5" className="fill-done" />}
      {state === 'none' && <circle cx="5" cy="5" r="3.75" className="fill-none stroke-todo" strokeWidth="1.5" />}
      {state === 'partial' && (
        <>
          <path d="M5 0.5 A4.5 4.5 0 0 0 5 9.5 Z" className="fill-partial" />
          <circle cx="5" cy="5" r="3.75" className="fill-none stroke-partial" strokeWidth="1.5" />
        </>
      )}
    </svg>
  )
}
