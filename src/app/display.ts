import type { CellResult, CellStatus, StatementRule } from '@/engine'
import type { Money, Row } from '@/model'
import { formatAmount, formatShare } from './format'

export type Flow = 'in' | 'out' | 'net'

export function flowOf(row: Row): Flow {
  // money taken out of an account comes into the month, wherever the row sits
  if (row.section === 'income' || row.kind === 'from-savings' || row.kind === 'from-investment') return 'in'
  if (row.kind === 'to-savings') return 'net'
  return 'out'
}

export type Tone = 'in' | 'out' | 'draw' | 'neutral'

/** Text and tone for an amount given its direction and the household's sign preference. Money coming in, and every
 *  balance, reads `in`; a balance below zero (an overdrawn virtual account, savings in the red) is a warning and takes the
 *  expense hue whatever the negatives setting. */
export function amountDisplay(minor: Money, flow: Flow, currency: string, locale: string, negatives: boolean, compact = false): { text: string; tone: Tone } {
  if (flow === 'in') return { text: formatAmount(minor, currency, locale, { compact }), tone: minor < 0 ? 'out' : 'in' }
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

/** The light yellow an estimate sits on, on every screen (DESIGN.md §5): the amount in a rounded pill of the shade. */
export const ESTIMATE_SHADE = 'rounded bg-estimate px-1 py-0.5'

export const statusClass: Record<CellStatus, string> = {
  // pulled back by its own padding, so an estimate's digits line up with the plain amounts above and below it
  projected: `-mr-1 ${ESTIMATE_SHADE}`,
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

/** A rule in the rule dialog's words: `a fixed amount`, `10% of income`, `30% of what is left`, `the rest`. */
export function ruleText(rule: Pick<StatementRule, 'kind' | 'share'>, locale: string): string {
  switch (rule.kind) {
    case 'share-of-income': return `${formatShare(rule.share ?? 0, locale)} of income`
    case 'share-of-own-income': return `${formatShare(rule.share ?? 0, locale)} of their own income`
    case 'share-of-rest': return `${formatShare(rule.share ?? 0, locale)} of what is left`
    case 'rest': return 'the rest'
    case 'idle': return 'nothing, another account takes the rest'
    case 'none': return 'no rule yet'
    default: return 'a fixed amount'
  }
}
