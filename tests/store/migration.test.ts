import { describe, expect, it } from 'vitest'
import { EMPTY_TABLES, SCHEMA_VERSION, newId } from '@/model'
import { parseExportFile } from '@/store'

const t0 = Date.now()
const household = { id: newId(), createdAt: t0, updatedAt: t0, deletedAt: null, name: 'Old', baseCurrency: 'EUR', locale: 'en-IE', startMonth: '2026-01' }
const row = { id: newId(), createdAt: t0, updatedAt: t0, deletedAt: null, name: 'Rent', section: 'expense' }
const file = (schemaVersion: number, tables: Record<string, unknown>) => ({ format: 'casa-papel', schemaVersion, exportedAt: t0, deviceId: 'dev', tables, events: [] })

describe('export file migration', () => {
  it('a schema-3 file comes up to date with the new fields at their defaults', () => {
    const parsed = parseExportFile(file(3, { ...EMPTY_TABLES, household: [household], rows: [row] }))
    expect(SCHEMA_VERSION).toBe(5)
    expect(parsed.schemaVersion).toBe(5)
    expect(parsed.tables.household[0].planUntil).toBeNull()
    expect(parsed.tables.rows[0].followsRowId).toBeNull()
  })
  it('a schema-1 file still migrates all the way (goals added on the way)', () => {
    const { goals: _goals, ...v1 } = EMPTY_TABLES
    const parsed = parseExportFile(file(1, { ...v1, household: [household] }))
    expect(parsed.schemaVersion).toBe(5)
    expect(parsed.tables.goals).toEqual([])
  })
  it('a schema-4 file needs no rewriting; schema 5 only adds the category-estimate row kind', () => {
    const parsed = parseExportFile(file(4, { ...EMPTY_TABLES, household: [household], rows: [row] }))
    expect(parsed.schemaVersion).toBe(5)
    expect(parsed.tables.rows[0].kind).toBe('plain')
    const estimate = { ...row, id: newId(), name: 'Housing – Not broken down yet', kind: 'category-estimate' }
    expect(parseExportFile(file(5, { ...EMPTY_TABLES, household: [household], rows: [row, estimate] })).tables.rows[1].kind).toBe('category-estimate')
  })
  it('a file from a newer app is refused', () => {
    expect(() => parseExportFile(file(6, { ...EMPTY_TABLES, household: [household] }))).toThrow(/newer Casa Papel/)
  })
})
