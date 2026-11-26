import { describe, expect, it } from 'vitest'
import { lang, lower, txt } from '@/i18n'
import { en } from '@/i18n/en'

/** Every text of a catalogue with the path to it; a text that takes something is called with stand-ins. */
function texts(node: unknown, path = ''): Array<[string, unknown]> {
  if (typeof node === 'function') return [[path, node]]
  if (node && typeof node === 'object') return Object.entries(node).flatMap(([k, v]) => texts(v, path ? `${path}.${k}` : k))
  return [[path, node]]
}

describe('the language layer', () => {
  it('speaks English where nothing says otherwise: under the tests, and until another language is chosen', () => {
    expect(lang).toBe('en')
    expect(txt).toBe(en)
  })

  it('a text is a string or a function that gives one, never empty and never padded', () => {
    const all = texts(en)
    expect(all.length).toBeGreaterThan(100)
    for (const [path, text] of all) {
      expect(['string', 'function'], path).toContain(typeof text)
      if (typeof text !== 'string') continue
      expect(text.length, path).toBeGreaterThan(0)
      expect(text, path).toBe(text.trim())
    }
  })

  it('lower-cases a label by the rules of the language', () => {
    expect(lower('Main account')).toBe('main account')
    expect(lower('ISK')).toBe('isk')
  })
})
