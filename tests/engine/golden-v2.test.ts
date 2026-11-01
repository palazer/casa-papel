import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { computeEngine } from '@/engine'
import { byRow, minor, num, type RawFixture } from './fixtures/rawFixture'
import { v2ToTables } from './fixtures/v2Adapter'

const fixture = JSON.parse(readFileSync(new URL('./golden/v2-raw.json', import.meta.url), 'utf8')) as RawFixture
const rows = byRow(fixture.sheets.Flow)
const sheet = (r: number, i: number) => num(rows.get(r)?.cells[i])

describe('golden: v2 template workbook', () => {
  const { tables, months, rowIdBySheetRow, savingsId, poolIds } = v2ToTables(fixture)
  const out = computeEngine({ tables, months })

  it('has no warnings and covers every month', () => {
    expect(out.warnings).toEqual([])
    expect(out.months).toEqual(months)
  })

  it('reproduces the income subtotal, including the USD salary converted at the monthly rate', () => {
    months.forEach((m, i) => {
      expect(Math.abs(out.totals[m].income - minor(sheet(22, i)))).toBeLessThanOrEqual(1)
    })
  })

  it('reproduces "To Savings" as the plug every month', () => {
    months.forEach((m, i) => {
      // sheet stores outflows negative; the app stores "into savings" positive
      expect(Math.abs(out.totals[m].toSavings - -Math.round(sheet(24, i) * 100))).toBeLessThanOrEqual(1)
    })
  })

  it('accumulates the three pools like rows 57–59', () => {
    months.forEach((m, i) => {
      ;[57, 58, 59].forEach((r, k) => {
        expect(out.pools[poolIds[k]].months[m].balance).toBe(minor(sheet(r, i)))
      })
    })
  })

  it('savings balance equals the sheet savings plus the pools it now holds', () => {
    months.forEach((m, i) => {
      const sheetSavings = minor(sheet(3, i))
      const sheetPools = minor(sheet(57, i)) + minor(sheet(58, i)) + minor(sheet(59, i))
      expect(Math.abs(out.accounts[savingsId].months[m].balance - (sheetSavings + sheetPools))).toBeLessThanOrEqual(2)
    })
  })

  it('matches the share-of-income column for rent and the travel pool', () => {
    for (const r of [28, 43]) {
      const rowId = rowIdBySheetRow.get(r)!
      expect(out.rowTotals[rowId].shareOfIncome).toBeCloseTo(Math.abs(num(rows.get(r)?.a)), 6)
    }
  })
})
