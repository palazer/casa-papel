import { describe, expect, it } from 'vitest'
import { cellKey, computeEngine } from '@/engine'
import { monthRange, newId } from '@/model'
import {
  CasaDb, Store, countDoneMutations, followRow, loadTables, postRecurring, quickCreateHousehold, setCategoryEstimate, setCellDone, setCellValue, setMonthBalances,
} from '@/store'
import { DEMO_IDS } from '@/demo/demoHousehold'
import { loadDemo } from '@/demo/loadDemo'
import { monthProgress } from '@/features/statement/progress'
import { diffFigures, figuresOf } from '../scenarios/figures'

const MONTHS = monthRange('2026-09', '2026-12')

/**
 * The demo household with its schedules landed, as the running app has it, and with the two kinds of line it lacks:
 * a category estimate ("Not broken down yet") and a row that follows another.
 */
async function demo() {
  const store = new Store(new CasaDb(`test-${newId()}`))
  await loadDemo(store)
  await postRecurring(store, MONTHS)
  await setCategoryEstimate(store, DEMO_IDS.catHousing, '2026-10', 2500_00, 'this-month')
  await followRow(store, DEMO_IDS.rowHealth, DEMO_IDS.rowGroceries, 0.1)
  const read = async () => {
    const tables = await loadTables(store)
    const out = computeEngine({ tables, months: MONTHS })
    return { tables, out, figures: figuresOf(tables, out), progress: (m: string) => monthProgress(out.rows, out.cells, m) }
  }
  return { store, read }
}

describe('"Count everything in <Month> as done"', () => {
  it('ticks every line of the month, whatever kind it is, and changes no figure', async () => {
    const { store, read } = await demo()
    const before = await read()
    const open = before.progress('2026-10')
    expect(open.total).toBeGreaterThan(10)
    expect(open.done).toBeLessThan(open.total)
    // the month holds every kind of line: typed, carried, itemized, worked out by a rule, following, and an estimate's rest
    const sources = new Set(before.out.rows.map((r) => before.out.cells[cellKey(r.id, '2026-10')]?.source))
    for (const kind of ['value', 'inherit', 'items', 'derived']) expect(sources, kind).toContain(kind)

    await setMonthBalances(store, '2026-10', {}, { done: true })
    const after = await read()
    expect(after.progress('2026-10')).toMatchObject({ done: open.total, total: open.total, toPay: 0, toComeIn: 0 })
    expect(diffFigures(before.figures, after.figures)).toEqual([])
    // the months around it are as they were: the tick is for October alone
    expect(after.progress('2026-11')).toEqual(before.progress('2026-11'))
    expect(after.progress('2026-09')).toEqual(before.progress('2026-09'))

    // a second time there is nothing left to write
    const version = store.getVersion()
    await setMonthBalances(store, '2026-10', {}, { done: true })
    expect(store.getVersion()).toBe(version)

    // one undo takes every tick back
    await store.undo()
    const undone = await read()
    expect(undone.progress('2026-10')).toEqual(open)
    expect(diffFigures(before.figures, undone.figures)).toEqual([])
  })

  it('saves the typed balances and the ticks as one step', async () => {
    const { store, read } = await demo()
    const before = await read()
    await setMonthBalances(store, '2026-10', { ends: { [DEMO_IDS.savings]: 9000_00 } }, { done: true })
    const after = await read()
    expect(after.out.accounts[DEMO_IDS.savings].months['2026-10'].balance).toBe(9000_00)
    const p = after.progress('2026-10')
    expect(p.done).toBe(p.total)
    await store.undo()
    const undone = await read()
    expect(diffFigures(before.figures, undone.figures)).toEqual([])
    expect(undone.progress('2026-10')).toEqual(before.progress('2026-10'))
  })

  it('a carried amount that is ticked still carries, and the next month is not ticked with it', async () => {
    const store = new Store(new CasaDb(`test-${newId()}`))
    await quickCreateHousehold(store, { name: 'T', baseCurrency: 'EUR', locale: 'en-IE', startMonth: '2026-01' })
    const salary = (await loadTables(store)).rows.find((r) => r.name === 'Salary')!
    await setCellValue(store, salary.id, '2026-01', 3000_00, 'from-now-on')
    const months = monthRange('2026-01', '2026-04')
    const cell = async (m: string) => computeEngine({ tables: await loadTables(store), months }).cells[cellKey(salary.id, m)]
    expect(await cell('2026-02')).toMatchObject({ source: 'inherit', value: 3000_00 })

    await setMonthBalances(store, '2026-02', {}, { done: true })
    expect(await cell('2026-02')).toMatchObject({ value: 3000_00, status: 'done' })
    expect(await cell('2026-03')).toMatchObject({ source: 'inherit', value: 3000_00 })
    expect((await cell('2026-03')).status).not.toBe('done')
    expect((await cell('2026-01')).status).not.toBe('done')
  })

  it('writes nothing for a line that is ticked already', async () => {
    const { store, read } = await demo()
    await setCellDone(store, DEMO_IDS.rowGroceries, '2026-10', true)
    const { tables, out } = await read()
    const touched = countDoneMutations(tables, out, '2026-10', 1).map((m) => (m.op === 'put' && m.table === 'cells' ? m.record.rowId : ''))
    expect(touched).not.toContain(DEMO_IDS.rowGroceries)
    expect(touched).not.toContain(DEMO_IDS.rowTravel) // "Weekend in Lisbon" was done from the start
    // and a tick that is there already is no step of its own
    const version = store.getVersion()
    await setCellDone(store, DEMO_IDS.rowGroceries, '2026-10', true)
    expect(store.getVersion()).toBe(version)
  })
})
