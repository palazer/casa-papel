import { describe, expect, it } from 'vitest'
import { HELP } from '@/app/help'
import { ACCOUNT_TYPE_INFO, ENTITY_KIND_HELP, GOAL_KIND_INFO, SECTION_INFO } from '@/model'

describe('help texts', () => {
  it('every key has a short title and a text in whole sentences', () => {
    const keys = Object.keys(HELP)
    expect(keys.length).toBeGreaterThan(20)
    for (const [key, h] of Object.entries(HELP)) {
      expect(key).toMatch(/^[a-z]+\.[A-Za-z]+$/)
      expect(h.title.trim().length, key).toBeGreaterThan(0)
      expect(h.title.length, key).toBeLessThanOrEqual(40)
      expect(h.text.trim().length, key).toBeGreaterThan(20)
      expect(h.text.length, key).toBeLessThanOrEqual(360)
      expect(h.text.trim().endsWith('.'), `${key} ends with a full stop`).toBe(true)
      expect(h.text, key).not.toMatch(/\s{2,}/)
    }
  })

  it('covers every section', () => {
    for (const s of Object.keys(SECTION_INFO)) expect(HELP).toHaveProperty(`section.${s}`)
  })

  it('uses the app\'s own names', () => {
    const all = [
      ...Object.values(HELP).map((h) => `${h.title} ${h.text}`),
      ...Object.values(SECTION_INFO).map((s) => `${s.label} ${s.blurb}`),
      ...Object.values(ENTITY_KIND_HELP),
      ...GOAL_KIND_INFO.map((g) => `${g.label} ${g.help}`),
      ...ACCOUNT_TYPE_INFO.map((a) => `${a.label} ${a.help}`),
    ].join(' ')
    expect(all).not.toMatch(/envelope/i)
    expect(all).not.toMatch(/\bentit(y|ies)\b/i)
    expect(all).not.toMatch(/recurring item/i)
  })
})
