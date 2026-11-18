import { cellKey, type EngineOutput } from '@/engine'
import type { MonthKey, Tables } from '@/model'
import { moneyText, monthName } from './registry'

/**
 * Every figure the plan shows, month by month, as plain text that can be compared: a row's amount, an account's
 * start and end, a virtual account's balance, the month's sums and net worth. "The figures are the same" (after undo,
 * after export and import, in the months before a change) always means this list.
 */
export interface Figures {
  /** The months the plan covers. */
  months: MonthKey[]
  /** month → what is measured → its value as text. */
  byMonth: Record<MonthKey, Record<string, string>>
}

const TOTALS = ['income', 'expensesTotal', 'moved', 'movedToAccounts', 'pocket', 'debt', 'allocations', 'toInvestment', 'toSavings', 'leftover', 'fromAccounts'] as const

/** One month's figures out of an engine run that covers it. */
export function monthFigures(tables: Tables, engine: EngineOutput, m: MonthKey): Record<string, string> {
  const out: Record<string, string> = {}
  const name = <T extends { id: string; name: string }>(list: T[], id: string) => list.find((x) => x.id === id)?.name ?? id
  for (const row of engine.rows) {
    const c = engine.cells[cellKey(row.id, m)]
    // A row with nothing in the month is left out: no amount yet, a typed zero and an archived row all show nothing
    // there, and a row that is added later changes no figure of the months it is empty in.
    if (!c || (c.value === 0 && c.valueBase === 0)) continue
    out[`"${row.name}"`] = `${moneyText(c.value)} ${c.currency}${c.valueBase !== c.value ? ` = ${moneyText(c.valueBase)}` : ''}`
  }
  for (const [id, series] of Object.entries(engine.accounts)) {
    const r = series.months[m]
    if (!r) continue
    out[`account "${name(tables.accounts, id)}"`] = `starts ${moneyText(r.start)}, ends ${moneyText(r.balance)} ${series.currency}${r.balanceBase !== r.balance ? ` = ${moneyText(r.balanceBase)}` : ''}${r.entered ? ' (real)' : ''}`
  }
  for (const [id, series] of Object.entries(engine.pools)) {
    const r = series.months[m]
    if (r) out[`virtual account "${name(tables.pools, id)}"`] = `${moneyText(r.balance)}${r.short ? `, short ${moneyText(r.short)}` : ''}`
  }
  const main = engine.main?.months[m]
  if (main) out['current accounts'] = `start ${moneyText(main.start)}, end ${moneyText(main.balance)}${main.entered ? ' (real)' : ''}`
  const t = engine.totals[m]
  if (t) for (const k of TOTALS) out[`month: ${k}`] = moneyText(t[k])
  if (engine.netWorth[m] != null) out['net worth'] = moneyText(engine.netWorth[m])
  return out
}

export function figuresOf(tables: Tables, engine: EngineOutput): Figures {
  const byMonth: Figures['byMonth'] = {}
  for (const m of engine.months) byMonth[m] = monthFigures(tables, engine, m)
  return { months: [...engine.months], byMonth }
}

/** What differs between two months' figures, one line each; empty when they are the same. */
export function diffMonth(m: MonthKey, a: Record<string, string> | undefined, b: Record<string, string> | undefined): string[] {
  const out: string[] = []
  for (const key of new Set([...Object.keys(a ?? {}), ...Object.keys(b ?? {})])) {
    const before = a?.[key]
    const after = b?.[key]
    if (before !== after) out.push(`${monthName(m)}, ${key}: ${before ?? 'not there'} → ${after ?? 'not there'}`)
  }
  return out
}

/** What differs between two sets of figures; `before` limits it to the months before that one, and then the plan's length is not compared. */
export function diffFigures(a: Figures, b: Figures, opts: { before?: MonthKey } = {}): string[] {
  const out: string[] = []
  const inScope = (m: MonthKey) => !opts.before || m < opts.before
  if (!opts.before && (a.months[0] !== b.months[0] || a.months.at(-1) !== b.months.at(-1))) {
    out.push(`the plan: ${monthName(a.months[0])} to ${monthName(a.months.at(-1)!)} → ${monthName(b.months[0])} to ${monthName(b.months.at(-1)!)}`)
  }
  for (const m of [...new Set([...a.months, ...b.months])].sort()) {
    if (!inScope(m)) continue
    // a month only one of the two plans reaches is said once, by the plan's length
    if (!opts.before && (!a.byMonth[m] || !b.byMonth[m])) continue
    out.push(...diffMonth(m, a.byMonth[m], b.byMonth[m]))
  }
  return out
}
