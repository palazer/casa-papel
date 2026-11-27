import { describe, expect, it } from 'vitest'
import { foldName, inEveryLanguage, sameText } from '@/i18n'
import { en } from '@/i18n/en'
import { tr } from '@/i18n/tr'
import { computeEngine } from '@/engine'
import { buildDemoTables } from '@/demo/demoHousehold'
import { isUsualCategory, missingUsualCategories, monthRange } from '@/model'
import { isEstimateRowName } from '@/store'

type Leaf = string | ((...args: never[]) => unknown)

/** Every text of a catalogue with the path to it. */
const textsOf = (node: unknown): Array<[string, Leaf]> => texts(node)
function texts(node: unknown, path = ''): Array<[string, Leaf]> {
  if (typeof node === 'string' || typeof node === 'function') return [[path, node as Leaf]]
  if (Array.isArray(node)) return node.flatMap((v, i) => texts(v, `${path}[${i}]`))
  if (node && typeof node === 'object') return Object.entries(node).flatMap(([k, v]) => texts(v, path ? `${path}.${k}` : k))
  throw new Error(`${path} is neither a text nor a group of texts`)
}

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
    const all = [...turkish].map(([, text]) => (typeof text === 'string' ? text : '')).join('\n')
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

describe('the Guide in Turkish', () => {
  const sentence = (text: string, what: string) => {
    expect(text.trim().length, what).toBeGreaterThan(0)
    expect(text.trim().endsWith('.'), `${what} ends with a full stop: …${text.slice(-24)}`).toBe(true)
    expect(text, what).not.toMatch(/\s{2,}/)
  }

  it('keeps the Guide\'s rules: the same topics, short titles, whole sentences, three to eight steps', () => {
    expect(Object.keys(tr.guide.topics)).toEqual(Object.keys(en.guide.topics))
    expect(tr.guide.lead.paragraphs).toHaveLength(3)
    tr.guide.lead.paragraphs.forEach((p, i) => sentence(p, `lead ${i}`))
    for (const [key, topic] of Object.entries(tr.guide.topics)) {
      const english = en.guide.topics[key as keyof typeof en.guide.topics]
      expect(topic.title.length, key).toBeLessThanOrEqual(40)
      sentence(topic.summary, `${key} summary`)
      expect(topic.what.length, key).toBe(english.what.length)
      topic.what.forEach((p, i) => sentence(p, `${key} paragraph ${i}`))
      expect(topic.steps.length, key).toBe(english.steps.length)
      topic.steps.forEach((step, i) => sentence(step, `${key} step ${i}`))
      expect('factsTitle' in topic, key).toBe('factsTitle' in english)
    }
  })

  it('quotes the controls by their Turkish names, and speaks of the Turkish demo household', () => {
    const texts = [...tr.guide.lead.paragraphs, ...Object.values(tr.guide.topics).flatMap((t) => [t.title, t.summary, ...t.what, ...t.steps])]
    const all = texts.join(' ')
    for (const name of [...Object.values(tr.demo.entity), tr.demo.row.rent, tr.demo.row.samSalary, tr.demo.account.invest, tr.demo.pool.travel, tr.demo.row.travelAlloc]) expect(all, name).toContain(name)
    // a label in quotes that is a plain text of the English catalogue has not been translated
    const plain = (catalogue: unknown, skip: (path: string) => boolean): Set<string> => new Set(textsOf(catalogue).filter(([path, text]) => typeof text === 'string' && !skip(path)).map(([, text]) => text as string))
    const turkish = plain(tr, (path) => path.startsWith('guide.lead') || path.startsWith('guide.topics'))
    const english = plain(en, (path) => path.startsWith('guide.') || path.startsWith('demo.'))
    const left = new Set<string>()
    for (const text of texts) for (const [, quoted] of text.matchAll(/"([^"]+)"/g)) if (english.has(quoted) && !turkish.has(quoted)) left.add(quoted)
    expect([...left]).toEqual([])
  })
})

describe('the demo household in Turkish', () => {
  it('is the same household: the same records and figures, other names, the Turkish format', () => {
    const english = buildDemoTables(en.demo)
    const turkish = buildDemoTables(tr.demo)
    expect(turkish.household[0]).toMatchObject({ name: 'Demo hane', locale: 'tr-TR', baseCurrency: 'EUR' })
    for (const table of ['entities', 'accounts', 'categories', 'rows', 'recurringItems', 'pools', 'paymentMethods'] as const) {
      expect(turkish[table].map((r) => r.id), table).toEqual(english[table].map((r) => r.id))
    }
    expect(turkish.rows.map((r) => r.name)).toContain('Daire – Kira')
    expect(turkish.rows.filter((r, i) => r.name === english.rows[i].name).map((r) => r.name)).toEqual([])
    const months = monthRange('2026-09', '2027-12')
    const figures = (tables: ReturnType<typeof buildDemoTables>) => { const e = computeEngine({ tables, months }); return months.map((m) => [e.netWorth[m], e.totals[m]?.expensesTotal, e.totals[m]?.leftover, e.totals[m]?.toSavings]) }
    expect(figures(turkish)).toEqual(figures(english))
  })

  it('carries the usual categories under the names a Turkish household gets', () => {
    const names = buildDemoTables(tr.demo).categories.map((c) => c.name)
    for (const key of ['housing', 'living', 'transport', 'family', 'fun', 'personal'] as const) expect(names.some((n) => isUsualCategory(n, key)), key).toBe(true)
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
