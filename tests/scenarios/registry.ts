import { CucumberExpression, ParameterType, ParameterTypeRegistry } from '@cucumber/cucumber-expressions'
import type { MonthKey } from '@/model'
import type { World } from './world'

/**
 * The words a scenario can use. Each step is one sentence pattern and the function that carries it out on the store,
 * the way the app's own dialogs do. A sentence that matches no pattern, or two, fails its scenario: a scenario never
 * passes because a step was not understood.
 */

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const MONTH_NAME = `(?:${MONTHS.join('|')})`
const monthOf = (name: string, year: string): MonthKey => `${year}-${String(MONTHS.indexOf(name) + 1).padStart(2, '0')}`

/** "March 2026" for a month key, as the scenarios write it. */
export function monthName(m: MonthKey): string {
  const [year, month] = m.split('-')
  return `${MONTHS[Number(month) - 1]} ${year}`
}

/** 1,234.50 for an amount in cents, as the scenarios write it. */
export function moneyText(minor: number): string {
  const sign = minor < 0 ? '-' : ''
  const abs = Math.abs(minor)
  return `${sign}${Math.floor(abs / 100).toLocaleString('en-US')}.${String(abs % 100).padStart(2, '0')}`
}

const types = new ParameterTypeRegistry()
// 1,200.00 or -35.50: always two decimals, so a scenario cannot mean euros where the app means cents
types.defineParameterType(new ParameterType<number>('money', /-?\d{1,3}(?:,\d{3})*\.\d\d|-?\d+\.\d\d/, Number, (s: string) => {
  const n = Math.round(Number(s.replace(/,/g, '')) * 100)
  if (!Number.isFinite(n)) throw new Error(`"${s}" is not an amount.`)
  return n
}, false, false))
types.defineParameterType(new ParameterType<MonthKey>('month', new RegExp(`${MONTH_NAME} \\d{4}`), String, (s: string) => {
  const [name, year] = s.split(' ')
  return monthOf(name, year)
}, false, false))
// 15 March 2026 → 2026-03-15
types.defineParameterType(new ParameterType<string>('day', new RegExp(`\\d{1,2} ${MONTH_NAME} \\d{4}`), String, (s: string) => {
  const [day, name, year] = s.split(' ')
  return `${monthOf(name, year)}-${day.padStart(2, '0')}`
}, false, false))
types.defineParameterType(new ParameterType<string>('ccy', /[A-Z]{3}/, String, (s: string) => s, false, false))
types.defineParameterType(new ParameterType<string>('pair', /[A-Z]{3}\/[A-Z]{3}/, String, (s: string) => s, false, false))
// 10% or 2.5% → the fraction
types.defineParameterType(new ParameterType<number>('percent', /-?\d+(?:\.\d+)?%/, Number, (s: string) => Number(s.slice(0, -1)) / 100, false, false))
types.defineParameterType(new ParameterType<number>('rate', /\d+(?:\.\d+)?/, Number, (s: string) => Number(s), false, false))

// The arguments are whatever the pattern's placeholders give, in order; a table under the step comes last. Declared
// with `never` so a step can name its own argument types.
export type StepFn = (world: World, ...args: never[]) => Promise<void> | void

interface StepDef {
  pattern: string
  expression: CucumberExpression
  fn: StepFn
}

const defs: StepDef[] = []

/** Add a sentence to the vocabulary. Patterns are Cucumber expressions: `{money}`, `{month}`, `{string}`, … */
export function step(pattern: string, fn: StepFn): void {
  if (defs.some((d) => d.pattern === pattern)) throw new Error(`The step "${pattern}" is defined twice.`)
  defs.push({ pattern, expression: new CucumberExpression(pattern, types), fn })
}

/** A step no pattern understands, or more than one does. Never excused: the scenario is wrong, not the app. */
export class UnknownStep extends Error {}

/** The function for a sentence, with its arguments read out of it. */
export function resolve(text: string): { pattern: string; run: (world: World, table?: string[][]) => Promise<void> } {
  const found = defs.flatMap((d) => {
    const args = d.expression.match(text)
    return args ? [{ d, args }] : []
  })
  if (found.length === 0) throw new UnknownStep(`No step reads "${text}".`)
  if (found.length > 1) throw new UnknownStep(`"${text}" can be read ${found.length} ways: ${found.map((f) => `"${f.d.pattern}"`).join(' and ')}.`)
  const { d, args } = found[0]
  return {
    pattern: d.pattern,
    run: async (world, table) => {
      const values = args.map((a) => a.getValue(null))
      await (d.fn as (world: World, ...args: unknown[]) => Promise<void> | void)(world, ...(table ? [...values, table] : values))
    },
  }
}

/** Every pattern, for the list of steps in the rule book. */
export const vocabulary = (): string[] => defs.map((d) => d.pattern)
