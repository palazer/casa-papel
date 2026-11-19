import { all } from '../../engine/sound'
import { computeEngine } from '@/engine'
import { addMonths, compareMonths, monthRange } from '@/model'
import { diffMonth, monthFigures } from '../figures'
import { moneyText, monthName } from '../registry'
import type { View } from '../world'

/**
 * Every account starts a month with what it ended the month before (rule B1). Three readings of the same promise:
 * the engine's own balances, the lines of the Statement from one month to the next, and the figures of a month when
 * the app works out fewer months (a screen that shows one month must show what the whole plan shows for it).
 */
export function carriedProblems(view: View): string[] {
  const { tables, household, engine, months } = view
  const out: string[] = []
  const nameOf = (id: string) => tables.accounts.find((a) => a.id === id)?.name ?? id

  // the engine: a start is the end of the month before, or the opening amount where there is no month before
  for (const [id, series] of Object.entries(engine.accounts)) {
    const acc = tables.accounts.find((a) => a.id === id)
    for (const m of months) {
      const r = series.months[m]
      if (!r) continue
      const before = series.months[addMonths(m, -1)]
      const expected = before ? before.balance : acc?.openingBalance ?? 0
      if (r.start !== expected) out.push(`"${nameOf(id)}" starts ${monthName(m)} with ${moneyText(r.start)}, and ${before ? 'ended the month before with' : 'opened with'} ${moneyText(expected)}.`)
    }
  }
  for (const m of months) {
    const main = engine.main?.months[m]
    const before = engine.main?.months[addMonths(m, -1)]
    if (!main || !before) continue
    // a main account that opens this month brings its opening amount; nothing else may come between the two
    const opened = tables.accounts.some((a) => !a.deletedAt && a.type === 'checking' && a.openingMonth === m && (a.openingBalance ?? 0) !== 0)
    if (main.start !== before.balance && !opened) out.push(`The main account starts ${monthName(m)} with ${moneyText(main.start)}, and ended the month before with ${moneyText(before.balance)}.`)
  }

  // the Statement: a line's amount less its change is what the same line showed the month before
  for (const m of months.slice(1)) {
    const prev = new Map(all(view.statement(addMonths(m, -1))).map((l) => [l.id, l]))
    for (const line of all(view.statement(m))) {
      if ((line.kind !== 'account' && line.kind !== 'pool') || line.change == null || line.id === 'main') continue
      const before = prev.get(line.id)
      if (!before) continue
      if (line.amount - line.change !== before.amount) {
        out.push(`The Statement shows "${line.label}" at ${moneyText(line.amount)} in ${monthName(m)} with a change of ${moneyText(line.change)}, which leaves ${moneyText(line.amount - line.change)}; the month before it showed ${moneyText(before.amount)}.`)
      }
    }
  }

  // fewer months worked out: the month itself, and the range a single-month screen asks for
  for (const m of months) {
    const whole = view.figures.byMonth[m]
    const alone = monthFigures(tables, computeEngine({ tables, months: [m] }), m)
    const start = compareMonths(household.startMonth, m) < 0 ? household.startMonth : m
    const upTo = monthFigures(tables, computeEngine({ tables, months: monthRange(start, addMonths(m, 1)) }), m)
    for (const [how, got] of [['worked out alone', alone], ['worked out up to the month after', upTo]] as const) {
      const diff = diffMonth(m, whole, got)
      if (diff.length) out.push(`${monthName(m)} reads differently when it is ${how}: ${diff.slice(0, 3).join('; ')}${diff.length > 3 ? `; and ${diff.length - 3} more` : ''}.`)
    }
  }
  return out
}
