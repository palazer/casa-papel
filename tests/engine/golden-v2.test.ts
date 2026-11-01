import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { buildFxIndex, computeEngine, rateFor } from '@/engine'
import { byRow, minor, num, type RawFixture } from './fixtures/rawFixture'
import { v2ToTables } from './fixtures/v2Adapter'

const fixture = JSON.parse(readFileSync(new URL('./golden/v2-raw.json', import.meta.url), 'utf8')) as RawFixture
const rows = byRow(fixture.sheets.Flow)
const sheet = (r: number, i: number) => num(rows.get(r)?.cells[i])

describe('golden: v2 template workbook', () => {
  const { tables, months, rowIdBySheetRow, savingsId, investmentsId, loansId, companyDebtId, cardId, poolIds } = v2ToTables(fixture)
  const out = computeEngine({ tables, months })
  const household = tables.household[0]

  it('has no warnings and covers every month', () => {
    expect(out.warnings).toEqual([])
    expect(out.months).toEqual(months)
  })

  it('projects the USD/TRY chain (row 55) from one known rate with the sheet\'s monthly drift', () => {
    const fx = buildFxIndex(tables.fxRates, { driftMode: 'fixed', fixedDrift: household.fxDriftDefault })
    months.forEach((m, i) => {
      expect(rateFor(fx, 'USD', 'TRY', m)!).toBeCloseTo(sheet(55, i), 6)
    })
    expect(rateFor(fx, 'USD', 'TRY', months[months.length - 1])!).toBeCloseTo(60.393, 3)
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

  it('reproduces the investment projection (row 4): grow at 3% a year, then add the deposit', () => {
    const series = out.accounts[investmentsId]
    months.forEach((m, i) => {
      // the sheet keeps float cents; the app rounds every month, so allow a cent per month
      expect(Math.abs(series.months[m].balance - minor(sheet(4, i)))).toBeLessThanOrEqual(i + 1)
      expect(series.months[m].projected).toBe(true)
    })
    expect(series.months[months[0]].inflow).toBe(2000000)
    expect(series.months[months[0]].capital).toBe(minor(num(rows.get(4)?.b)) + 2000000)
  })

  it('loans (row 9) and company debt (row 10) come down with their payments', () => {
    months.forEach((m, i) => {
      expect(out.accounts[loansId].months[m].balance).toBe(minor(sheet(9, i)))
      expect(out.accounts[companyDebtId].months[m].balance).toBe(minor(sheet(10, i)))
    })
  })

  it('card: the real remaining debt pins the month and the gap is the implied spend (rows 6–8)', () => {
    const s = out.accounts[cardId]
    expect(s.liability).toBe(true)
    expect(s.months[months[0]]).toMatchObject({ outflow: minor(sheet(6, 0)), balance: minor(sheet(7, 0)), adjustment: minor(sheet(8, 0)), projected: false })
    expect(s.months[months[3]].balance).toBe(minor(sheet(7, 0)))
    // the card payment is not part of the plug (the sheet keeps it outside the expense range too); the vehicle loan instalment (row 36) is
    expect(out.totals[months[0]].debt).toBe(minor(sheet(36, 0)))
  })

  it('net worth (row 11) under app semantics: the sheet ignores the card and keeps pools outside savings', () => {
    months.forEach((m, i) => {
      const sheetPools = minor(sheet(57, i)) + minor(sheet(58, i)) + minor(sheet(59, i))
      const expected = minor(sheet(11, i)) + sheetPools - out.accounts[cardId].months[m].balance
      expect(Math.abs(out.netWorth[m] - expected)).toBeLessThanOrEqual(i + 4)
    })
  })

  it('matches the share-of-income column for rent and the travel pool', () => {
    for (const r of [28, 43]) {
      const rowId = rowIdBySheetRow.get(r)!
      expect(out.rowTotals[rowId].shareOfIncome).toBeCloseTo(Math.abs(num(rows.get(r)?.a)), 6)
    }
  })
})
