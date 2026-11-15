import { AstBuilder, GherkinClassicTokenMatcher, Parser, compile } from '@cucumber/gherkin'
import { IdGenerator, type Feature as AstFeature, type Step as AstStep } from '@cucumber/messages'

/** A step as a scenario runs it: Background steps first, an outline's placeholders filled in. */
export interface ScenarioStep {
  /** What the step is for, whatever word it starts with: "And" and "But" take the kind of the step before. */
  kind: 'given' | 'when' | 'then'
  /** The word it is written with ("Given", "And", …), for messages. */
  keyword: string
  text: string
  /** A table under the step: its rows as written, the first one being the header. */
  table?: string[][]
  line: number
}

export interface Scenario {
  name: string
  /** The scenario's tags and those of its feature and rule, without the "@". */
  tags: string[]
  steps: ScenarioStep[]
  line: number
}

export interface Feature {
  file: string
  name: string
  scenarios: Scenario[]
}

/** Read one `.feature` file with the official Gherkin parser. A file it cannot read fails here, with the parser's own message. */
export function parseFeature(file: string, text: string): Feature {
  const newId = IdGenerator.incrementing()
  const document = new Parser(new AstBuilder(newId), new GherkinClassicTokenMatcher()).parse(text)
  const feature = document.feature
  if (!feature) throw new Error(`${file} has no Feature.`)
  const steps = stepsById(feature)
  const lines = scenarioLines(feature)
  const scenarios = compile({ ...document, uri: file }, file, newId).map((pickle): Scenario => {
    let last: ScenarioStep['kind'] = 'given'
    return {
      name: pickle.name,
      tags: pickle.tags.map((t) => t.name.replace(/^@/, '')),
      line: lines.get(pickle.astNodeIds[0]) ?? 0,
      steps: pickle.steps.map((s) => {
        const ast = steps.get(s.astNodeIds[0])
        const kind = s.type === 'Context' ? 'given' : s.type === 'Action' ? 'when' : s.type === 'Outcome' ? 'then' : last
        last = kind
        return {
          kind, keyword: ast?.keyword.trim() ?? '', text: s.text, line: ast?.location.line ?? 0,
          ...(s.argument?.dataTable ? { table: s.argument.dataTable.rows.map((r) => r.cells.map((c) => c.value)) } : {}),
        }
      }),
    }
  })
  return { file, name: feature.name, scenarios }
}

function stepsById(feature: AstFeature): Map<string, AstStep> {
  const out = new Map<string, AstStep>()
  const add = (list: readonly AstStep[] | undefined) => { for (const s of list ?? []) out.set(s.id, s) }
  for (const child of feature.children) {
    add(child.background?.steps)
    add(child.scenario?.steps)
    for (const inner of child.rule?.children ?? []) {
      add(inner.background?.steps)
      add(inner.scenario?.steps)
    }
  }
  return out
}

function scenarioLines(feature: AstFeature): Map<string, number> {
  const out = new Map<string, number>()
  for (const child of feature.children) {
    if (child.scenario) out.set(child.scenario.id, child.scenario.location.line)
    for (const inner of child.rule?.children ?? []) if (inner.scenario) out.set(inner.scenario.id, inner.scenario.location.line)
  }
  return out
}
