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
    expect(SCHEMA_VERSION).toBe(16)
    expect(parsed.schemaVersion).toBe(16)
    expect(parsed.tables.household[0].planUntil).toBeNull()
    expect(parsed.tables.rows[0].followsRowId).toBeNull()
  })
  it('a schema-1 file still migrates all the way (goals added on the way)', () => {
    const { goals: _goals, ...v1 } = EMPTY_TABLES
    const parsed = parseExportFile(file(1, { ...v1, household: [household] }))
    expect(parsed.schemaVersion).toBe(16)
    expect(parsed.tables.goals).toEqual([])
  })
  it('a schema-4 file needs no rewriting; schema 5 only adds the category-estimate row kind', () => {
    const parsed = parseExportFile(file(4, { ...EMPTY_TABLES, household: [household], rows: [row] }))
    expect(parsed.schemaVersion).toBe(16)
    expect(parsed.tables.rows[0].kind).toBe('plain')
    const estimate = { ...row, id: newId(), name: 'Housing – Not broken down yet', kind: 'category-estimate' }
    expect(parseExportFile(file(5, { ...EMPTY_TABLES, household: [household], rows: [row, estimate] })).tables.rows[1].kind).toBe('category-estimate')
  })
  it('a schema-5 file needs no rewriting; schema 6 adds the rule on a row, empty until one is set', () => {
    const parsed = parseExportFile(file(5, { ...EMPTY_TABLES, household: [household], rows: [row] }))
    expect(parsed.schemaVersion).toBe(16)
    expect(parsed.tables.rows[0].rule).toBeNull()
    expect(parsed.tables.rows[0].ruleShare).toBeNull()
    const ruled = { ...row, id: newId(), name: 'To investments', section: 'transfer', kind: 'to-investment', rule: 'share-of-income', ruleShare: 0.1 }
    expect(parseExportFile(file(6, { ...EMPTY_TABLES, household: [household], rows: [row, ruled] })).tables.rows[1].rule).toBe('share-of-income')
  })
  it('a schema-6 file needs no rewriting; schema 7 adds the row kind for money taken out of a savings account', () => {
    expect(parseExportFile(file(6, { ...EMPTY_TABLES, household: [household], rows: [row] })).schemaVersion).toBe(16)
    const taken = { ...row, id: newId(), name: 'From Savings', section: 'transfer', kind: 'from-savings' }
    expect(parseExportFile(file(7, { ...EMPTY_TABLES, household: [household], rows: [row, taken] })).tables.rows[1].kind).toBe('from-savings')
  })
  it('a schema-7 file needs no rewriting; schema 8 adds setting up on the Statement, off for a household made before it', () => {
    const parsed = parseExportFile(file(7, { ...EMPTY_TABLES, household: [household], rows: [row] }))
    expect(parsed.schemaVersion).toBe(16)
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
    expect(parsed.schemaVersion).toBe(16)
    // pocket money from before keeps its share of the pocket total until it gets a rule
    expect(parsed.tables.rows[1]).toMatchObject({ pocketMode: 'share-of-pocket-total', pocketShare: 0.5, rule: null })
    const ruled = { ...pocket, id: newId(), pocketMode: 'fixed', pocketShare: null, rule: 'share-of-own-income', ruleShare: 0.1 }
    expect(parseExportFile(file(9, { ...EMPTY_TABLES, household: [household], rows: [ruled] })).tables.rows[0].rule).toBe('share-of-own-income')
  })
  it('a schema-9 file needs no rewriting; schema 10 adds a share of one income line, with the line it is taken of', () => {
    const parsed = parseExportFile(file(9, { ...EMPTY_TABLES, household: [household], rows: [row] }))
    expect(parsed.schemaVersion).toBe(16)
    expect(parsed.tables.rows[0]).toMatchObject({ rule: null, ruleRowId: null })
    const salary = { ...row, id: newId(), name: 'Child benefit', section: 'income' }
    const ruled = { ...row, id: newId(), name: 'To investments', section: 'transfer', kind: 'to-investment', rule: 'share-of-row', ruleShare: 1, ruleRowId: salary.id }
    expect(parseExportFile(file(10, { ...EMPTY_TABLES, household: [household], rows: [salary, ruled] })).tables.rows[1]).toMatchObject({ rule: 'share-of-row', ruleShare: 1, ruleRowId: salary.id })
  })
  it('a schema-10 file needs no rewriting; schema 11 lets an expense come out of a named account', () => {
    const cell = { rowId: row.id, month: '2026-01', updatedAt: t0, mode: 'items', value: null, items: [{ id: newId(), label: 'Boiler', amount: 900_00, fundedBy: 'savings' }] }
    const parsed = parseExportFile(file(10, { ...EMPTY_TABLES, household: [household], rows: [{ ...row, defaultFundedBy: 'savings' }], cells: [cell] }))
    expect(parsed.schemaVersion).toBe(16)
    // what came out of "Savings balance" is left as it is: it keeps meaning the first savings account
    expect(parsed.tables.rows[0].defaultFundedBy).toBe('savings')
    expect(parsed.tables.cells[0].items[0].fundedBy).toBe('savings')
    const accountId = newId()
    const named = { ...cell, items: [{ ...cell.items[0], fundedBy: `account:${accountId}` }] }
    const kept = parseExportFile(file(11, { ...EMPTY_TABLES, household: [household], rows: [{ ...row, defaultFundedBy: `account:${accountId}` }], cells: [named] }))
    expect(kept.tables.rows[0].defaultFundedBy).toBe(`account:${accountId}`)
    expect(kept.tables.cells[0].items[0].fundedBy).toBe(`account:${accountId}`)
  })
  it('a schema-11 file needs no rewriting; schema 12 gives a cash account a balance of its own', () => {
    const t = Date.UTC(2026, 0, 1)
    const cash = { id: newId(), createdAt: t, updatedAt: t, name: 'Wallet', type: 'cash', currency: 'EUR', openingBalance: 300_00, openingMonth: '2026-01', tracked: false }
    const real = { accountId: cash.id, month: '2026-01', actualBalance: 250_00, updatedAt: t }
    const parsed = parseExportFile(file(11, { ...EMPTY_TABLES, household: [household], accounts: [cash], accountMonths: [real] }))
    expect(parsed.schemaVersion).toBe(16)
    // stored as it was: the account keeps its type, its opening amount, its real balance and even its "untracked" flag
    expect(parsed.tables.accounts[0]).toMatchObject({ type: 'cash', openingBalance: 300_00, tracked: false })
    expect(parsed.tables.accountMonths[0]).toMatchObject({ actualBalance: 250_00 })
  })
  it('a schema-12 file needs no rewriting; schema 13 lets an account be left out of net worth, and none is until it is said', () => {
    const t = Date.UTC(2026, 0, 1)
    const savings = { id: newId(), createdAt: t, updatedAt: t, name: 'Savings', type: 'savings', currency: 'EUR', openingBalance: 1000_00, openingMonth: '2026-01', tracked: true }
    const pocket = { id: newId(), createdAt: t, updatedAt: t, name: 'Sam – Pocket', section: 'transfer', kind: 'pocket-money', accountId: savings.id }
    const parsed = parseExportFile(file(12, { ...EMPTY_TABLES, household: [household], accounts: [savings], rows: [pocket] }))
    expect(parsed.schemaVersion).toBe(16)
    expect(parsed.tables.accounts[0]).toMatchObject({ name: 'Savings', outsideNetWorth: false })
    // an account a pocket money row named "for the overview" is still only named: nothing lands in a counted account
    expect(parsed.tables.rows[0]).toMatchObject({ kind: 'pocket-money', accountId: savings.id })
  })
  it('a schema-13 file needs no rewriting; schema 14 keeps what an archive changed, and an older archive has nothing kept', () => {
    const t = Date.UTC(2026, 0, 1)
    const savings = { id: newId(), createdAt: t, updatedAt: t, name: 'Savings', type: 'savings', currency: 'EUR', openingBalance: 1000_00, openingMonth: '2026-01', tracked: true, archivedMonth: '2026-06' }
    const rent = { id: newId(), createdAt: t, updatedAt: t, name: 'Rent', section: 'expense', archivedMonth: '2026-06' }
    const travel = { id: newId(), createdAt: t, updatedAt: t, name: 'Travel', accountId: savings.id, archivedMonth: '2026-06' }
    const parsed = parseExportFile(file(13, { ...EMPTY_TABLES, household: [household], accounts: [savings], rows: [rent], pools: [travel] }))
    expect(parsed.schemaVersion).toBe(16)
    // archived before the app kept track: still archived, and with no memo of what the archive changed
    expect(parsed.tables.accounts[0]).toMatchObject({ archivedMonth: '2026-06', archiveMemo: null })
    expect(parsed.tables.rows[0]).toMatchObject({ archivedMonth: '2026-06', archiveMemo: null })
    expect(parsed.tables.pools[0]).toMatchObject({ archivedMonth: '2026-06', archiveMemo: null })
  })
  it('a schema-14 file needs no rewriting; schema 15 closes no month, and a month that was closed keeps its mark in the file', () => {
    const t = Date.UTC(2026, 0, 1)
    const closed = { month: '2026-01', closed: true, closedAt: t, pocketTotalOverride: 0, cashBufferOverride: 500_00, updatedAt: t }
    const parsed = parseExportFile(file(14, { ...EMPTY_TABLES, household: [household], monthStates: [closed] }))
    expect(parsed.schemaVersion).toBe(16)
    // the file is read as it is: the app turns the month into one with every line ticked when it opens the data (`planHousekeeping`)
    expect(parsed.tables.monthStates[0]).toMatchObject({ month: '2026-01', closed: true, closedAt: t, cashBufferOverride: 500_00 })
  })
  it('a schema-15 file needs no rewriting; schema 16 adds the mark of an amount that is its month\'s alone, and no stored month carries it', () => {
    const t = Date.UTC(2026, 0, 1)
    const rowId = newId()
    const row = { id: rowId, createdAt: t, updatedAt: t, name: 'Rent', section: 'expense', order: 'a0' }
    // an exception of an older version: the amount for March, and the old amount written into April
    const cells = [
      { rowId, month: '2026-01', mode: 'value', value: 1200_00, items: [], updatedAt: t },
      { rowId, month: '2026-03', mode: 'value', value: 1500_00, items: [], updatedAt: t },
      { rowId, month: '2026-04', mode: 'value', value: 1200_00, items: [], updatedAt: t },
    ]
    const parsed = parseExportFile(file(15, { ...EMPTY_TABLES, household: [household], rows: [row], cells }))
    expect(parsed.schemaVersion).toBe(16)
    expect(parsed.tables.cells.map((c) => [c.month, c.value, c.once])).toEqual([['2026-01', 1200_00, false], ['2026-03', 1500_00, false], ['2026-04', 1200_00, false]])
  })
  it('a file from a newer app is refused', () => {
    expect(() => parseExportFile(file(17, { ...EMPTY_TABLES, household: [household] }))).toThrow(/newer Casa Papel/)
  })
})
