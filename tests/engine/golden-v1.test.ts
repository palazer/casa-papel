import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import {
  AccountSchema, CellSchema, HouseholdSchema, MonthStateSchema, RowSchema, EMPTY_TABLES, newId, type Cell, type Row, type Tables,
} from '@/model'
import { computeEngine } from '@/engine'
import { byRow, minor, num, type RawFixture } from './fixtures/rawFixture'

/**
 * Private golden: runs only where tests/private/v1-raw.json exists (never in CI).
 * Checks the savings plug against months where the spreadsheet itself used the
 * plug formula and had no "From Savings" entries (where its own maths differs).
 */
const PATH = new URL('../private/v1-raw.json', import.meta.url)
const present = existsSync(PATH)

describe.skipIf(!present)('golden: v1 household workbook (private)', () => {
  const fixture = present ? (JSON.parse(readFileSync(PATH, 'utf8')) as RawFixture) : null!
  const flow = fixture.sheets.Flow
  const rows = byRow(flow)
  const months = flow.months
  const T0 = Date.UTC(2022, 11, 1)
  const base = () => ({ id: newId(), createdAt: T0, updatedAt: T0, deletedAt: null })

  const household = HouseholdSchema.parse({ ...base(), name: 'v1', baseCurrency: 'EUR', locale: 'de-DE', startMonth: months[0], closingRule: 'savings-plug' })
  const savings = AccountSchema.parse({ ...base(), name: 'Savings', type: 'savings', currency: 'EUR', openingMonth: months[0], tracked: true, openingBalance: minor(num(rows.get(2)?.cells[0])) })

  const incomeRows = [10, 11, 12, 13, 14]
  const expenseRows = [...Array.from({ length: 21 }, (_, i) => 22 + i), ...Array.from({ length: 8 }, (_, i) => 45 + i)]
  const appRows: Row[] = []
  const cells: Cell[] = []
  const add = (r: number, section: Row['section'], kind: Row['kind'] = 'plain') => {
    const raw = rows.get(r)
    if (!raw || !raw.label || /Insert New|N\/A/.test(raw.label)) return
    const row = RowSchema.parse({ ...base(), name: raw.label, section, kind, order: String(r).padStart(3, '0') })
    appRows.push(row)
    months.forEach((m, i) => cells.push(CellSchema.parse({ rowId: row.id, month: m, mode: 'value', value: minor(num(raw.cells[i])), items: [], updatedAt: T0 })))
  }
  incomeRows.forEach((r) => add(r, 'income'))
  add(16, 'income', 'from-investment')
  add(21, 'transfer', 'to-investment')
  expenseRows.forEach((r) => add(r, 'expense'))
  appRows.push(RowSchema.parse({ ...base(), name: 'To Savings', section: 'transfer', kind: 'to-savings', accountId: savings.id, order: '999' }))

  // the sheet's "Total" row is cash kept in the account; model it as the buffer
  const monthStates = months.map((m, i) => MonthStateSchema.parse({ month: m, closed: false, cashBufferOverride: minor(num(rows.get(55)?.cells[i])), updatedAt: T0 }))

  const tables: Tables = { ...EMPTY_TABLES, household: [household], accounts: [savings], rows: appRows, cells, monthStates }
  const out = computeEngine({ tables, months })

  const plugMonths = months
    .map((m, i) => ({ m, i }))
    .filter(({ i }) => {
      const ts = rows.get(20)?.cells[i]
      const fs = num(rows.get(15)?.cells[i])
      return !!ts?.f && ts.f.startsWith('-') && ts.f.includes('18') && fs === 0
    })

  it('finds enough plug months with no savings draws to test', () => {
    expect(plugMonths.length).toBeGreaterThanOrEqual(8)
  })

  it('reproduces the income subtotal in those months', () => {
    for (const { m, i } of plugMonths) expect(out.totals[m].income).toBe(minor(num(rows.get(18)?.cells[i])))
  })

  it('reproduces the sheet\'s To Savings plug in those months', () => {
    for (const { m, i } of plugMonths) {
      const sheet = -Math.round(num(rows.get(20)?.cells[i]) * 100)
      expect(Math.abs(out.totals[m].toSavings - sheet)).toBeLessThanOrEqual(1)
    }
  })

  it('reproduces each month\'s savings delta in those months', () => {
    for (const { m, i } of plugMonths) {
      if (i === 0) continue
      const sheetDelta = Math.round((num(rows.get(2)?.cells[i]) - num(rows.get(2)?.cells[i - 1])) * 100)
      const s = out.accounts[savings.id].months[m]
      expect(Math.abs(s.inflow - s.outflow - sheetDelta)).toBeLessThanOrEqual(1)
    }
  })
})
