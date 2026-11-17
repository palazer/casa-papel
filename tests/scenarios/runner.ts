import { CHECKS, closingChecks, standingChecks, type CheckName } from './checks'
import type { Scenario, ScenarioStep } from './gherkin'
import { UnknownStep, resolve } from './registry'
import './steps'
import { ScenarioError, World } from './world'

/**
 * Runs one scenario on the store and the engine, and says how it went.
 *
 * A scenario passes when every step does and the nine checks hold after each of them (`checks/index.ts`).
 *   @open      an open finding (`scenarios/FINDINGS.md`): the app differs from the rule. Expected to fail at a "Then",
 *              at a refusal, or at a check the scenario names with `@breaks-<check>`; it fails the run the day it passes.
 *   @planned   a decided rule that is not built yet: expected to fail, anywhere; it fails the run the day it passes.
 * Neither tag excuses a mistake in the scenario of an open finding: a step the vocabulary does not know, a name that
 * does not exist, a "Given" that fails.
 */

export type Failure =
  /** The scenario is wrong, not the app: an unknown step, a name that does not exist, a "Given" that fails. */
  | { type: 'scenario'; message: string; unknown?: boolean }
  /** A "Then" that does not hold, or an action the app refused when the scenario expected it saved. */
  | { type: 'then'; message: string }
  | { type: 'check'; check: CheckName; message: string }

const at = (s: ScenarioStep) => `line ${s.line}, "${s.keyword} ${s.text}"`
const said = (e: unknown): string => (e instanceof Error ? e.message : String(e))

export async function runScenario(scenario: Scenario): Promise<Failure[]> {
  const world = new World()
  const failures: Failure[] = []
  const seen = new Set<string>()
  const add = (f: Failure) => {
    // a check that fails keeps failing after every later step: said once
    const key = f.type === 'check' ? `${f.check}|${f.message}` : f.message
    if (!seen.has(key)) failures.push(f)
    seen.add(key)
  }
  try {
    let refusedBy: ScenarioStep | null = null
    for (const s of scenario.steps) {
      let run: ReturnType<typeof resolve>['run']
      try {
        run = resolve(s.text).run
      } catch (e) {
        add({ type: 'scenario', unknown: e instanceof UnknownStep, message: `${at(s)}: ${said(e)}` })
        return failures
      }
      const pending = world.refusal
      const stamp = world.day ? world.stamp : ''
      const before = await world.figures()
      world.resetCommits()
      if (s.kind === 'when') world.mark = before
      try {
        await run(world, s.table)
      } catch (e) {
        if (e instanceof ScenarioError || e instanceof UnknownStep || s.kind === 'given') {
          add({ type: 'scenario', message: `${at(s)}: ${said(e)}` })
          return failures
        }
        if (s.kind === 'then') add({ type: 'then', message: `${at(s)}: ${said(e).split('\n')[0]}` })
        // an action the app refuses: the next step has to be the one that expects it
        else {
          world.refusal = said(e)
          refusedBy = s
        }
      }
      if (pending != null && world.refusal === pending && refusedBy !== s) {
        add({ type: 'then', message: `${at(refusedBy!)}: the app refused it: ${pending}` })
        world.refusal = null
      }
      if (world.day && world.stamp !== stamp && (await world.figures())) {
        const passes = await world.settle()
        for (const p of await standingChecks(world, passes)) add({ type: 'check', check: p.check, message: `after ${at(s)}: ${p.message}` })
        const after = (await world.view()).figures
        world.lastAction = world.commits === 1 && before ? { before, after, stamp: world.stamp } : null
      }
    }
    if (world.refusal != null) add({ type: 'then', message: `${at(refusedBy!)}: the app refused it: ${world.refusal}` })
    for (const p of await closingChecks(world)) add({ type: 'check', check: p.check, message: `at the end: ${p.message}` })
    return failures
  } finally {
    world.dispose()
  }
}


const list = (failures: Failure[]) => failures.map((f) => `  - ${f.message}`).join('\n')

export interface Verdict {
  outcome: 'pass' | 'open' | 'planned'
  /** For an open finding and a planned rule: where it fails today, for the summary. */
  note?: string
}

/** The finding a scenario is about, from its tags: `@F3`. */
export const findingOf = (scenario: Scenario): string | undefined => scenario.tags.find((t) => /^F\d+$/.test(t))

/** What a scenario's failures mean, given its tags. Throws when the run has to fail. */
export function judge(scenario: Scenario, failures: Failure[]): Verdict {
  const breaks = new Set(scenario.tags.filter((t) => t.startsWith('breaks-')).map((t) => t.slice('breaks-'.length)))
  for (const b of breaks) if (!(b in CHECKS)) throw new Error(`@breaks-${b} names no check. The checks are: ${Object.keys(CHECKS).join(', ')}.`)
  if (scenario.tags.includes('planned')) {
    if (failures.length === 0) throw new Error('This rule is built now: every step passes and every check holds. Remove @planned.')
    return { outcome: 'planned', note: failures[0].message }
  }
  if (scenario.tags.includes('open')) {
    // what an open finding may fail at: a "Then", a refusal, and the checks it names
    const expected = failures.filter((f) => f.type === 'then' || (f.type === 'check' && breaks.has(f.check)))
    const other = failures.filter((f) => !expected.includes(f))
    if (other.length) throw new Error(`An open finding fails at more than what it is about:\n${list(other)}`)
    if (expected.length === 0) throw new Error(`This finding no longer shows: every step passes and every check holds. Remove @open and close ${findingOf(scenario) ?? 'the finding'} in scenarios/FINDINGS.md.`)
    return { outcome: 'open', note: expected[0].message }
  }
  if (failures.length) throw new Error(`\n${list(failures)}`)
  return { outcome: 'pass' }
}
