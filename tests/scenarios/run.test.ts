import { afterAll, afterEach, describe, it } from 'vitest'
import { restoreToday } from '../today'
import { parseFeature } from './gherkin'
import { findingOf, judge, runScenario } from './runner'

/**
 * Every scenario of `scenarios/*.feature`, run on the store and the engine without a browser: `npm run scenarios`.
 * What passing means, and what `@open` and `@planned` do, is in `runner.ts`.
 */
const features = Object.entries(import.meta.glob('../../scenarios/*.feature', { query: '?raw', import: 'default', eager: true }) as Record<string, string>)
  .sort(([a], [b]) => (a < b ? -1 : 1))
  .map(([path, text]) => parseFeature(path.split('/').at(-1)!, text))

const tally = { pass: 0, open: [] as string[], planned: [] as string[] }

for (const feature of features) {
  describe(`${feature.file}: ${feature.name}`, () => {
    afterEach(restoreToday)
    for (const scenario of feature.scenarios) {
      const finding = findingOf(scenario)
      const label = scenario.tags.includes('open') ? ` [open finding${finding ? ` ${finding}` : ''}]` : scenario.tags.includes('planned') ? ' [planned]' : ''
      it(`${scenario.name}${label}`, async () => {
        const verdict = judge(scenario, await runScenario(scenario))
        if (verdict.outcome === 'pass') tally.pass += 1
        else tally[verdict.outcome].push(`${verdict.outcome === 'open' && finding ? `${finding}  ` : ''}${feature.file}: ${scenario.name}\n      ${verdict.note}`)
      })
    }
  })
}

afterAll(() => {
  const lines = [`Scenarios: ${tally.pass} pass, ${tally.open.length} open findings, ${tally.planned.length} planned.`]
  if (tally.open.length) lines.push('', 'Open findings (the app differs from the rule; see scenarios/FINDINGS.md):', ...tally.open.map((l) => `  ${l}`))
  if (tally.planned.length) lines.push('', 'Planned (decided, not built yet):', ...tally.planned.map((l) => `  ${l}`))
  console.log(`\n${lines.join('\n')}\n`)
})
