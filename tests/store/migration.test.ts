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
    expect(SCHEMA_VERSION).toBe(11)
    expect(parsed.schemaVersion).toBe(11)
    expect(parsed.tables.household[0].planUntil).toBeNull()
    expect(parsed.tables.rows[0].followsRowId).toBeNull()
  })
  it('a schema-1 file still migrates all the way (goals added on the way)', () => {
    const { goals: _goals, ...v1 } = EMPTY_TABLES
    const parsed = parseExportFile(file(1, { ...v1, household: [household] }))
    expect(parsed.schemaVersion).toBe(11)
    expect(parsed.tables.goals).toEqual([])
  })
  it('a schema-4 file needs no rewriting; schema 5 only adds the category-estimate row kind', () => {
    const parsed = parseExportFile(file(4, { ...EMPTY_TABLES, household: [household], rows: [row] }))
    expect(parsed.schemaVersion).toBe(11)
    expect(parsed.tables.rows[0].kind).toBe('plain')
    const estimate = { ...row, id: newId(), name: 'Housing – Not broken down yet', kind: 'category-estimate' }
    expect(parseExportFile(file(5, { ...EMPTY_TABLES, household: [household], rows: [row, estimate] })).tables.rows[1].kind).toBe('category-estimate')
  })
  it('a schema-5 file needs no rewriting; schema 6 adds the rule on a row, empty until one is set', () => {
    const parsed = parseExportFile(file(5, { ...EMPTY_TABLES, household: [household], rows: [row] }))
    expect(parsed.schemaVersion).toBe(11)
    expect(parsed.tables.rows[0].rule).toBeNull()
    expect(parsed.tables.rows[0].ruleShare).toBeNull()
    const ruled = { ...row, id: newId(), name: 'To investments', section: 'transfer', kind: 'to-investment', rule: 'share-of-income', ruleShare: 0.1 }
    expect(parseExportFile(file(6, { ...EMPTY_TABLES, household: [household], rows: [row, ruled] })).tables.rows[1].rule).toBe('share-of-income')
  })
  it('a schema-6 file needs no rewriting; schema 7 adds the row kind for money taken out of a savings account', () => {
    expect(parseExportFile(file(6, { ...EMPTY_TABLES, household: [household], rows: [row] })).schemaVersion).toBe(11)
    const taken = { ...row, id: newId(), name: 'From Savings', section: 'transfer', kind: 'from-savings' }
    expect(parseExportFile(file(7, { ...EMPTY_TABLES, household: [household], rows: [row, taken] })).tables.rows[1].kind).toBe('from-savings')
  })
  it('a schema-7 file needs no rewriting; schema 8 adds setting up on the Statement, off for a household made before it', () => {
    const parsed = parseExportFile(file(7, { ...EMPTY_TABLES, household: [household], rows: [row] }))
    expect(parsed.schemaVersion).toBe(11)
    expect(parsed.tables.household[0]).toMatchObject({ setupOpen: false, dismissedSuggestions: [] })
    expect(parsed.tables.rows[0].templateKey).toBeNull()
    const open = { ...household, setupOpen: true, dismissedSuggestions: ['household:h.gym'] }
    const suggested = { ...row, id: newId(), name: 'Groceries', templateKey: 'h.groceries' }
    const kept = parseExportFile(file(8, { ...EMPTY_TABLES, household: [open], rows: [suggested] }))
    expect(kept.tables.household[0]).toMatchObject({ setupOpen: true, dismissedSuggestions: ['household:h.gym'] })
    expect(kept.tables.rows[0].templateKey).toBe('h.groceries')
  })
  it('a schema-8 file needs no rewriting; schema 9 adds rules on pocket money, with a share of the adult\'s own income', () => {
    const pocket = { ...row, id: newId(), name: 'Sam – Pocket', section: 'transfer', kind: 'pocket-money', pocketMode: 'share-of-pocket-total', pocketShare: 0.5 }
    const parsed = parseExportFile(file(8, { ...EMPTY_TABLES, household: [household], rows: [row, pocket] }))
    expect(parsed.schemaVersion).toBe(11)
    // pocket money from before keeps its share of the pocket total until it gets a rule
    expect(parsed.tables.rows[1]).toMatchObject({ pocketMode: 'share-of-pocket-total', pocketShare: 0.5, rule: null })
    const ruled = { ...pocket, id: newId(), pocketMode: 'fixed', pocketShare: null, rule: 'share-of-own-income', ruleShare: 0.1 }
    expect(parseExportFile(file(9, { ...EMPTY_TABLES, household: [household], rows: [ruled] })).tables.rows[0].rule).toBe('share-of-own-income')
  })
  it('a schema-9 file needs no rewriting; schema 10 adds a share of one income line, with the line it is taken of', () => {
    const parsed = parseExportFile(file(9, { ...EMPTY_TABLES, household: [household], rows: [row] }))
    expect(parsed.schemaVersion).toBe(11)
    expect(parsed.tables.rows[0]).toMatchObject({ rule: null, ruleRowId: null })
    const salary = { ...row, id: newId(), name: 'Child benefit', section: 'income' }
    const ruled = { ...row, id: newId(), name: 'To investments', section: 'transfer', kind: 'to-investment', rule: 'share-of-row', ruleShare: 1, ruleRowId: salary.id }
    expect(parseExportFile(file(10, { ...EMPTY_TABLES, household: [household], rows: [salary, ruled] })).tables.rows[1]).toMatchObject({ rule: 'share-of-row', ruleShare: 1, ruleRowId: salary.id })
  })
  it('a schema-10 file needs no rewriting; schema 11 lets an expense come out of a named account', () => {
    const cell = { rowId: row.id, month: '2026-01', updatedAt: t0, mode: 'items', value: null, items: [{ id: newId(), label: 'Boiler', amount: 900_00, fundedBy: 'savings' }] }
    const parsed = parseExportFile(file(10, { ...EMPTY_TABLES, household: [household], rows: [{ ...row, defaultFundedBy: 'savings' }], cells: [cell] }))
    expect(parsed.schemaVersion).toBe(11)
    // what came out of "Savings balance" is left as it is: it keeps meaning the first savings account
    expect(parsed.tables.rows[0].defaultFundedBy).toBe('savings')
    expect(parsed.tables.cells[0].items[0].fundedBy).toBe('savings')
    const accountId = newId()
    const named = { ...cell, items: [{ ...cell.items[0], fundedBy: `account:${accountId}` }] }
    const kept = parseExportFile(file(11, { ...EMPTY_TABLES, household: [household], rows: [{ ...row, defaultFundedBy: `account:${accountId}` }], cells: [named] }))
    expect(kept.tables.rows[0].defaultFundedBy).toBe(`account:${accountId}`)
    expect(kept.tables.cells[0].items[0].fundedBy).toBe(`account:${accountId}`)
  })
  it('a file from a newer app is refused', () => {
    expect(() => parseExportFile(file(12, { ...EMPTY_TABLES, household: [household] }))).toThrow(/newer Casa Papel/)
  })
})
