import { afterEach, describe, expect, it } from 'vitest'
import type { EngineOutput } from '@/engine'
import { restoreToday } from '../today'
import { standingChecks } from './checks'
import { bridgeOf } from './checks/bridge'
import { carriedProblems } from './checks/continuity'
import { figuresOf } from './figures'
import { parseFeature } from './gherkin'
import { resolve } from './registry'
import { judge, runScenario } from './runner'
import { World, type View } from './world'

/** The runner itself: what makes a scenario pass, fail, or count as an open finding or a planned rule. */
const feature = parseFeature('inline.feature', `
Feature: The runner

  Background:
    Given a household in EUR that starts in January 2026
    And an expense "Rent" of 1,200.00 from January 2026

  Scenario: passes
    When I type 1,250.00 for "Rent" in March 2026, only this month
    Then "Rent" is 1,250.00 in March 2026
    And "Rent" is 1,200.00 in April 2026
    And nothing has changed before March 2026

  Scenario: a Then that does not hold
    Then "Rent" is 999.00 in March 2026

  Scenario: a step nobody wrote
    When I wave at "Rent"
    Then "Rent" is 1,200.00 in March 2026

  Scenario: a name that does not exist
    Then "Mortgage" is 1,200.00 in March 2026

  Scenario: a refusal nobody expected
    Given a savings account "Savings" holding 0.00
    When "Savings" takes the rest of the month from January 2025
    Then "Rent" is 1,200.00 in March 2026

  Scenario: a refusal that is expected
    Given a savings account "Savings" holding 0.00
    When "Savings" takes the rest of the month from January 2025
    Then it is refused with "a rule cannot start before that"

  @open @F99
  Scenario: an open finding that fails at its Then
    Then "Rent" is 999.00 in March 2026

  @open @F99
  Scenario: an open finding that passes
    Then "Rent" is 1,200.00 in March 2026

  @open @F99
  Scenario: an open finding with a step nobody wrote
    When I wave at "Rent"
    Then "Rent" is 999.00 in March 2026

  @planned
  Scenario: a planned rule with a step nobody wrote
    When I wave at "Rent"

  @planned
  Scenario: a planned rule that passes
    Then "Rent" is 1,200.00 in March 2026

  Scenario Outline: an outline runs once per example
    Then "Rent" is <amount> in <month>

    Examples:
      | amount   | month         |
      | 1,200.00 | January 2026  |
      | 1,200.00 | December 2026 |
`)

const verdictOf = async (name: string) => {
  const scenario = feature.scenarios.find((s) => s.name === name)!
  const failures = await runScenario(scenario)
  try {
    return { ...judge(scenario, failures), failures }
  } catch (e) {
    return { outcome: 'fail' as const, note: (e as Error).message, failures }
  }
}

describe('the scenario runner', () => {
  afterEach(restoreToday)

  it('passes a scenario whose steps and checks all hold', async () => {
    expect(await verdictOf('passes')).toMatchObject({ outcome: 'pass', failures: [] })
  })

  it('fails on a Then that does not hold, and says the line and both amounts', async () => {
    const v = await verdictOf('a Then that does not hold')
    expect(v.outcome).toBe('fail')
    expect(v.note).toContain('line 15, "Then "Rent" is 999.00 in March 2026"')
    expect(v.note).toMatch(/expected '1,200\.00' to be '999\.00'/)
  })

  it('fails on a step nobody wrote and on a name that does not exist', async () => {
    expect(await verdictOf('a step nobody wrote')).toMatchObject({ outcome: 'fail', failures: [{ type: 'scenario', unknown: true }] })
    const v = await verdictOf('a name that does not exist')
    expect(v.outcome).toBe('fail')
    expect(v.note).toContain('There is no row called "Mortgage". There are: "Rent".')
  })

  it('fails when the app refuses an action, unless the next step expects it', async () => {
    const v = await verdictOf('a refusal nobody expected')
    expect(v.outcome).toBe('fail')
    expect(v.note).toContain('the app refused it: The household starts in 2026-01; a rule cannot start before that.')
    expect(await verdictOf('a refusal that is expected')).toMatchObject({ outcome: 'pass' })
  })

  it('counts an open finding while it fails at its Then, and fails the run the day it passes', async () => {
    expect(await verdictOf('an open finding that fails at its Then')).toMatchObject({ outcome: 'open' })
    const v = await verdictOf('an open finding that passes')
    expect(v.outcome).toBe('fail')
    expect(v.note).toContain('This finding no longer shows')
    expect(v.note).toContain('close F99')
  })

  it('does not excuse a mistake in an open finding', async () => {
    const v = await verdictOf('an open finding with a step nobody wrote')
    expect(v.outcome).toBe('fail')
    expect(v.note).toContain('fails at more than what it is about')
  })

  it('lists a planned rule until it is built, and fails the run the day it passes', async () => {
    expect(await verdictOf('a planned rule with a step nobody wrote')).toMatchObject({ outcome: 'planned' })
    expect((await verdictOf('a planned rule that passes')).note).toContain('Remove @planned')
  })

  it('reads an outline as one scenario per example, with the Background first', () => {
    const outlined = feature.scenarios.filter((s) => s.name === 'an outline runs once per example')
    expect(outlined).toHaveLength(2)
    expect(outlined[1].steps.map((s) => `${s.kind}: ${s.text}`)).toEqual([
      'given: a household in EUR that starts in January 2026',
      'given: an expense "Rent" of 1,200.00 from January 2026',
      'then: "Rent" is 1,200.00 in December 2026',
    ])
  })
})

/** A household with a savings account that is fed every month, and its view with one figure of the engine changed. */
async function tampered(change: (engine: EngineOutput, savingsId: string) => void): Promise<{ world: World; view: View }> {
  const world = new World()
  for (const text of [
    'today is 15 March 2026',
    'a household in EUR that starts in January 2026',
    'a current account "Current account" holding 1,000.00',
    'a savings account "Savings" holding 5,000.00',
    'an income "Sam – Salary" of 3,000.00 from January 2026',
    'a transfer "To Savings" of 500.00 to "Savings" from January 2026',
  ]) await resolve(text).run(world)
  const view = await world.view()
  const engine = structuredClone(view.engine)
  change(engine, (await world.account('Savings')).id)
  return { world, view: { ...view, engine, figures: figuresOf(view.tables, engine) } }
}

describe('the checks notice a figure that is off', () => {
  afterEach(restoreToday)

  it('holds for the household as the app works it out', async () => {
    const { world } = await tampered(() => undefined)
    expect(await standingChecks(world, 0)).toEqual([])
    world.dispose()
  })

  it('carried: an account that starts a month with something else than it ended on', async () => {
    const { world, view } = await tampered((engine, id) => { engine.accounts[id].months['2026-02'].start += 100_00 })
    expect(carriedProblems(view).join(' ')).toContain('"Savings" starts February 2026 with 5,600.00, and ended the month before with 5,500.00.')
    world.dispose()
  })

  it('explained: an account that moved by more than its rows put into it', async () => {
    const { world, view } = await tampered((engine, id) => {
      engine.accounts[id].months['2026-02'].balance += 50_00
      engine.accounts[id].months['2026-02'].balanceBase += 50_00
      engine.netWorth['2026-02'] += 50_00
    })
    const bridge = bridgeOf(view, '2026-02')
    expect(bridge.problems.join(' ')).toContain('"Savings" moved by 550.00 in February 2026, and the rows explain 500.00: 50.00 is unexplained.')
    expect(bridge.unexplained).toBe(50_00)
    world.dispose()
  })

  it('explained: a net worth that is not the sum of what the accounts hold', async () => {
    const { world, view } = await tampered((engine) => { engine.netWorth['2026-02'] -= 1 })
    expect(bridgeOf(view, '2026-02').problems.join(' ')).toMatch(/Net worth moved by 2,999\.99 in February 2026; explained: income 3,000\.00; unexplained: -0\.01\./)
    world.dispose()
  })
})
