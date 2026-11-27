import { describe, expect, it } from 'vitest'
import { foldName, inEveryLanguage, sameText } from '@/i18n'
import { en } from '@/i18n/en'
import { tr } from '@/i18n/tr'
import { isUsualCategory, missingUsualCategories } from '@/model'
import { isEstimateRowName } from '@/store'

type Leaf = string | ((...args: never[]) => unknown)

/** Every text of a catalogue with the path to it. */
function texts(node: unknown, path = ''): Array<[string, Leaf]> {
  if (typeof node === 'string' || typeof node === 'function') return [[path, node as Leaf]]
  if (node && typeof node === 'object') return Object.entries(node).flatMap(([k, v]) => texts(v, path ? `${path}.${k}` : k))
  throw new Error(`${path} is neither a text nor a group of texts`)
}

/** The Guide's lead and topics are English in both catalogues until they are translated (step 3 of the language plan). */
const untranslated = (path: string) => path.startsWith('guide.lead') || path.startsWith('guide.topics')
/**
 * Stand-ins a text that takes something is tried with: in each of up to five places a name, a count or a list of
 * names, in every combination, since a catalogue does not say what its texts take.
 */
const KINDS: unknown[] = ['Ada', 2, ['Bora', 'Cem']]
const STAND_INS: unknown[][] = Array.from({ length: KINDS.length ** 5 }, (_, n) => Array.from({ length: 5 }, (_, place) => KINDS[Math.floor(n / KINDS.length ** place) % KINDS.length]))
function said(text: Leaf, args: unknown[]): unknown {
  if (typeof text === 'string') return text
  try { return (text as (...a: unknown[]) => unknown)(...args) } catch { return undefined }
}
/** How many words a text holds beyond the stand-ins it was given. */
const words = (s: string) => s.replace(/Ada|Bora|Cem/g, '').split(/\s+/).filter((w) => /\p{L}{2,}/u.test(w)).length

describe('the Turkish catalogue', () => {
  const english = new Map(texts(en))
  const turkish = new Map(texts(tr))

  it('holds every text the English one holds, as the same kind of text, and nothing else', () => {
    expect([...turkish.keys()].sort()).toEqual([...english.keys()].sort())
    for (const [path, text] of turkish) expect(typeof text, path).toBe(typeof english.get(path))
  })

  it('a text is never empty and never padded', () => {
    for (const [path, text] of turkish) {
      if (typeof text !== 'string') continue
      expect(text.length, path).toBeGreaterThan(0)
      expect(text, path).toBe(text.trim())
      expect(text, path).not.toMatch(/\s{2,}/)
    }
  })

  it('a text that takes something gives the kind of text the English one gives', () => {
    for (const [path, text] of turkish) {
      if (typeof text !== 'function') continue
      // the stand-ins are guesses at what a text takes: it is tried with each, and compared where both languages take it
      const both = STAND_INS.map((args) => [said(english.get(path)!, args), said(text, args)]).filter(([theirs, ours]) => theirs !== undefined && ours !== undefined)
      expect(both.length, path).toBeGreaterThan(0)
      for (const [theirs, ours] of both) {
        expect(Array.isArray(ours), path).toBe(Array.isArray(theirs))
        expect(typeof ours, path).toBe(typeof theirs)
      }
    }
  })

  it('leaves no sentence in English', () => {
    const same: string[] = []
    for (const [path, text] of turkish) {
      if (untranslated(path)) continue
      for (const args of STAND_INS) {
        const ours = said(text, args)
        const theirs = said(english.get(path)!, args)
        if (typeof ours !== 'string' || typeof theirs !== 'string') continue
        if (ours === theirs && words(ours) >= 3) same.push(`${path}: ${ours}`)
        break
      }
    }
    expect(same).toEqual([])
  })

  it('keeps the rules of the (i) texts: a short title, whole sentences, at most 360 characters', () => {
    expect(Object.keys(tr.help).sort()).toEqual(Object.keys(en.help).sort())
    for (const [key, h] of Object.entries(tr.help)) {
      expect(h.title.trim().length, key).toBeGreaterThan(0)
      expect(h.title.length, key).toBeLessThanOrEqual(40)
      expect(h.text.trim().length, key).toBeGreaterThan(20)
      expect(h.text.length, key).toBeLessThanOrEqual(360)
      expect(h.text.trim().endsWith('.'), `${key} ends with a full stop`).toBe(true)
    }
  })

  it('uses the words of the word list (DESIGN.md §13)', () => {
    expect(tr.app.screen).toMatchObject({ statement: 'Bilanço', grid: 'Tablo', payments: 'Ödemeler', trends: 'Grafikler', household: 'Hane', data: 'Veriler', guide: 'Kılavuz' })
    expect(tr.common).toMatchObject({ cancel: 'İptal', save: 'Kaydet', repeats: 'Tekrarlar', transfers: 'Transferler', comesOutOf: 'Nereden çıkar', thisAndFollowing: 'Bu ay ve sonrası', paidOn: 'Ödeme günü', paidWith: 'Ödeme yöntemi', netWorth: 'Net varlık' })
    expect(tr.grid.page).toMatchObject({ leftover: 'Arta kalan', keptInAccount: 'Hesapta kalan', balances: 'Bakiyeler' })
    expect(tr.household.page.schedules).toBe('Düzenli kalemler')
    const all = [...turkish].filter(([path]) => !untranslated(path)).map(([, text]) => (typeof text === 'string' ? text : '')).join('\n')
    // the words he replaced are not used for the things he named
    expect(all).not.toMatch(/Vazgeç|Aktarımlar|Gidişat|Tekrarlayanlar/)
  })

  it('the two words to type can be typed on a Turkish and on an English keyboard', () => {
    // they are compared letter for letter, so they hold only letters both keyboards have: no İ, Ş, Ğ, Ü, Ö or Ç
    for (const word of [tr.data.page.wipe, tr.data.page.delete]) expect(word).toMatch(/^[A-Z ]+$/)
    expect(tr.data.page.removeEverythingPlain).toContain(tr.data.page.wipe)
    expect(tr.data.page.removesTheHouseholdFrom).toContain(tr.data.page.delete)
  })
})

describe('names that match in either language', () => {
  it('folds case by one rule for both languages: I, İ, ı and i are one letter', () => {
    expect(foldName('  Living ')).toBe('living')
    expect(sameText('Living', 'LİVİNG')).toBe(true)
    expect(sameText('Living', 'LIVING')).toBe(true)
    expect(sameText('Kişisel', 'KİŞİSEL')).toBe(true)
    expect(sameText('Kişisel', 'kisisel')).toBe(false)
    expect(sameText('Ulaşım', 'ULAŞIM')).toBe(true)
    expect(sameText('Housing', 'Konut')).toBe(false)
  })

  it('a usual category is found under its English or its Turkish name', () => {
    expect(inEveryLanguage((m) => m.names.category.housing)).toEqual(['Housing', 'Konut'])
    expect(isUsualCategory('Housing', 'housing')).toBe(true)
    expect(isUsualCategory('konut', 'housing')).toBe(true)
    expect(isUsualCategory('KİŞİSEL', 'personal')).toBe(true)
    expect(isUsualCategory('Konut', 'living')).toBe(false)
    expect(isUsualCategory('My housing', 'housing')).toBe(false)
  })

  it('a household with some usual categories in Turkish misses only the others', () => {
    expect(missingUsualCategories(['Konut', 'Living', 'ULAŞIM'])).toEqual(['Family & pets', 'Fun', 'Personal'])
    expect(missingUsualCategories(['Konut', 'Yaşam', 'Ulaşım', 'Aile ve evcil hayvanlar', 'Eğlence', 'Kişisel'])).toEqual([])
  })

  it('an estimate row is known by the name either language gives it', () => {
    expect(isEstimateRowName('Housing – Not broken down yet', { name: 'Housing' })).toBe(true)
    expect(isEstimateRowName('Konut – Henüz dağıtılmadı', { name: 'Konut' })).toBe(true)
    expect(isEstimateRowName('Konut – Not broken down yet', { name: 'Konut' })).toBe(true)
    expect(isEstimateRowName('Konut', { name: 'Konut' })).toBe(false)
  })
})
