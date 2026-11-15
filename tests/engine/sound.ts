import { expect } from 'vitest'
import { buildStatement, computeEngine, type EngineOutput, type Statement, type StatementLine } from '@/engine'
import type { MonthKey, Tables } from '@/model'

/**
 * What must hold for every Statement, whatever the household: the three checks the engine's own tests and the
 * scenario catalogue (`tests/scenarios`) both run.
 */

const walk = (lines: StatementLine[]): StatementLine[] => lines.flatMap((l) => [l, ...walk(l.children)])
/** Every line of a Statement, at any depth. */
export const all = (s: Statement) => walk([...s.flow.left.lines, ...s.flow.right.lines, ...s.position.left.lines, ...s.position.right.lines])
export const find = (s: Statement, id: string) => all(s).find((l) => l.id === id)
export const topLine = (s: Statement, sideKey: 'in' | 'out' | 'assets' | 'claims', id: string) =>
  [s.flow.left, s.flow.right, s.position.left, s.position.right].find((x) => x.key === sideKey)!.lines.find((l) => l.id === id)

/** The lines of "From accounts" the app works out from the expenses, and the ones that cover a month that overran. */
export const calculatedOf = (s: Statement) => (topLine(s, 'in', 'from-accounts')?.children ?? []).filter((l) => l.kind === 'source')
export const coveringOf = (s: Statement) => (topLine(s, 'in', 'from-accounts')?.children ?? []).filter((l) => l.chip === 'to cover the month')

/** Both halves of the Statement balance: money in is money out, and what the household has is its debts and its net worth. */
export function expectBalanced(s: Statement, m: MonthKey = s.month): void {
  expect(s.flow.difference, `${m} month`).toBe(0)
  expect(s.position.difference, `${m} position`).toBe(0)
  expect(s.position.left.change, `${m} change`).toBe(s.position.right.change)
}

/** Every side is the sum of its lines, and every heading the sum of the lines under it that it counts. */
export function expectSums(s: Statement, m: MonthKey = s.month): void {
  for (const side of [s.flow.left, s.flow.right, s.position.left, s.position.right]) {
    expect(side.total, `${m} ${side.key}`).toBe(side.lines.reduce((a, l) => a + l.amount, 0))
  }
  for (const l of all(s)) {
    // a row's children are its items, in the row's own currency
    if (l.children.length === 0 || l.kind === 'row') continue
    expect(l.amount, `${m} ${l.label}`).toBe(l.children.reduce((a, c) => (c.memo ? a : a + c.amount), 0))
    if (l.change != null && l.kind !== 'account') expect(l.change, `${m} ${l.label} change`).toBe(l.children.reduce((a, c) => a + (c.change ?? 0), 0))
  }
}

/** The month's money adds up, and the Statement shows the engine's own figures: what comes in is what goes out plus what is left. */
export function expectAddsUp(s: Statement, out: EngineOutput, m: MonthKey = s.month): void {
  const tot = out.totals[m]
  // the engine's promise for both month-end rules
  expect(tot.income, `${m} income is what went out and what is left`).toBe(tot.cashExpense + tot.allocations + tot.toInvestment + tot.pocket + tot.debt + tot.toSavings + tot.leftover)
  const amountOf = (sideKey: 'in' | 'out', id: string) => topLine(s, sideKey, id)?.amount ?? 0
  // "From accounts" holds three kinds of line: taken by hand, worked out from the expenses, and what covers a short month
  const worked = calculatedOf(s).reduce((a, l) => a + l.amount, 0)
  const covered = coveringOf(s).reduce((a, l) => a + l.amount, 0)
  const taken = amountOf('in', 'from-accounts') - worked - covered
  expect(amountOf('in', 'income') + taken, `${m} income`).toBe(tot.income)
  expect(taken, `${m} taken from accounts`).toBe(tot.fromAccounts)
  expect(worked, `${m} from savings`).toBe(tot.fromSavingsDerived)
  // what covers a short month sits on the left; taken back out, the right side is the engine's outflows and closing figures
  expect(s.flow.right.total - covered, `${m} outflows`).toBe(tot.expensesTotal + tot.moved + tot.pocket + tot.allocations + tot.toInvestment + tot.toSavings + tot.leftover)
  // the first heading is what the month costs, to the cent what the Grid calls "Expenses total"; what is moved between the household's accounts has its own
  expect(amountOf('out', 'expenses'), `${m} expenses`).toBe(tot.expensesTotal)
  expect(amountOf('out', 'moved'), `${m} moved`).toBe(tot.moved)
  // one net worth: the Statement's is the engine's, and both count what stays in the main account
  expect(find(s, 'main')?.amount ?? 0, `${m} main account`).toBe(out.main?.months[m]?.balance ?? 0)
  expect(topLine(s, 'claims', 'net-worth')!.amount, `${m} net worth`).toBe(out.netWorth[m] ?? 0)
}

/** Both halves agree, every heading is the sum of what sits under it, and the figures match the engine's own totals: for every month of `range`. */
export function expectSound(t: Tables, range: MonthKey[]): void {
  const out = computeEngine({ tables: t, months: range })
  for (const m of range) {
    const s = buildStatement(t, out, m)!
    expectBalanced(s, m)
    expectSums(s, m)
    expectAddsUp(s, out, m)
  }
}
