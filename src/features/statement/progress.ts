import { cellKey, type CellResult } from '@/engine'
import { formatAmount } from '@/app/format'
import type { Money, MonthKey, Row } from '@/model'
import { doneness, flowOf } from '@/app/display'

export interface MonthProgress {
  /** Units done and units in all: a line is one unit, an itemized line one per live item. */
  done: number
  total: number
  /** Open spending and transfers, in the base currency. A negative savings plug (a draw) is nothing to pay. */
  toPay: Money
  /** Open income, in the base currency. */
  toComeIn: Money
  /** Lines with an amount this month. */
  lines: number
}

/** What the Statement's progress line says: how much of the month has been ticked and what is still open. Pure. */
export function monthProgress(rows: Row[], cells: Record<string, CellResult>, month: MonthKey): MonthProgress {
  const p: MonthProgress = { done: 0, total: 0, toPay: 0, toComeIn: 0, lines: 0 }
  for (const row of rows) {
    const c = cells[cellKey(row.id, month)]
    if (!c || c.source === 'archived' || c.source === 'empty' || c.value === 0) continue
    p.lines += 1
    const d = doneness(c)
    p.done += d.done
    p.total += d.total
    if (d.done === d.total) continue
    const live = c.items.filter((i) => !i.skipped)
    const openOwn = live.length ? live.filter((i) => i.status !== 'done').reduce((s, i) => s + i.effectiveAmount, 0) : c.value
    const openBase = Math.round((c.valueBase * openOwn) / c.value)
    const flow = flowOf(row)
    if (flow === 'in') p.toComeIn += openBase
    else if (openBase > 0) p.toPay += openBase
  }
  return p
}

export function progressText(p: MonthProgress, closed: boolean, currency: string, locale: string): string {
  if (closed) return 'Closed · all done'
  if (p.total === 0) return 'Nothing in this month yet'
  if (p.done === p.total) return `All ${p.total} done`
  const parts = [`${p.done} of ${p.total} done`]
  if (p.toPay > 0) parts.push(`${formatAmount(p.toPay, currency, locale)} still to pay`)
  if (p.toComeIn > 0) parts.push(`${formatAmount(p.toComeIn, currency, locale)} to come in`)
  return parts.join(' · ')
}
