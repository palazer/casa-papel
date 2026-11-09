import { describe, expect, it } from 'vitest'
import { cellKey, computeEngine } from '@/engine'
import { CellSchema } from '@/model'
import { T0, cellValue, closedMonth, household, row, tables } from './helpers'

const months = ['2026-01', '2026-02', '2026-03']

describe('engine: automatic rows and markedDone', () => {
  it('an automatic amount is done once the month is closed or once it was ticked as moved', () => {
    const h = household()
    const salary = row({ name: 'Salary', section: 'income', defaultStatus: 'committed' })
    const toSav = row({ name: 'To savings', section: 'transfer', kind: 'to-savings' })
    const ticked = CellSchema.parse({ rowId: toSav.id, month: '2026-02', mode: 'inherit', markedDone: true, updatedAt: T0 })
    const out = computeEngine({
      tables: tables({ household: [h], rows: [salary, toSav], cells: [cellValue(salary.id, '2026-01', 300000), ticked], monthStates: [closedMonth('2026-01')] }),
      months,
    })
    expect(out.cells[cellKey(toSav.id, '2026-01')]).toMatchObject({ source: 'derived', status: 'done', value: 300000 })
    expect(out.cells[cellKey(toSav.id, '2026-02')]).toMatchObject({ source: 'derived', status: 'done', value: 300000 })
    expect(out.cells[cellKey(toSav.id, '2026-03')]).toMatchObject({ source: 'derived', status: 'derived', value: 300000 })
    expect(months.map((m) => out.totals[m].toSavings)).toEqual([300000, 300000, 300000])
  })

  it('a pocket share ticked as moved is done without changing its amount', () => {
    const h = household({ pocketTotal: 100000 })
    const salary = row({ name: 'Salary', section: 'income', defaultStatus: 'committed' })
    const pocket = row({ name: 'Sam – Pocket', section: 'transfer', kind: 'pocket-money', pocketMode: 'share-of-pocket-total', pocketShare: 0.5 })
    const ticked = CellSchema.parse({ rowId: pocket.id, month: '2026-01', mode: 'inherit', markedDone: true, updatedAt: T0 })
    const out = computeEngine({ tables: tables({ household: [h], rows: [salary, pocket], cells: [cellValue(salary.id, '2026-01', 300000), ticked] }), months })
    expect(out.cells[cellKey(pocket.id, '2026-01')]).toMatchObject({ source: 'derived', status: 'done', value: 50000 })
    expect(out.cells[cellKey(pocket.id, '2026-02')]).toMatchObject({ source: 'derived', status: 'derived', value: 50000 })
  })
})
