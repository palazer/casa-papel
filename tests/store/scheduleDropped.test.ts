import { describe, expect, it } from 'vitest'
import { cellKey, computeEngine } from '@/engine'
import { monthRange, newId, type CellItem } from '@/model'
import {
  CasaDb, Store, addRecurringItem, deleteRecurringItem, endRecurringItem, engineUpTo, itemsFromCurrent, loadTables, planFollowing, postRecurring, quickCreateHousehold, removeRecurringItem,
  saveRowMonth, setCellValue, setRecurringPaid,
} from '@/store'

/**
 * A row on a schedule never carries an amount forward: every month is its own. When its last schedule is deleted the
 * row is an ordinary row again, and what its months hold must not start running on (finding F11): each keeps what it
 * holds as that month's alone, so the row goes on showing what it showed, less what the deletion takes away.
 */
const months = monthRange('2026-01', '2026-08')
const item = (amount: number, over: Partial<CellItem> = {}): CellItem =>
  ({ id: newId(), label: '', amount, status: 'committed', fundedBy: 'cash', date: null, note: null, recurringItemId: null, kind: 'normal', skipped: false, ...over })

async function fresh() {
  const store = new Store(new CasaDb(`test-${newId()}`))
  await quickCreateHousehold(store, { name: 'Test', baseCurrency: 'EUR', locale: 'en-IE', startMonth: '2026-01' })
  const t = await loadTables(store)
  return { store, rent: t.rows.find((r) => r.name === 'Rent')!, other: t.rows.find((r) => r.name === 'Other')! }
}
const values = async (store: Store, rowId: string): Promise<number[]> => {
  const out = computeEngine({ tables: await loadTables(store), months })
  return months.map((m) => out.cells[cellKey(rowId, m)].value / 100)
}
const storedOf = async (store: Store, rowId: string): Promise<string[]> =>
  (await loadTables(store)).cells.filter((c) => c.rowId === rowId && months.includes(c.month)).sort((a, b) => (a.month < b.month ? -1 : 1))
    .map((c) => `${c.month.slice(5)} ${c.mode === 'value' ? (c.value ?? 0) / 100 : c.mode === 'items' ? `[${c.items.map((i) => (i.kind === 'carry' ? 'carry' : i.amount / 100)).join(' ')}]` : 'inherit'}${c.once ? '!' : ''}`)
const yearly = (month: number) => ({ intervalMonths: 12 as const, anchorMonth: month })
const monthly = { intervalMonths: 1 as const, anchorMonth: 1 }

describe('a row whose last schedule is deleted', () => {
  it('keeps what was paid in its month, and nothing runs on from it', async () => {
    const { store, other } = await fresh()
    const insurance = await addRecurringItem(store, { name: 'Insurance', rowId: other.id, amount: 600_00, startMonth: '2026-02', cadence: yearly(2) })
    await postRecurring(store, months)
    await setRecurringPaid(store, insurance.id, '2026-02', true)
    expect(await values(store, other.id)).toEqual([0, 600, 0, 0, 0, 0, 0, 0])

    await removeRecurringItem(store, insurance.id)
    expect(await storedOf(store, other.id)).toEqual(['02 [600]!'])
    expect(await values(store, other.id)).toEqual([0, 600, 0, 0, 0, 0, 0, 0])
    const out = computeEngine({ tables: await loadTables(store), months })
    expect(months.map((m) => out.cells[cellKey(other.id, m)].source)).toEqual(['empty', 'items', 'empty', 'empty', 'empty', 'empty', 'empty', 'empty'])
    // one step, one undo
    await store.undo()
    expect(await storedOf(store, other.id)).toEqual(['02 [600]'])
    expect((await loadTables(store)).recurringItems.find((r) => r.id === insurance.id)?.deletedAt ?? null).toBeNull()
  })

  it('an item typed beside the schedule stays in its month too', async () => {
    const { store, other } = await fresh()
    const liability = await addRecurringItem(store, { name: 'Liability', rowId: other.id, amount: 90_00, startMonth: '2026-03', cadence: yearly(3) })
    await postRecurring(store, months)
    const march = (await loadTables(store)).cells.find((c) => c.rowId === other.id && c.month === '2026-03')!
    await saveRowMonth(store, other.id, '2026-03', { items: [...march.items, item(15_00, { label: 'Late fee' })], scope: 'this-month' })
    expect(await values(store, other.id)).toEqual([0, 0, 105, 0, 0, 0, 0, 0])
    await deleteRecurringItem(store, liability.id)
    // the unpaid posting goes; the late fee is March's, and April does not inherit it
    expect(await storedOf(store, other.id)).toEqual(['03 [15]!'])
    expect(await values(store, other.id)).toEqual([0, 0, 15, 0, 0, 0, 0, 0])
  })

  it('a row with amounts from before its first schedule shows every month as it did, a carried item included', async () => {
    const { store, rent } = await fresh()
    await setCellValue(store, rent.id, '2026-01', 1200_00, 'from-now-on')
    // March: what it carries plus 80.00, from March on
    const before = computeEngine({ tables: await loadTables(store), months })
    await saveRowMonth(store, rent.id, '2026-03', { items: [...itemsFromCurrent(before.cells[cellKey(rent.id, '2026-03')], 'cash', 'committed'), item(80_00, { label: 'Parking' })], scope: 'from-now-on' })
    expect(await values(store, rent.id)).toEqual([1200, 1200, 1280, 1280, 1280, 1280, 1280, 1280])
    // on a schedule from May: the months before keep what they carried
    const schedule = await addRecurringItem(store, { name: 'Rent', rowId: rent.id, amount: 1300_00, startMonth: '2026-05', cadence: monthly })
    await postRecurring(store, months)
    await setRecurringPaid(store, schedule.id, '2026-05', true)
    expect(await values(store, rent.id)).toEqual([1200, 1200, 1280, 1280, 1300, 1300, 1300, 1300])

    await deleteRecurringItem(store, schedule.id)
    // May was paid and stays; from June the postings are gone; the months before show what they showed
    expect(await values(store, rent.id)).toEqual([1200, 1200, 1280, 1280, 1300, 0, 0, 0])
    // (the pass over a row on a schedule had turned its single amounts into lists of one)
    expect((await storedOf(store, rent.id)).slice(0, 5)).toEqual(['01 [1200]!', '02 [1200]!', '03 [1200 80]!', '04 [1280]!', '05 [1300]!'])
  })

  it('is an ordinary row afterwards: an amount for this and following months counts from its month on', async () => {
    const { store, rent } = await fresh()
    const schedule = await addRecurringItem(store, { name: 'Rent', rowId: rent.id, amount: 1300_00, startMonth: '2026-02', cadence: monthly })
    await postRecurring(store, months)
    await setRecurringPaid(store, schedule.id, '2026-02', true)
    await deleteRecurringItem(store, schedule.id)
    expect(await values(store, rent.id)).toEqual([0, 1300, 0, 0, 0, 0, 0, 0])
    // the months the schedule had posted to hold empty lists: nothing of anybody's, so the dialog names none of them
    const { tables, engine } = await engineUpTo(store, '2026-04')
    expect(planFollowing(tables, engine, rent.id, '2026-04', 1250_00, 0)).toMatchObject({ replaced: [], kept: [] })
    await setCellValue(store, rent.id, '2026-04', 1250_00, 'from-now-on')
    expect(await values(store, rent.id)).toEqual([0, 1300, 0, 1250, 1250, 1250, 1250, 1250])
  })
})

describe('a row that stays on a schedule', () => {
  it('one of two schedules deleted: nothing is marked, and the row still carries nothing', async () => {
    const { store, other } = await fresh()
    const a = await addRecurringItem(store, { name: 'Insurance', rowId: other.id, amount: 600_00, startMonth: '2026-02', cadence: yearly(2) })
    const b = await addRecurringItem(store, { name: 'Club', rowId: other.id, amount: 40_00, startMonth: '2026-04', cadence: yearly(4) })
    await postRecurring(store, months)
    await setRecurringPaid(store, a.id, '2026-02', true)
    await setRecurringPaid(store, b.id, '2026-04', true)
    await deleteRecurringItem(store, a.id)
    expect(await storedOf(store, other.id)).toEqual(['02 [600]', '04 [40]'])
    expect(await values(store, other.id)).toEqual([0, 600, 0, 40, 0, 0, 0, 0])
    // the second one goes too: now every month the row holds is that month's alone, also what the first one left
    await deleteRecurringItem(store, b.id)
    expect(await storedOf(store, other.id)).toEqual(['02 [600]!', '04 [40]!'])
    expect(await values(store, other.id)).toEqual([0, 600, 0, 40, 0, 0, 0, 0])
  })

  it('a schedule that is ended, not deleted, stays on its row: nothing to mark', async () => {
    const { store, other } = await fresh()
    const a = await addRecurringItem(store, { name: 'Club', rowId: other.id, amount: 40_00, startMonth: '2026-02', cadence: monthly })
    await postRecurring(store, months)
    await setRecurringPaid(store, a.id, '2026-02', true)
    await endRecurringItem(store, a.id, '2026-03')
    expect((await values(store, other.id)).slice(0, 5)).toEqual([0, 40, 40, 0, 0])
    expect((await loadTables(store)).cells.filter((c) => c.rowId === other.id).every((c) => !c.once)).toBe(true)
  })
})
