import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cellKey, computeEngine } from '@/engine'
import { CellSchema, newId } from '@/model'
import {
  CasaDb, Store, archiveRow, defaultMonths, followRow, keepHouse, loadTables, planHousekeeping, removeRecurringItem, restoreRow, saveRowMonth, setCellDone,
  setCellValue, setDerivedDone, setRule,
} from '@/store'
import { DEMO_IDS } from '@/demo/demoHousehold'
import { loadDemo } from '@/demo/loadDemo'
import { diffFigures, figuresOf } from '../scenarios/figures'
import { restoreToday, setToday } from '../today'

const TODAY = '2026-11'

/**
 * The demo in November 2026, with its September as older data can hold it: on a row with a schedule, an amount that
 * was typed as one figure ("Subscriptions" 42.00, while "Streaming" is 18.00 a month), and nothing of the schedule
 * in the month, not even the note that it was left out. Landing the schedule there as well would make it 60.00.
 */
async function demo() {
  const store = new Store(new CasaDb(`test-${newId()}`))
  await loadDemo(store)
  const september = (await loadTables(store)).cells.find((c) => c.rowId === DEMO_IDS.rowSubscriptions && c.month === '2026-09')!
  await store.commitSystem([{ op: 'put', table: 'cells', record: CellSchema.parse({ ...september, mode: 'value', value: 42_00, items: [] }) }])
  const read = async () => {
    const tables = await loadTables(store)
    const out = computeEngine({ tables, months: defaultMonths(tables.household[0], tables, TODAY) })
    return { tables, out, figures: figuresOf(tables, out), subscriptions: (m: string) => out.cells[cellKey(DEMO_IDS.rowSubscriptions, m)].value }
  }
  return { store, read }
}

describe('a month that is over keeps what it holds', () => {
  beforeEach(() => setToday('2026-11-15'))
  afterEach(restoreToday)

  it('through the app\'s own pass, on the day and months later', async () => {
    const { store, read } = await demo()
    const before = await read()
    expect(before.subscriptions('2026-09')).toBe(42_00)
    expect(before.subscriptions('2026-10')).toBe(18_00)
    // the demo is at rest when it is loaded
    expect(planHousekeeping(before.tables)).toEqual([])
    expect(await keepHouse(store)).toBe(0)
    // and when the calendar moves on, the pass reaches no month that is over by then
    for (const day of ['2027-01-15', '2027-03-15']) {
      setToday(day)
      await keepHouse(store)
      const after = await read()
      expect(diffFigures(before.figures, after.figures, { before: TODAY }), day).toEqual([])
      expect(after.subscriptions('2026-09'), day).toBe(42_00)
    }
  })

  it('through a save of the same row in a later month', async () => {
    const { store, read } = await demo()
    const before = await read()
    const november = before.tables.cells.find((c) => c.rowId === DEMO_IDS.rowSubscriptions && c.month === TODAY)!
    const streaming = november.items.find((i) => i.recurringItemId === DEMO_IDS.recStreaming)!
    // November's own amount, changed for this month and the following ones
    await saveRowMonth(store, DEMO_IDS.rowSubscriptions, TODAY, { items: [{ ...streaming, amount: 21_00 }], applyTo: { [streaming.id]: 'from-now-on' }, scope: 'from-now-on' })
    const after = await read()
    expect(after.subscriptions(TODAY)).toBe(21_00)
    expect(after.subscriptions('2026-12')).toBe(21_00)
    expect(diffFigures(before.figures, after.figures, { before: TODAY })).toEqual([])
    expect(after.subscriptions('2026-09')).toBe(42_00)
    expect(after.subscriptions('2026-10')).toBe(18_00)
  })

  it('through the removal of its schedule, which takes only what that schedule posted and was not paid', async () => {
    const { store, read } = await demo()
    await removeRecurringItem(store, DEMO_IDS.recStreaming)
    const after = await read()
    // the typed 42.00 was never the schedule's; October's unpaid posting was
    expect(after.subscriptions('2026-09')).toBe(42_00)
    expect(after.subscriptions('2026-10')).toBe(0)
    expect(after.subscriptions(TODAY)).toBe(0)
    // no other row was looked at
    const rent = (m: string) => after.out.cells[cellKey(DEMO_IDS.rowRent, m)].value
    expect([rent('2026-09'), rent('2026-10'), rent(TODAY)]).toEqual([1650_00, 1650_00, 1650_00])
  })

  it('through an archive and a restore, of the row itself and of another one', async () => {
    const { store, read } = await demo()
    const before = await read()
    for (const rowId of [DEMO_IDS.rowSubscriptions, DEMO_IDS.rowRent]) {
      await archiveRow(store, rowId, TODAY)
      expect(diffFigures(before.figures, (await read()).figures, { before: TODAY }), 'archived').toEqual([])
      await restoreRow(store, rowId)
      const after = await read()
      expect(diffFigures(before.figures, after.figures), 'restored').toEqual([])
      expect(after.subscriptions('2026-09')).toBe(42_00)
    }
  })
})

describe('a tick stays where the amount under it changes hands', () => {
  beforeEach(() => setToday('2026-11-15'))
  afterEach(restoreToday)

  it('a row that followed another keeps its ticked months when that row is archived', async () => {
    const { store, read } = await demo()
    await followRow(store, DEMO_IDS.rowHealth, DEMO_IDS.rowGroceries, 0.1)
    await setDerivedDone(store, DEMO_IDS.rowHealth, '2026-10', true)
    const health = async (m: string) => (await read()).out.cells[cellKey(DEMO_IDS.rowHealth, m)]
    expect(await health('2026-10')).toMatchObject({ source: 'derived', status: 'done', value: 70_00 })
    await archiveRow(store, DEMO_IDS.rowGroceries, TODAY)
    // October's amount is its own now, and still ticked; September's was never ticked
    expect(await health('2026-10')).toMatchObject({ source: 'items', status: 'done', value: 70_00 })
    expect((await health('2026-09')).value).toBe(72_00)
    expect((await health('2026-09')).status).not.toBe('done')
  })

  it('a typed amount that was ticked stays ticked when a rule takes its month over', async () => {
    const { store, read } = await demo()
    await setCellValue(store, DEMO_IDS.rowToInvestment, '2026-12', 400_00, 'this-month')
    await setCellDone(store, DEMO_IDS.rowToInvestment, '2026-12', true)
    await setRule(store, { rowId: DEMO_IDS.rowToInvestment }, { kind: 'share-of-income', share: 0.1 }, '2026-12')
    const { out } = await read()
    const december = out.cells[cellKey(DEMO_IDS.rowToInvestment, '2026-12')]
    expect(december).toMatchObject({ source: 'derived', status: 'done' })
    // the month after had no tick, and has none
    expect(out.cells[cellKey(DEMO_IDS.rowToInvestment, '2027-01')].status).toBe('derived')
  })
})
