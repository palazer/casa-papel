import type { CellResult, CellStatus } from '@/engine'
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
  out: 'text-expense',
  draw: 'text-draw',
  neutral: '',
}

export const statusClass: Record<CellStatus, string> = {
  projected: 'italic text-muted-foreground underline decoration-dashed decoration-partial underline-offset-4',
  committed: '',
  done: '',
  derived: 'font-medium',
}

export type DoneState = 'none' | 'partial' | 'all'

/** How much of a cell is done: items counted one by one, a single amount as one item. */
export function doneness(cell: Pick<CellResult, 'status' | 'items'>): { done: number; total: number; state: DoneState } {
  const live = cell.items.filter((i) => !i.skipped)
  const total = live.length || 1
  const done = live.length ? live.filter((i) => i.status === 'done').length : cell.status === 'done' ? 1 : 0
  return { done, total, state: done === 0 ? 'none' : done === total ? 'all' : 'partial' }
}

export function doneLabel(d: { done: number; total: number; state: DoneState }): string {
  if (d.state === 'all') return 'Done'
  if (d.state === 'none') return 'Not done yet'
  return `${d.done} of ${d.total} done`
}
