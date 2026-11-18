import { buildStatement, type EngineOutput, type Statement } from '@/engine'
import type { Money, MonthKey, Tables } from '@/model'

/**
 * A month in four figures, the Statement's upper half in small. Line one is what came in: the income, and what came
 * out of the household's own accounts. Line two is where it went: the expenses, and everything else on the right
 * side ("From what is left", with what was moved out of the plan). Both lines come to the same total, the page's
 * "Total in" and "Total out".
 */
export interface StripFigures {
  income: Money
  fromAccounts: Money
  expenses: Money
  left: Money
}

export interface StripMonth extends StripFigures {
  month: MonthKey
}

/** The four figures, read from the Statement itself, so the chip of a month never says something else than its page. */
export function stripFigures(statement: Statement): StripFigures {
  const { left, right } = statement.flow
  const income = left.lines.find((l) => l.id === 'income')?.amount ?? 0
  const expenses = right.lines.find((l) => l.id === 'expenses')?.amount ?? 0
  return { income, fromAccounts: left.total - income, expenses, left: right.total - expenses }
}

/** Every month of the plan as a chip's figures. A month the engine has not worked out shows nothing. */
export function stripMonths(tables: Tables, engine: EngineOutput, months: MonthKey[]): StripMonth[] {
  return months.map((month) => {
    const statement = buildStatement(tables, engine, month)
    return { month, ...(statement ? stripFigures(statement) : { income: 0, fromAccounts: 0, expenses: 0, left: 0 }) }
  })
}

/**
 * The chip that stands at the strip's left edge when it opens: three months before the current one, so that the
 * three past months, the current one and the months after it are in view. The plan's first month when it has fewer
 * before today, and its last months when today lies after it.
 */
export function stripStart(months: MonthKey[], today: MonthKey): number {
  if (months.length === 0) return 0
  const now = months.findIndex((m) => m >= today)
  return Math.max(0, (now < 0 ? months.length - 1 : now) - 3)
}
