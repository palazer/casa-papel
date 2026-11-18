import { describe, expect, it } from 'vitest'
import { cellKey, computeEngine } from '@/engine'
import { monthRange, newId } from '@/model'
import {
  CasaDb, Store, addRow, archiveRow, clearCell, itemsFromCurrent, keepHouse, loadTables, moveRow, quickCreateHousehold,
  renameRow, setCellItems, setCellValue, setItemStatus,
} from '@/store'
import { legacyClose } from '../legacyClose'

const months = monthRange('2026-01', '2026-04')

async function fresh() {
  const store = new Store(new CasaDb(`test-${newId()}`))
  await quickCreateHousehold(store, { name: 'Test', baseCurrency: 'EUR', locale: 'en-IE', startMonth: '2026-01' })
  const tables = await loadTables(store)
  const rent = tables.rows.find((r) => r.name === 'Rent')!
  const salary = tables.rows.find((r) => r.name === 'Salary')!
  return { store, rent, salary }
}

async function values(store: Store, rowId: string) {
  const out = computeEngine({ tables: await loadTables(store), months })
  return months.map((m) => out.cells[cellKey(rowId, m)].value)
}

describe('actions: cells', () => {
  it('quick create gives a household, a savings account and starter rows', async () => {
    const { store } = await fresh()
    const t = await loadTables(store)
    expect(t.household).toHaveLength(1)
    expect(t.accounts[0]).toMatchObject({ type: 'savings', tracked: true })
    expect(t.rows.map((r) => r.name)).toContain('To savings')
  })

  it('from-now-on lets later months follow; this-month stays in its month, and writes nothing into the next', async () => {
    const { store, rent } = await fresh()
    await setCellValue(store, rent.id, '2026-01', 150000, 'from-now-on')
    expect(await values(store, rent.id)).toEqual([150000, 150000, 150000, 150000])

    await setCellValue(store, rent.id, '2026-02', 99000, 'this-month')
    expect(await values(store, rent.id)).toEqual([150000, 99000, 150000, 150000])
    expect((await loadTables(store)).cells.filter((c) => c.rowId === rent.id).map((c) => [c.month, c.value, c.once])).toEqual([['2026-01', 150000, false], ['2026-02', 99000, true]])

    await setCellValue(store, rent.id, '2026-03', 160000, 'from-now-on')
    expect(await values(store, rent.id)).toEqual([150000, 99000, 160000, 160000])

    // one undo step each
    await store.undo()
    await store.undo()
    expect(await values(store, rent.id)).toEqual([150000, 150000, 150000, 150000])
  })

  it('this-month on a row that never had an amount leaves the months after it without one', async () => {
    const { store, rent } = await fresh()
    await setCellValue(store, rent.id, '2026-02', 99000, 'this-month')
    expect(await values(store, rent.id)).toEqual([0, 99000, 0, 0])
    // and as a single item with its own certainty, the same
    const { store: other, rent: again } = await fresh()
    await setCellItems(other, again.id, '2026-02', [{ id: newId(), label: '', amount: 5000, status: 'projected', fundedBy: 'cash', date: null, note: null, recurringItemId: null, kind: 'normal', skipped: false }], 'this-month')
    expect(await values(other, again.id)).toEqual([0, 5000, 0, 0])
  })

  it('clear goes back to inheriting', async () => {
    const { store, rent } = await fresh()
    await setCellValue(store, rent.id, '2026-01', 100000, 'from-now-on')
    await setCellValue(store, rent.id, '2026-03', 120000, 'from-now-on')
    await clearCell(store, rent.id, '2026-03')
    expect(await values(store, rent.id)).toEqual([100000, 100000, 100000, 100000])
  })

  it('items: convert from inherit keeps a carry item, statuses update', async () => {
    const { store, rent } = await fresh()
    await setCellValue(store, rent.id, '2026-01', 100000, 'from-now-on')
    const out = computeEngine({ tables: await loadTables(store), months })
    const items = itemsFromCurrent(out.cells[cellKey(rent.id, '2026-02')], 'cash', 'projected')
    expect(items[0].kind).toBe('carry')
    items.push({ id: newId(), label: 'Repair', amount: 2500, status: 'projected', fundedBy: 'cash', date: null, note: null, recurringItemId: null, kind: 'normal', skipped: false })
    await setCellItems(store, rent.id, '2026-02', items)
    expect(await values(store, rent.id)).toEqual([100000, 102500, 102500, 102500])

    await setItemStatus(store, rent.id, '2026-02', items[1].id, 'done')
    const after = computeEngine({ tables: await loadTables(store), months })
    expect(after.cells[cellKey(rent.id, '2026-02')].items[1].status).toBe('done')
  })
})

describe('actions: rows', () => {
  it('adds after a row, moves, renames and archives', async () => {
    const { store, rent } = await fresh()
    const util = await addRow(store, { name: 'Utilities', section: 'expense' }, rent.id)
    let out = computeEngine({ tables: await loadTables(store), months })
    let names = out.rows.filter((r) => r.section === 'expense').map((r) => r.name)
    expect(names).toEqual(['Rent', 'Utilities', 'Groceries', 'Other'])

    await moveRow(store, util.id, 'down')
    out = computeEngine({ tables: await loadTables(store), months })
    names = out.rows.filter((r) => r.section === 'expense').map((r) => r.name)
    expect(names).toEqual(['Rent', 'Groceries', 'Utilities', 'Other'])

    await moveRow(store, util.id, 'up')
    await moveRow(store, util.id, 'up')
    out = computeEngine({ tables: await loadTables(store), months })
    names = out.rows.filter((r) => r.section === 'expense').map((r) => r.name)
    expect(names).toEqual(['Utilities', 'Rent', 'Groceries', 'Other'])

    await renameRow(store, util.id, 'Energy')
    await archiveRow(store, util.id, '2026-03')
    out = computeEngine({ tables: await loadTables(store), months })
    expect(out.rows.find((r) => r.id === util.id)?.name).toBe('Energy')
    expect(out.cells[cellKey(util.id, '2026-03')].source).toBe('archived')
  })
})

describe('actions: a month an older version had closed', () => {
  it('is opened by the app\'s own pass: every line ticked, every amount kept, and it takes changes again', async () => {
    const { store, rent, salary } = await fresh()
    await setCellValue(store, salary.id, '2026-01', 300000, 'from-now-on')
    await setCellValue(store, rent.id, '2026-01', 100000, 'from-now-on')
    await setCellItems(store, rent.id, '2026-02', [
      { id: newId(), label: 'Rent', amount: 100000, status: 'committed', fundedBy: 'cash', date: null, note: null, recurringItemId: null, kind: 'normal', skipped: false },
    ])
    await legacyClose(store, '2026-02')
    const closed = await loadTables(store)
    expect(closed.monthStates.find((s) => s.month === '2026-02')).toMatchObject({ closed: true, pocketTotalOverride: 0, cashBufferOverride: 0 })
    const before = [await values(store, salary.id), await values(store, rent.id)]

    expect(await keepHouse(store, '2026-04')).toBeGreaterThan(0)
    const t = await loadTables(store)
    // the mark is gone, what the month kept for itself stays
    expect(t.monthStates.find((s) => s.month === '2026-02')).toMatchObject({ closed: false, closedAt: null, pocketTotalOverride: 0, cashBufferOverride: 0 })
    const out = computeEngine({ tables: t, months })
    for (const row of out.rows) {
      const c = out.cells[cellKey(row.id, '2026-02')]
      if (c.source !== 'empty' && c.value !== 0) expect(c.status, row.name).toBe('done')
    }
    expect([await values(store, salary.id), await values(store, rent.id)]).toEqual(before)
    // the month after carries on, and is not ticked with it
    expect(out.cells[cellKey(salary.id, '2026-03')]).toMatchObject({ source: 'inherit', value: 300000 })
    expect(out.cells[cellKey(salary.id, '2026-03')].status).not.toBe('done')
    // a second pass has nothing left to do
    expect(await keepHouse(store, '2026-04')).toBe(0)

    // nothing is locked
    await setCellValue(store, rent.id, '2026-02', 1, 'from-now-on')
    expect((await values(store, rent.id))[1]).toBe(1)
  })
})
