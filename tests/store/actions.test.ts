import { describe, expect, it } from 'vitest'
import { cellKey, computeEngine } from '@/engine'
import { monthRange, newId } from '@/model'
import {
  CasaDb, Store, addRow, archiveRow, clearCell, closeMonth, itemsFromCurrent, loadTables, moveRow, quickCreateHousehold,
  renameRow, reopenMonth, setCellItems, setCellValue, setItemStatus,
} from '@/store'

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

  it('from-now-on lets later months follow; this-month freezes the next month at the old value', async () => {
    const { store, rent } = await fresh()
    await setCellValue(store, rent.id, '2026-01', 150000, 'from-now-on')
    expect(await values(store, rent.id)).toEqual([150000, 150000, 150000, 150000])

    await setCellValue(store, rent.id, '2026-02', 99000, 'this-month')
    expect(await values(store, rent.id)).toEqual([150000, 99000, 150000, 150000])

    await setCellValue(store, rent.id, '2026-03', 160000, 'from-now-on')
    expect(await values(store, rent.id)).toEqual([150000, 99000, 160000, 160000])

    // one undo step reverts the whole this-month edit (both cells)
    await store.undo()
    await store.undo()
    expect(await values(store, rent.id)).toEqual([150000, 150000, 150000, 150000])
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

describe('actions: month close', () => {
  it('freezes inherited values, marks items done, pins settings, and refuses edits until reopened', async () => {
    const { store, rent, salary } = await fresh()
    await setCellValue(store, salary.id, '2026-01', 300000, 'from-now-on')
    await setCellValue(store, rent.id, '2026-01', 100000, 'from-now-on')
    await setCellItems(store, rent.id, '2026-02', [
      { id: newId(), label: 'Rent', amount: 100000, status: 'committed', fundedBy: 'cash', date: null, note: null, recurringItemId: null, kind: 'normal', skipped: false },
    ])
    await closeMonth(store, '2026-02')
    const t = await loadTables(store)
    expect(t.monthStates.find((s) => s.month === '2026-02')).toMatchObject({ closed: true, pocketTotalOverride: 0, cashBufferOverride: 0 })
    const salaryFeb = t.cells.find((c) => c.rowId === salary.id && c.month === '2026-02')
    expect(salaryFeb).toMatchObject({ mode: 'value', value: 300000 })
    const rentFeb = t.cells.find((c) => c.rowId === rent.id && c.month === '2026-02')!
    expect(rentFeb.items.every((i) => i.status === 'done')).toBe(true)

    const out = computeEngine({ tables: t, months })
    expect(out.cells[cellKey(salary.id, '2026-02')].status).toBe('done')
    expect(out.totals['2026-02'].closed).toBe(true)

    await expect(setCellValue(store, rent.id, '2026-02', 1, 'from-now-on')).rejects.toThrow(/closed/)
    await reopenMonth(store, '2026-02')
    await setCellValue(store, rent.id, '2026-02', 1, 'from-now-on')
    expect((await values(store, rent.id))[1]).toBe(1)

    // the whole close was one undoable step
    await store.undo() // the edit
    await store.undo() // reopen
    await store.undo() // close
    const t2 = await loadTables(store)
    expect(t2.monthStates.find((s) => s.month === '2026-02')).toBeUndefined()
    expect(t2.cells.find((c) => c.rowId === salary.id && c.month === '2026-02')).toBeUndefined()
  })
})
