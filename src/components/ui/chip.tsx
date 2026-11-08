import type { HTMLAttributes } from 'react'
import { cn } from '@/lib/utils'

/**
 * A 16 px tag in a semantic colour (DESIGN.md §7): zinc a neutral fact or idle, emerald done or good, amber a warning
 * or an estimate, rose missing or late, sky information or something of yours, violet a second party. Lowercase copy.
 */
export type ChipTone = 'zinc' | 'emerald' | 'amber' | 'rose' | 'sky' | 'violet'

const FILLED: Record<ChipTone, string> = {
  zinc: 'bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300',
  emerald: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200',
  amber: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200',
  rose: 'bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-200',
  sky: 'bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-200',
  violet: 'bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-200',
}

const OUTLINE: Record<ChipTone, string> = {
  zinc: 'border border-zinc-300 text-zinc-700 dark:border-zinc-600 dark:text-zinc-300',
  emerald: 'border border-emerald-300 text-emerald-700 dark:border-emerald-700 dark:text-emerald-300',
  amber: 'border border-amber-300 text-amber-700 dark:border-amber-700 dark:text-amber-300',
  rose: 'border border-rose-300 text-rose-700 dark:border-rose-700 dark:text-rose-300',
  sky: 'border border-sky-300 text-sky-700 dark:border-sky-700 dark:text-sky-300',
  violet: 'border border-violet-300 text-violet-700 dark:border-violet-700 dark:text-violet-300',
}

export const chipClass = (tone: ChipTone = 'zinc', variant: 'filled' | 'outline' = 'filled', className?: string) =>
  cn('inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded px-1.5 text-[10px] font-medium leading-4 [&_svg]:size-3', variant === 'outline' ? OUTLINE[tone] : FILLED[tone], className)

export function Chip({ tone = 'zinc', variant = 'filled', className, ...props }: HTMLAttributes<HTMLSpanElement> & { tone?: ChipTone; variant?: 'filled' | 'outline' }) {
  return <span data-slot="chip" className={chipClass(tone, variant, className)} {...props} />
}
