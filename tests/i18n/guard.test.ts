import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const SRC = join(__dirname, '../../src')

/** Errors that say a programming mistake, never shown as a sentence to a household: they stay in the code. */
const INVARIANTS = ['app/store.ts', 'model/money.ts', 'model/month.ts', 'model/migrations.ts']

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? (e.name === 'i18n' ? [] : sources(join(dir, e.name))) : /\.tsx?$/.test(e.name) ? [join(dir, e.name)] : [])
}

describe('no sentence is written where it is thrown (DESIGN.md §13)', () => {
  it('an error takes its sentence from the catalogue', () => {
    const found: string[] = []
    for (const file of sources(SRC)) {
      const name = file.slice(SRC.length + 1)
      if (INVARIANTS.includes(name)) continue
      readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
        if (/new (Error|DOMException)\(\s*['"`]/.test(line)) found.push(`${name}:${i + 1}`)
      })
    }
    expect(found).toEqual([])
  })

  it('the files left out still hold only the errors they are left out for', () => {
    const count = (name: string) => (readFileSync(join(SRC, name), 'utf8').match(/new Error\(\s*['"`]/g) ?? []).length
    expect(INVARIANTS.map(count)).toEqual([1, 1, 1, 1])
  })
})
