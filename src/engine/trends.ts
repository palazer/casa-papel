import { parseMonth, type Money, type MonthKey, type Tables } from '@/model'
import { buildStatement, type StatementLine } from './statement'
import type { EngineOutput } from './types'

/** What the Trends page follows over the months. "Accounts" is everything the household has; "debts" what it owes. */
export type TrendSubject = 'netWorth' | 'income' | 'expenses' | 'accounts' | 'debts'
export const TREND_SUBJECTS: TrendSubject[] = ['netWorth', 'income', 'expenses', 'accounts', 'debts']
/** Income and expenses are what a month moved; the other three are what there was at its end. */
export const isFlow = (s: TrendSubject): boolean => s === 'income' || s === 'expenses'

/** The id of what is left when only the largest parts are shown by name. */
export const OTHER_PART = 'other'

export interface TrendPoint {
  /** The month, or the last month of the year the point stands for. */
  month: MonthKey
  /** How many months the point covers: 1, or the months of its year that are in view. */
  span: number
  totals: Record<TrendSubject, Money>
  /** The parts under each subject, by id. They add up to the subject's total; under net worth the debts are negative. */
  parts: Record<TrendSubject, Record<string, Money>>
}

export interface Trends {
  points: TrendPoint[]
  /** Every part that shows up in some month, in the Statement's order, with its name. */
  parts: Record<TrendSubject, Array<{ id: string; label: string }>>
}

const SUBJECT_MAP = <T>(make: () => T): Record<TrendSubject, T> => ({ netWorth: make(), income: make(), expenses: make(), accounts: make(), debts: make() })

/**
 * Every month in the figures of its Statement (`buildStatement`), so a point never says something else than the page
 * of its month: the totals of the five subjects, and under each the parts the Statement shows first.
 *
 * - income and expenses: the categories, or the rows where the section has no categories;
 * - accounts: the main account and each account that has a balance;
 * - debts: each card and loan;
 * - net worth: the main account and the three kinds of assets, and the debts as a negative part.
 *
 * A line the Statement leaves out of its sums (an account that is not in net worth) is left out here too.
 */
export function buildTrends(tables: Tables, engine: EngineOutput, months: MonthKey[]): Trends {
  const names = SUBJECT_MAP(() => new Map<string, string>())
  const points = months.map((month): TrendPoint => {
    const totals = SUBJECT_MAP(() => 0)
    const parts = SUBJECT_MAP((): Record<string, Money> => ({}))
    const statement = buildStatement(tables, engine, month)
    if (!statement) return { month, span: 1, totals, parts }
    const put = (subject: TrendSubject, line: StatementLine, amount = line.amount) => {
      if (line.memo) return
      parts[subject][line.id] = (parts[subject][line.id] ?? 0) + amount
      if (!names[subject].has(line.id)) names[subject].set(line.id, line.label)
    }
    const find = (lines: StatementLine[], id: string) => lines.find((l) => l.id === id)

    const income = find(statement.flow.left.lines, 'income')
    totals.income = income?.amount ?? 0
    for (const l of income?.children ?? []) put('income', l)
    const expenses = find(statement.flow.right.lines, 'expenses')
    totals.expenses = expenses?.amount ?? 0
    for (const l of expenses?.children ?? []) put('expenses', l)

    totals.accounts = statement.position.left.total
    for (const l of statement.position.left.lines) {
      // the main account is a line of its own; the other accounts stand under the heading of their kind
      if (l.kind === 'group') for (const a of l.children) put('accounts', a)
      else put('accounts', l)
      put('netWorth', l)
    }
    const debts = find(statement.position.right.lines, 'debts')
    totals.debts = debts?.amount ?? 0
    for (const l of debts?.children ?? []) put('debts', l)
    if (debts) put('netWorth', debts, -debts.amount)
    totals.netWorth = find(statement.position.right.lines, 'net-worth')?.amount ?? 0
    return { month, span: 1, totals, parts }
  })
  const parts = SUBJECT_MAP((): Array<{ id: string; label: string }> => [])
  for (const s of TREND_SUBJECTS) parts[s] = [...names[s]].map(([id, label]) => ({ id, label }))
  return { points, parts }
}

/**
 * The parts of a subject that get a name and a colour of their own: the `max` largest over `over` (the plan's months,
 * so a part keeps its place whatever range is in view), in the Statement's order. `other` says whether anything is left
 * for "Other".
 */
export function topParts(trends: Trends, subject: TrendSubject, over: (m: MonthKey) => boolean, max = 6): { shown: Array<{ id: string; label: string }>; other: boolean } {
  const all = trends.parts[subject]
  if (all.length <= max) return { shown: all, other: false }
  const weight = new Map<string, number>()
  for (const p of trends.points) {
    if (!over(p.month)) continue
    for (const [id, v] of Object.entries(p.parts[subject])) weight.set(id, (weight.get(id) ?? 0) + Math.abs(v))
  }
  // the largest first; equal ones in the Statement's order, so the choice is the same on every device
  const ranked = all.map((p, i) => ({ p, i, w: weight.get(p.id) ?? 0 })).sort((a, b) => b.w - a.w || a.i - b.i).slice(0, max)
  const keep = new Set(ranked.map((r) => r.p.id))
  return { shown: all.filter((p) => keep.has(p.id)), other: true }
}

/** A point's parts as the named ones and "Other": the amounts of `shown`, and the rest in one. */
export function foldParts(point: TrendPoint, subject: TrendSubject, shown: Array<{ id: string }>): Record<string, Money> {
  const out: Record<string, Money> = {}
  const named = new Set(shown.map((p) => p.id))
  for (const p of shown) out[p.id] = point.parts[subject][p.id] ?? 0
  let rest = 0
  for (const [id, v] of Object.entries(point.parts[subject])) if (!named.has(id)) rest += v
  out[OTHER_PART] = rest
  return out
}

/**
 * The points by calendar year, for a range too long to read month by month: what the year's months in view moved
 * (income, expenses) and what there was at the end of its last month in view (net worth, accounts, debts). A year
 * that is only partly in view (the household's first) says so in `span`.
 */
export function byYear(points: TrendPoint[]): TrendPoint[] {
  const years = new Map<number, TrendPoint[]>()
  for (const p of points) {
    const y = parseMonth(p.month).year
    years.set(y, [...(years.get(y) ?? []), p])
  }
  return [...years.values()].map((list): TrendPoint => {
    const last = list[list.length - 1]
    const totals = SUBJECT_MAP(() => 0)
    const parts = SUBJECT_MAP((): Record<string, Money> => ({}))
    for (const s of TREND_SUBJECTS) {
      if (!isFlow(s)) {
        totals[s] = last.totals[s]
        parts[s] = { ...last.parts[s] }
        continue
      }
      for (const p of list) {
        totals[s] += p.totals[s]
        for (const [id, v] of Object.entries(p.parts[s])) parts[s][id] = (parts[s][id] ?? 0) + v
      }
    }
    return { month: last.month, span: list.reduce((n, p) => n + p.span, 0), totals, parts }
  })
}

/** How a subject moved from the point before: null for the first point, which has nothing before it. */
export function trendChange(points: TrendPoint[], i: number, subject: TrendSubject): Money | null {
  return i > 0 ? points[i].totals[subject] - points[i - 1].totals[subject] : null
}
