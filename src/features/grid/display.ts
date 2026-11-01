import type { CellStatus } from '@/engine'
import type { Money, Row } from '@/model'
import { formatAmount } from '@/app/format'

export type Flow = 'in' | 'out' | 'net'

export function flowOf(row: Row): Flow {
  if (row.section === 'income') return 'in'
  if (row.kind === 'to-savings') return 'net'
  return 'out'
}

export type Tone = 'in' | 'out' | 'draw' | 'neutral'

/** Text and tone for an amount given its direction and the household's sign preference. */
export function amountDisplay(minor: Money, flow: Flow, currency: string, locale: string, negatives: boolean, compact = false): { text: string; tone: Tone } {
  if (flow === 'in') return { text: formatAmount(minor, currency, locale, { compact }), tone: 'in' }
  if (flow === 'net' && minor < 0) return { text: formatAmount(-minor, currency, locale, { compact, sign: 'always' }), tone: 'draw' }
  if (negatives) return { text: formatAmount(-minor, currency, locale, { compact }), tone: minor === 0 ? 'neutral' : 'out' }
  return { text: formatAmount(minor, currency, locale, { compact }), tone: 'neutral' }
}

export const toneClass: Record<Tone, string> = {
  in: '',
  out: 'text-red-700 dark:text-red-400',
  draw: 'text-amber-700 dark:text-amber-400',
  neutral: '',
}

export const statusClass: Record<CellStatus, string> = {
  projected: 'italic text-muted-foreground underline decoration-dashed decoration-muted-foreground/60 underline-offset-4',
  committed: '',
  done: '',
  derived: 'font-medium',
}
