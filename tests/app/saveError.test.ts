import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { errorText, saveError, showSaveError } from '@/app/saveError'
import { PastChangeCancelled, PastChangeStale } from '@/store'

describe('what a failed save says', () => {
  it('nothing for a save cancelled at the question about the past; the message otherwise', () => {
    expect(saveError(new PastChangeCancelled(), 'Could not save.')).toBeNull()
    expect(saveError(new PastChangeStale(), 'Could not save.')).toBe('Something else was saved while the question was open. Nothing was saved: save again.')
    expect(saveError(new Error('No.'), 'Could not save.')).toBe('No.')
    expect(saveError('?', 'Could not save.')).toBe('Could not save.')
    expect(errorText(new Error('Offline.'), 'Could not fetch.')).toBe('Offline.')
    const shown: string[] = []
    showSaveError((m) => shown.push(m), 'Action failed')(new PastChangeCancelled())
    showSaveError((m) => shown.push(m), 'Action failed')(new Error('Refused.'))
    expect(shown).toEqual(['Refused.'])
  })

  it('every screen goes through it: none shows an error\'s message by itself', () => {
    const files = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? files(join(dir, d.name)) : /\.tsx?$/.test(d.name) ? [join(dir, d.name)] : []))
    const own = /instanceof Error \? \w+\.message/
    const offenders = [...files('src/features'), ...files('src/components')].filter((f) => own.test(readFileSync(f, 'utf8')))
    expect(offenders, 'use saveError (a save), showSaveError (a callback) or errorText (what never saves) from src/app/saveError.ts').toEqual([])
  })
})
