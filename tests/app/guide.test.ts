import { describe, expect, it } from 'vitest'
import { GUIDE, GUIDE_LEAD, REPO_URL } from '@/app/guide'
import { HELP, type HelpKey } from '@/app/help'
import { isScreen } from '@/app/screens'
import { ACCOUNT_TYPE_INFO, ENTITY_KIND_HELP, GOAL_KIND_INFO } from '@/model'

function sentence(s: string, what: string) {
  expect(s.trim().length, what).toBeGreaterThan(0)
  expect(s.trim().endsWith('.'), `${what} ends with a full stop: …${s.slice(-24)}`).toBe(true)
  expect(s, what).not.toMatch(/\s{2,}/)
}

describe('the Guide', () => {
  it('has sixteen topics with unique kebab keys, short titles and whole sentences', () => {
    expect(GUIDE).toHaveLength(16)
    const keys = GUIDE.map((t) => t.key)
    expect(new Set(keys).size).toBe(keys.length)
    for (const t of GUIDE) {
      expect(t.key).toMatch(/^[a-z][a-z-]*$/)
      expect(t.title.length, t.key).toBeLessThanOrEqual(40)
      sentence(t.summary, `${t.key} summary`)
      expect(t.what.length, t.key).toBeGreaterThanOrEqual(1)
      expect(t.what.length, t.key).toBeLessThanOrEqual(3)
      t.what.forEach((p, i) => sentence(p, `${t.key} paragraph ${i}`))
      expect(t.steps.length, t.key).toBeGreaterThanOrEqual(3)
      expect(t.steps.length, t.key).toBeLessThanOrEqual(8)
      t.steps.forEach((s, i) => sentence(s, `${t.key} step ${i}`))
      expect(t.tips.length, t.key).toBeGreaterThan(0)
      for (const k of t.tips) expect(HELP, `${t.key} tip ${k}`).toHaveProperty(k)
      expect(isScreen(t.open), t.key).toBe(true)
      if (t.facts) {
        expect(t.factsTitle, t.key).toBeTruthy()
        expect(t.facts.length, t.key).toBeGreaterThan(1)
      }
    }
  })

  it('quotes every (i) text at least once, so every explanation can be found from the Guide', () => {
    const used = new Set<string>(GUIDE.flatMap((t) => t.tips))
    const missing = (Object.keys(HELP) as HelpKey[]).filter((k) => !used.has(k))
    expect(missing).toEqual([])
  })

  it('speaks the app\'s own names and the demo household\'s', () => {
    const all = [
      ...GUIDE_LEAD.paragraphs,
      ...GUIDE.flatMap((t) => [t.title, t.summary, ...t.what, ...t.steps, ...(t.facts ?? []).flatMap((f) => [f.label, f.text])]),
    ].join(' ')
    expect(all).not.toMatch(/envelope/i)
    expect(all).not.toMatch(/\bentit(y|ies)\b/i)
    expect(all).not.toMatch(/recurring item/i)
    for (const name of ['Sam', 'Alex', 'Robin', 'Biscuit', 'The car', 'The flat']) expect(all).toContain(name)
    expect(GUIDE_LEAD.paragraphs).toHaveLength(3)
    expect(REPO_URL).toMatch(/^https:\/\/github\.com\//)
  })

  it('carries the model\'s option texts rather than copies of them', () => {
    expect(GUIDE.find((t) => t.key === 'investments')?.facts?.map((f) => f.text)).toEqual(ACCOUNT_TYPE_INFO.map((a) => a.help))
    expect(GUIDE.find((t) => t.key === 'goals')?.facts?.map((f) => f.label)).toEqual(GOAL_KIND_INFO.map((g) => g.label))
    expect(GUIDE.find((t) => t.key === 'people')?.facts?.map((f) => f.text)).toEqual(Object.values(ENTITY_KIND_HELP))
  })
})
