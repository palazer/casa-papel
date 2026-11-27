import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { newId } from '@/model'

/**
 * A device that chose Turkish, then an English one that opens the same household. The language is read once when the
 * layer is first evaluated, so each device is a fresh load of the app's modules: with the choice in its storage for
 * the Turkish one, with no window at all (as under every other test) for the English one. Both see one database.
 */
const dbName = `test-${newId()}`

async function device(language: 'tr' | 'en') {
  vi.resetModules()
  if (language === 'tr') vi.stubGlobal('window', { localStorage: { getItem: (key: string) => (key === 'casa.lang' ? '"tr"' : null), setItem: () => undefined } })
  else vi.unstubAllGlobals()
  const [i18n, store, format, model, start, cadence] = await Promise.all([
    import('@/i18n'), import('@/store'), import('@/app/format'), import('@/model'), import('@/features/setup/start'), import('@/features/recurring/repeatText'),
  ])
  return { i18n, store, format, model, start, cadence }
}

describe('a household made on a Turkish device', () => {
  let turkish: Awaited<ReturnType<typeof device>>
  beforeAll(async () => { turkish = await device('tr') })
  afterAll(() => { vi.unstubAllGlobals() })

  it('the device speaks Turkish', () => {
    expect(turkish.i18n.lang).toBe('tr')
    expect(turkish.i18n.txt.common.cancel).toBe('İptal')
    expect(turkish.i18n.lower('KİŞİSEL IŞIK')).toBe('kişisel ışık')
    expect(turkish.model.SECTION_INFO.income.label).toBe('Giren para')
  })

  it('setup starts with the Turkish format and the lira', () => {
    expect(turkish.start.newStart('2026-11', 'en-US')).toMatchObject({ locale: 'tr-TR', currency: 'TRY' })
    expect(turkish.start.toSetupInput({ ...turkish.start.newStart('2026-11', 'tr-TR'), adults: ['', ''] })).toMatchObject({ household: { name: 'Hanemiz' }, adults: [{ name: 'Ben' }] })
  })

  it('months and weekdays are named in Turkish whatever the household\'s format; the order stays the format\'s', () => {
    const { formatMonth, weekdayOf, formatAmount } = turkish.format
    expect(formatMonth('2026-11', 'tr-TR', 'long')).toBe('Kasım 2026')
    expect(formatMonth('2026-11', 'en-IE', 'long')).toBe('Kasım 2026')
    expect(formatMonth('2026-11', 'en-US')).toBe('Kas 2026')
    expect(weekdayOf('2026-11', 27, 'en-IE')).toBe('Cum')
    expect(turkish.i18n.formatDate(new Date(Date.UTC(2026, 10, 2)), 'en-US', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })).toBe('Kas 2, 2026')
    expect(turkish.i18n.formatDate(new Date(Date.UTC(2026, 10, 2)), 'en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })).toBe('2 Kas 2026')
    // digits and decimal signs are the household's
    expect(formatAmount(123456, 'EUR', 'en-IE')).toBe('€1,234.56')
    expect(turkish.cadence.monthName(3, 'en-IE')).toBe('Mart')
  })

  it('gets Turkish categories, suggested rows under them, and Turkish names for what the app writes', async () => {
    const { Store, CasaDb, createHouseholdFromSetup, loadTables, rowSuggestions, addSuggestion, starterMethods, estimateRowName } = turkish.store
    const store = new Store(new CasaDb(dbName))
    await createHouseholdFromSetup(store, {
      household: { name: 'Ev', baseCurrency: 'TRY', locale: 'tr-TR', startMonth: '2026-09', closingRule: 'leftover-plug', setupOpen: true },
      adults: [{ name: 'Sam' }], dependents: [{ kind: 'property', name: 'Daire' }], accounts: [], householdTemplates: [], entityTemplates: {},
    })
    let t = await loadTables(store)
    expect(t.categories.map((c) => c.name)).toEqual(['Konut', 'Yaşam', 'Ulaşım', 'Aile ve evcil hayvanlar', 'Eğlence', 'Kişisel'])
    const konut = t.categories.find((c) => c.name === 'Konut')!
    const all = rowSuggestions(t)
    expect(all.find((s) => s.title === 'Sam – Maaş')?.place).toBe('income')
    const rent = all.find((s) => s.title === 'Daire – Kira veya konut kredisi')!
    expect(rent.place).toBe(`cat:expense:${konut.id}`)
    const row = await addSuggestion(store, rent.id)
    expect(row).toMatchObject({ name: 'Daire – Kira veya konut kredisi', categoryId: konut.id })
    t = await loadTables(store)
    expect(starterMethods(t).map((m) => m.name)).toEqual(['Otomatik ödeme', 'Düzenli transfer', 'Elle transfer', 'Nakit'])
    expect(estimateRowName(konut)).toBe('Konut – Henüz dağıtılmadı')
  })

  it('an error is a Turkish sentence', async () => {
    const { Store, CasaDb, addCategory } = turkish.store
    const store = new Store(new CasaDb(dbName))
    await expect(addCategory(store, { name: 'konut', section: 'expense' })).rejects.toThrow(/[çğışöüİ]/)
  })
})

describe('an English device that opens that household', () => {
  let english: Awaited<ReturnType<typeof device>>
  beforeAll(async () => { english = await device('en') })

  it('speaks English, and names months in English in the Turkish format', () => {
    expect(english.i18n.lang).toBe('en')
    expect(english.format.formatMonth('2026-11', 'tr-TR', 'long')).toBe('November 2026')
    expect(english.format.formatMonth('2026-09', 'en-IE')).toBe(new Intl.DateTimeFormat('en-IE', { month: 'short', year: 'numeric' }).format(new Date(2026, 8, 1)))
    expect(english.format.weekdayOf('2026-11', 27, 'tr-TR')).toBe('Fri')
    expect(english.start.newStart('2026-11', 'tr-TR')).toMatchObject({ locale: 'tr-TR', currency: 'EUR' })
  })

  it('finds the Turkish categories for its own suggested rows, and offers no usual category twice', async () => {
    const { Store, CasaDb, loadTables, rowSuggestions, addSuggestion, seedDefaultCategories } = english.store
    const store = new Store(new CasaDb(dbName))
    let t = await loadTables(store)
    const konut = t.categories.find((c) => c.name === 'Konut')!
    const all = rowSuggestions(t)
    // the rent row is there already, under its Turkish name: it is not offered again
    expect(all.some((s) => s.title === 'Daire – Rent or mortgage')).toBe(false)
    const utilities = all.find((s) => s.title === 'Daire – Utilities')!
    expect(utilities.place).toBe(`cat:expense:${konut.id}`)
    expect(await addSuggestion(store, utilities.id)).toMatchObject({ name: 'Daire – Utilities', categoryId: konut.id })
    expect(await seedDefaultCategories(store)).toBe(0)
    t = await loadTables(store)
    expect(t.categories.filter((c) => !c.deletedAt)).toHaveLength(6)
  })

  it('offers no starter method that is there under its Turkish name', async () => {
    const { Store, CasaDb, loadTables, addPaymentMethods, starterMethods } = english.store
    const store = new Store(new CasaDb(dbName))
    await addPaymentMethods(store, [{ kind: 'direct-debit', name: 'Otomatik ödeme', ownerEntityId: null, note: '' }, { kind: 'cash', name: 'NAKİT', ownerEntityId: null, note: '' }])
    expect(starterMethods(await loadTables(store)).map((m) => m.name)).toEqual(['Standing order', 'Transfer by hand'])
  })
})
