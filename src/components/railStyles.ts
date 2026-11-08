import type { MouseEvent } from 'react'
import { cn } from '@/lib/utils'

/** A plain click opens the screen in place; Cmd, Ctrl, Shift, Alt or a middle click keeps the link's own behaviour. */
export const follow = (e: MouseEvent, go: () => void) => {
  if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
  e.preventDefault()
  go()
}

/** Two letters for the household: the initials of its first two words, or the first two letters of one. */
export function monogram(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return 'CP'
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase()
  return (words[0][0] + words[1][0]).toUpperCase()
}

/** The rail's tile: lime for the open screen, faint white for the others (DESIGN.md §2). */
export const tileClass = (active: boolean, size: 'rail' | 'tabs' = 'rail') =>
  cn(
    'flex items-center justify-center rounded-lg transition-colors',
    size === 'rail' ? 'h-[30px] w-10' : 'h-7 w-12',
    active ? 'bg-primary text-primary-foreground' : 'text-white/70 group-hover:bg-white/10 group-hover:text-white',
  )

export const labelClass = (active: boolean) => cn('text-center text-[10px] font-semibold leading-3', active ? 'text-white' : 'text-white/70 group-hover:text-white')
