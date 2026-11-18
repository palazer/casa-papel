import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cellKey, computeEngine } from '@/engine'
import { CellSchema, newId } from '@/model'
import {
  CasaDb, Store, defaultMonths, exportSnapshot, followRow, importMerge, importReplace, itemsFromCurrent, keepHouse, loadTables, planHousekeeping,
  saveRowMonth, setCategoryEstimate, setCellValue,
} from '@/store'
import { DEMO_IDS } from '@/demo/demoHousehold'
import { loadDemo } from '@/demo/loadDemo'
import { monthProgress } from '@/features/statement/progress'
import { legacyClose } from '../legacyClose'
import { diffFigures, figuresOf } from '../scenarios/figures'
import { restoreToday, setToday } from '../today'

const TODAY = '2026-11'
/** When the older app closed the month: before anything this suite does. */
const CLOSED_AT = Date.UTC(2026, 10, 1)

const read = async (store: Store) => {
  const tables = await loadTables(store)
  const out = computeEngine({ tables, months: defaultMonths(tables.household[0], tables, TODAY) })
  return { tables, out, figures: figuresOf(tables, out), progress: (m: string) => monthProgress(out.rows, out.cells, m) }
}

/**
 * The demo household with the two kinds of line it lacks (what is left of a category's estimate, and a row that
 * follows another), so that October holds every kind: typed, carried, itemized, worked out by a rule, the rest,
 * a follower and an estimate's rest.
 */
async function demo() {
  const store = new Store(new CasaDb(`test-${newId()}`))
  await loadDemo(store)
  await setCategoryEstimate(store, DEMO_IDS.catHousing, '2026-10', 2500_00, 'this-month')
  await followRow(store, DEMO_IDS.rowHealth, DEMO_IDS.rowGroceries, 0.1)
  return store
}

describe('a month that an older version of the app had closed', () => {
  beforeEach(() => setToday('2026-11-15'))
  afterEach(restoreToday)

  it('becomes a month with every line ticked: no figure changes, nothing stays closed, and it happens once', async () => {
    const store = await demo()
    await legacyClose(store, '2026-10', CLOSED_AT)
    const before = await read(store)
    expect(before.tables.monthStates.find((s) => s.month === '2026-10')).toMatchObject({ closed: true, closedAt: CLOSED_AT })
    const kinds = new Set(before.out.rows.map((r) => before.out.cells[cellKey(r.id, '2026-10')]?.source))
    for (const kind of ['value', 'items', 'derived']) expect(kinds, kind).toContain(kind)
    // the mark is not read any more: what the month only read as done (a rule's amount, the rest) is open until the pass has run
    const open = before.progress('2026-10')
    expect(open.done).toBeLessThan(open.total)

    expect(await keepHouse(store)).toBeGreaterThan(0)
    const after = await read(store)
    expect(after.tables.monthStates.filter((s) => s.closed)).toEqual([])
    expect(after.progress('2026-10')).toMatchObject({ done: open.total, total: open.total, toPay: 0, toComeIn: 0 })
    expect(diffFigures(before.figures, after.figures)).toEqual([])
    // what the month kept for itself stays, and the months around it are as they were
    expect(after.tables.monthStates.find((s) => s.month === '2026-10')?.cashBufferOverride).toBe(before.tables.monthStates.find((s) => s.month === '2026-10')?.cashBufferOverride)
    expect(after.progress('2026-11')).toEqual(before.progress('2026-11'))
    expect(after.progress('2026-09')).toEqual(before.progress('2026-09'))

    // a second pass has nothing left to write
    expect(planHousekeeping(after.tables)).toEqual([])
    expect(await keepHouse(store)).toBe(0)
    // it was the app's own step: "Undo" takes back the last thing the user did (the row that follows), and the month stays open
    expect(await store.undo()).toBe(true)
    const undone = await read(store)
    expect(undone.tables.monthStates.filter((s) => s.closed)).toEqual([])
    expect(undone.tables.rows.find((r) => r.id === DEMO_IDS.rowHealth)?.followsRowId ?? null).toBeNull()
  })

  it('keeps one typed figure on a row with a schedule, for good', async () => {
    const store = await demo()
    // September as the older app held it: "Subscriptions" typed as 42.00, and nothing of "Streaming" (18.00 a month) in the month
    const typed = (await loadTables(store)).cells.find((c) => c.rowId === DEMO_IDS.rowSubscriptions && c.month === '2026-09')!
    await store.commitSystem([{ op: 'put', table: 'cells', record: CellSchema.parse({ ...typed, mode: 'value', value: 42_00, items: [] }) }])
    await legacyClose(store, '2026-09', CLOSED_AT)
    const september = async () => (await read(store)).out.cells[cellKey(DEMO_IDS.rowSubscriptions, '2026-09')]
    expect((await september()).value).toBe(42_00)

    await keepHouse(store)
    expect(await september()).toMatchObject({ value: 42_00, status: 'done' })
    // the schedule is noted as left out of the month, so nothing that looks at the row later finds it missing
    const stored = (await loadTables(store)).cells.find((c) => c.rowId === DEMO_IDS.rowSubscriptions && c.month === '2026-09')!
    expect(stored.items.filter((i) => i.recurringItemId === DEMO_IDS.recStreaming).map((i) => i.skipped)).toEqual([true])
    expect(stored.items.filter((i) => !i.skipped).map((i) => [i.amount, i.status])).toEqual([[42_00, 'done']])

    // the row's own dialog, saved in that month, lands the row's schedules from that month on: September takes the new figure and no more
    const { tables, out } = await read(store)
    const row = tables.rows.find((r) => r.id === DEMO_IDS.rowSubscriptions)!
    const items = itemsFromCurrent(out.cells[cellKey(row.id, '2026-09')], row.defaultFundedBy, row.defaultStatus)
    await saveRowMonth(store, row.id, '2026-09', { items: items.map((i) => (i.skipped ? i : { ...i, amount: 45_00 })), scope: 'this-month' })
    expect((await september()).value).toBe(45_00)
    // and so does the app's own pass, when the calendar has moved on
    for (const day of ['2027-01-15', '2027-03-15']) {
      setToday(day)
      await keepHouse(store)
      expect((await september()).value, day).toBe(45_00)
    }
    // October, which was never closed, kept the schedule's own 18.00 through all of it
    expect((await read(store)).out.cells[cellKey(DEMO_IDS.rowSubscriptions, '2026-10')].value).toBe(18_00)
  })

  it('a correction made on one device survives the other device opening the month later', async () => {
    const a = await demo()
    await legacyClose(a, '2026-10', CLOSED_AT)
    const b = new Store(new CasaDb(`test-${newId()}`))
    await importReplace(b, await exportSnapshot(a))

    // the first device is updated, and the next day the month is corrected there
    await keepHouse(a)
    setToday('2026-11-16')
    await setCellValue(a, DEMO_IDS.rowGroceries, '2026-10', 777_00, 'this-month')
    // the second device is updated later and opens the month by itself, before it has heard of the correction
    setToday('2026-11-20')
    expect(await keepHouse(b)).toBeGreaterThan(0)
    expect((await read(b)).out.cells[cellKey(DEMO_IDS.rowGroceries, '2026-10')].value).toBe(700_00)

    // then they sync, both ways
    await importMerge(b, await exportSnapshot(a))
    await importMerge(a, await exportSnapshot(b))
    const [onA, onB] = [await read(a), await read(b)]
    for (const device of [onA, onB]) {
      expect(device.out.cells[cellKey(DEMO_IDS.rowGroceries, '2026-10')].value).toBe(777_00)
      expect(device.tables.monthStates.filter((s) => s.closed)).toEqual([])
    }
    expect(diffFigures(onA.figures, onB.figures)).toEqual([])
    // and neither has anything left to do
    expect(await keepHouse(a)).toBe(0)
    expect(await keepHouse(b)).toBe(0)
  })
})
