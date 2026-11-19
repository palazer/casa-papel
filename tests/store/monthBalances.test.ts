import { describe, expect, it } from 'vitest'
import { cellKey, computeEngine } from '@/engine'
import { monthRange, newId } from '@/model'
import {
  CasaDb, FILL_EVERY_MAIN, Store, addAccount, archiveAccount, loadTables, monthBalances, previewMonthBalances, quickCreateHousehold,
  setManualRate, setMonthBalances, unrecordedRowName,
} from '@/store'
import { DEMO_IDS } from '@/demo/demoHousehold'
import { loadDemo } from '@/demo/loadDemo'
import { monthProgress } from '@/features/statement/progress'

const DEMO_MONTHS = monthRange('2026-09', '2026-12')

/** The demo household: the savings account and the card have no real balance anywhere. */
async function demo() {
  const store = new Store(new CasaDb(`test-${newId()}`))
  await loadDemo(store)
  const read = async () => {
    const tables = await loadTables(store)
    return { tables, out: computeEngine({ tables, months: DEMO_MONTHS }) }
  }
  return { store, read }
}

/** A new household that begins in January 2026, with its main account holding 1,200 and a savings account holding 1,000. */
async function fresh() {
  const store = new Store(new CasaDb(`test-${newId()}`))
  await quickCreateHousehold(store, { name: 'T', baseCurrency: 'EUR', locale: 'en-IE', startMonth: '2026-01', closingRule: 'leftover-plug' })
  const current = (await loadTables(store)).accounts.filter((a) => !a.deletedAt && a.type === 'checking')
  const main = current[0] ?? await addAccount(store, { name: 'Main', type: 'checking', currency: 'EUR', openingMonth: '2026-01', openingBalance: 1200_00 })
  const savings = await addAccount(store, { name: 'Rainy day', type: 'savings', currency: 'EUR', openingMonth: '2026-01', openingBalance: 1000_00 })
  const read = async () => {
    const tables = await loadTables(store)
    return { tables, out: computeEngine({ tables, months: monthRange('2026-01', '2026-04') }) }
  }
  return { store, main, savings, read }
}
const stored = async (store: Store, accountId: string, month: string) =>
  (await loadTables(store)).accountMonths.find((a) => a.accountId === accountId && a.month === month)?.actualBalance ?? null

describe('a month\'s balances: the end of a month', () => {
  it('is the real balance once typed, and the next month starts with it', async () => {
    const { store, read } = await demo()
    const before = await read()
    const was = before.out.accounts[DEMO_IDS.savings].months['2026-10']
    expect(was).toMatchObject({ entered: false, balance: was.computed })
    await setMonthBalances(store, '2026-10', { ends: { [DEMO_IDS.savings]: 9000_00 } })
    const { out } = await read()
    expect(out.accounts[DEMO_IDS.savings].months['2026-10']).toMatchObject({ entered: true, computed: was.computed, balance: 9000_00, adjustment: 9000_00 - was.computed })
    expect(out.accounts[DEMO_IDS.savings].months['2026-11'].start).toBe(9000_00)
    await store.undo()
    expect((await read()).out.accounts).toEqual(before.out.accounts)
  })

  it('goes back to the calculated amount when emptied, keeps a typed 0, and writes nothing for what did not change', async () => {
    const { store, read } = await demo()
    const calculated = (await read()).out.accounts[DEMO_IDS.savings].months['2026-10'].computed
    // nothing typed, and clearing what is not there: nothing to do
    const version = store.getVersion()
    await setMonthBalances(store, '2026-10', {})
    await setMonthBalances(store, '2026-10', { ends: { [DEMO_IDS.savings]: null } })
    expect(store.getVersion()).toBe(version)
    // an emptied account really holds nothing: 0 is a number, not "no number"
    await setMonthBalances(store, '2026-10', { ends: { [DEMO_IDS.savings]: 0 } })
    expect(await stored(store, DEMO_IDS.savings, '2026-10')).toBe(0)
    expect((await read()).out.accounts[DEMO_IDS.savings].months['2026-10']).toMatchObject({ entered: true, balance: 0, adjustment: -calculated })
    const typed = store.getVersion()
    await setMonthBalances(store, '2026-10', { ends: { [DEMO_IDS.savings]: 0 } })
    expect(store.getVersion()).toBe(typed)
    await setMonthBalances(store, '2026-10', { ends: { [DEMO_IDS.savings]: null } })
    expect(await stored(store, DEMO_IDS.savings, '2026-10')).toBeNull()
    expect((await read()).out.accounts[DEMO_IDS.savings].months['2026-10']).toMatchObject({ entered: false, balance: calculated })
  })

  it('is kept in the account\'s own currency', async () => {
    const { store, read } = await fresh()
    const dollars = await addAccount(store, { name: 'Dollar savings', type: 'savings', currency: 'USD', openingMonth: '2026-01', openingBalance: 500_00 })
    await setManualRate(store, 'USD/EUR', '2026-01', 0.9)
    await setMonthBalances(store, '2026-01', { ends: { [dollars.id]: 600_00 } })
    expect(await stored(store, dollars.id, '2026-01')).toBe(600_00)
    expect((await read()).out.accounts[dollars.id].months['2026-01']).toMatchObject({ start: 500_00, balance: 600_00, balanceBase: 540_00 })
  })
})

describe('a month\'s balances: the start of a month', () => {
  it('is the end of the month before', async () => {
    const { store, read } = await demo()
    const before = await read()
    const septemberEnd = before.out.accounts[DEMO_IDS.savings].months['2026-09'].balance
    const change = before.out.accounts[DEMO_IDS.savings].months['2026-10'].computed - septemberEnd
    expect(before.out.accounts[DEMO_IDS.savings].months['2026-10'].start).toBe(septemberEnd)

    await setMonthBalances(store, '2026-10', { starts: { [DEMO_IDS.savings]: septemberEnd + 250_00 } })
    const { tables, out } = await read()
    // one number for that moment: what September ended on is what October starts with
    expect(await stored(store, DEMO_IDS.savings, '2026-09')).toBe(septemberEnd + 250_00)
    expect(out.accounts[DEMO_IDS.savings].months['2026-09']).toMatchObject({ entered: true, balance: septemberEnd + 250_00, adjustment: 250_00 })
    expect(out.accounts[DEMO_IDS.savings].months['2026-10']).toMatchObject({ start: septemberEnd + 250_00, computed: septemberEnd + 250_00 + change, entered: false })
    // September's rows are untouched
    expect(tables.cells).toEqual(before.tables.cells)

    await setMonthBalances(store, '2026-10', { starts: { [DEMO_IDS.savings]: null } })
    expect(await stored(store, DEMO_IDS.savings, '2026-09')).toBeNull()
    expect((await read()).out.accounts).toEqual(before.out.accounts)
  })

  it('is the opening amount in the account\'s first month, which cannot be left empty', async () => {
    const { store, savings, read } = await fresh()
    const later = await addAccount(store, { name: 'Bonus pot', type: 'savings', currency: 'EUR', openingMonth: '2026-02', openingBalance: 200_00 })
    await setMonthBalances(store, '2026-01', { starts: { [savings.id]: 1500_00 } })
    await setMonthBalances(store, '2026-02', { starts: { [later.id]: 350_00, [savings.id]: 1600_00 } })
    const { tables, out } = await read()
    expect(tables.accounts.find((a) => a.id === savings.id)?.openingBalance).toBe(1500_00)
    expect(tables.accounts.find((a) => a.id === later.id)?.openingBalance).toBe(350_00)
    // in February the first account has a month before it: that month's end is written, not its opening amount
    expect(await stored(store, savings.id, '2026-01')).toBe(1600_00)
    expect(await stored(store, later.id, '2026-01')).toBeNull()
    expect(out.accounts[savings.id].months['2026-01']).toMatchObject({ start: 1500_00, balance: 1600_00 })
    expect(out.accounts[later.id].months['2026-02'].start).toBe(350_00)
    await expect(setMonthBalances(store, '2026-01', { starts: { [savings.id]: null } })).rejects.toThrow('"Rainy day" has no earlier month, so its starting amount cannot be left empty. Type 0 if it held nothing.')
    await setMonthBalances(store, '2026-01', { starts: { [savings.id]: 0 } })
    expect((await loadTables(store)).accounts.find((a) => a.id === savings.id)?.openingBalance).toBe(0)
  })

  it('moves the calculated end at once in the preview, and writes nothing', async () => {
    const { store, read } = await demo()
    const { tables } = await read()
    const household = tables.household[0]
    const base = previewMonthBalances(tables, household, '2026-10')
    const line = (b: typeof base, id: string) => b.lines.find((l) => l.account.id === id)!
    const typed = previewMonthBalances(tables, household, '2026-10', { [DEMO_IDS.savings]: line(base, DEMO_IDS.savings).startCalculated! + 100_00, [DEMO_IDS.invest]: 13_000_00 })
    // a savings account moves by what was typed; an investment account grows from its new start
    expect(line(typed, DEMO_IDS.savings).endCalculated).toBe(line(base, DEMO_IDS.savings).endCalculated! + 100_00)
    expect(line(typed, DEMO_IDS.invest).result).toMatchObject({ start: 13_000_00 })
    expect(line(typed, DEMO_IDS.invest).endCalculated).toBeGreaterThan(line(base, DEMO_IDS.invest).endCalculated! + (13_000_00 - 12_620_00))
    // an emptied start reads as the calculated one again
    expect(line(previewMonthBalances(tables, household, '2026-10', { [DEMO_IDS.invest]: null }), DEMO_IDS.invest).result!.start).toBe(before(tables))
    expect(await loadTables(store)).toEqual(tables)
  })
})

/** What the demo's investment account comes to at the end of September without its real balance. */
function before(tables: Awaited<ReturnType<typeof loadTables>>): number {
  const without = { ...tables, accountMonths: [] }
  return computeEngine({ tables: without, months: DEMO_MONTHS }).accounts[DEMO_IDS.invest].months['2026-09'].computed
}

describe('a month\'s balances: the list', () => {
  it('names every account with a balance under its heading, with what is stored and what is calculated', async () => {
    const { read } = await demo()
    const { tables, out } = await read()
    const { lines, main } = monthBalances(tables, out, '2026-10')
    expect(lines.map((l) => [l.account.name, l.group])).toEqual([
      ['Main account', 'current'], ['Savings', 'savings'], ['Index fund', 'investment'], ['Credit card', 'debt'],
    ])
    expect(main).toEqual(out.main!.months['2026-10'])
    const fund = lines.find((l) => l.account.id === DEMO_IDS.invest)!
    // the fund's real balance of September is October's start; its end is still calculated
    expect(fund).toMatchObject({ opening: false, startStored: 12_620_00, endStored: null, endCalculated: out.accounts[DEMO_IDS.invest].months['2026-10'].computed, itemized: false })
    expect(lines.find((l) => l.account.id === DEMO_IDS.card)).toMatchObject({ itemized: true, startStored: null, startCalculated: out.accounts[DEMO_IDS.card].months['2026-09'].balance })
    // the main account: the plan's own figures are its own
    expect(lines.find((l) => l.account.id === DEMO_IDS.main)).toMatchObject({ opening: false, startStored: null, startCalculated: main!.start, endCalculated: main!.computed })
    // in the household's first month every start is an opening amount
    expect(monthBalances(tables, out, '2026-09').lines.every((l) => l.opening && l.startStored === l.account.openingBalance)).toBe(true)
  })

  it('knows the main account\'s amounts', async () => {
    const { store, read } = await fresh()
    const { tables, out } = await read()
    const current = monthBalances(tables, out, '2026-02').lines.filter((l) => l.group === 'current')
    expect(current).toHaveLength(1)
    expect(current[0]).toMatchObject({ opening: false, startStored: null, startCalculated: out.main!.months['2026-02'].start, endCalculated: out.main!.months['2026-02'].computed })
    await setMonthBalances(store, '2026-02', { starts: { [current[0].account.id]: 750_00 }, ends: { [current[0].account.id]: 800_00 } })
    const now = (await read()).out.main!
    expect(now.months['2026-01']).toMatchObject({ entered: true, balance: 750_00 })
    expect(now.months['2026-02']).toMatchObject({ start: 750_00, entered: true, balance: 800_00 })
  })
})

describe('a month\'s balances: the main account and an other current account (rule B9)', () => {
  async function two() {
    const w = await fresh()
    const joint = await addAccount(w.store, { name: 'Joint', type: 'joint', currency: 'EUR', openingMonth: '2026-01', openingBalance: 300_00 })
    return { ...w, joint }
  }
  /** The main account archived from `from`, and "New main" open from January: in the months before `from` both were open. */
  async function replaced(from: string) {
    const w = await fresh()
    await archiveAccount(w.store, w.main.id, from)
    const next = await addAccount(w.store, { name: 'New main', type: 'checking', currency: 'EUR', openingMonth: '2026-01', openingBalance: 0 })
    return { ...w, next }
  }

  it('each takes its own real balance, alone, at the end and at the start', async () => {
    const { store, main, joint, read } = await two()
    await setMonthBalances(store, '2026-02', { starts: { [main.id]: 100_00 }, ends: { [main.id]: 150_00 } })
    let { out } = await read()
    expect(out.main!.months['2026-01']).toMatchObject({ entered: true, balance: 100_00 })
    expect(out.main!.months['2026-02']).toMatchObject({ start: 100_00, entered: true, balance: 150_00 })
    expect(out.accounts[joint.id].months['2026-02']).toMatchObject({ entered: false, balance: 300_00 })
    await setMonthBalances(store, '2026-02', { ends: { [joint.id]: 30_00 } })
    out = (await read()).out
    expect(out.accounts[joint.id].months['2026-02']).toMatchObject({ entered: true, balance: 30_00 })
    expect(out.main!.months['2026-02']).toMatchObject({ entered: true, balance: 150_00 })
  })

  it('start on their opening amounts in the first month, each for itself', async () => {
    const { store, main, joint, read } = await two()
    await setMonthBalances(store, '2026-01', { starts: { [joint.id]: 450_00 } })
    const { tables, out } = await read()
    expect(tables.accounts.find((a) => a.id === joint.id)?.openingBalance).toBe(450_00)
    expect(tables.accountMonths.filter((a) => a.actualBalance != null)).toEqual([])
    expect(out.main!.months['2026-01'].start).toBe(tables.accounts.find((a) => a.id === main.id)?.openingBalance ?? 0)
    expect(out.accounts[joint.id].months['2026-01'].start).toBe(450_00)
  })

  it('where an archived main account and the one that replaced it were both open, a month takes both or neither', async () => {
    const { store, main, next, read } = await replaced('2026-03')
    await expect(setMonthBalances(store, '2026-02', { ends: { [main.id]: 100_00 } })).rejects.toThrow(FILL_EVERY_MAIN)
    expect((await loadTables(store)).accountMonths.filter((a) => a.actualBalance != null)).toEqual([])
    await setMonthBalances(store, '2026-02', { ends: { [main.id]: 100_00, [next.id]: 20_00 } })
    expect((await read()).out.main!.months['2026-02']).toMatchObject({ entered: true, balance: 120_00 })
    // in March only the new one is open: it alone is the line
    await setMonthBalances(store, '2026-03', { ends: { [next.id]: 500_00 } })
    expect((await read()).out.main!.months['2026-03']).toMatchObject({ entered: true, balance: 500_00 })
  })

  it('name a main account that was still open the month before and cannot be filled in from here', async () => {
    const { store, next } = await replaced('2026-02')
    await expect(setMonthBalances(store, '2026-02', { starts: { [next.id]: 100_00 } }))
      .rejects.toThrow('"Main" was still open in 2026-01 and has no real balance there. Enter it in 2026-01 first, or leave the main account empty.')
  })
})

describe('a month\'s balances: what is refused', () => {
  it('an account that has no balance in the month, a number that cannot be read, a difference booked on anything but a card', async () => {
    const { store } = await demo()
    await expect(setMonthBalances(store, '2026-10', { ends: { [newId()]: 1 } })).rejects.toThrow('That account has no balance in 2026-10.')
    await expect(setMonthBalances(store, '2026-10', { ends: { [DEMO_IDS.savings]: Number.NaN } })).rejects.toThrow('That is not a number I can read.')
    await expect(setMonthBalances(store, '2026-10', { ends: { [DEMO_IDS.savings]: 9000_00 }, book: [DEMO_IDS.savings] })).rejects.toThrow(/Only a card whose purchases are expense rows/)
  })
})

describe('a month\'s balances saved with "Count everything as done"', () => {
  it('saves them, books the card\'s difference and ticks every line, and one undo takes all of it back', async () => {
    const { store, read } = await demo()
    const before = await read()
    const expected = before.out.accounts[DEMO_IDS.card].months['2026-10'].computed
    await setMonthBalances(store, '2026-10', { ends: { [DEMO_IDS.card]: expected + 400_00, [DEMO_IDS.savings]: 9000_00 }, book: [DEMO_IDS.card] }, { done: true })
    const { tables, out } = await read()
    expect(tables.monthStates.filter((s) => s.closed)).toEqual([])
    expect(out.accounts[DEMO_IDS.savings].months['2026-10']).toMatchObject({ entered: true, balance: 9000_00 })
    const row = tables.rows.find((r) => r.name === unrecordedRowName(tables.accounts.find((a) => a.id === DEMO_IDS.card)!))!
    expect(out.cells[cellKey(row.id, '2026-10')]).toMatchObject({ value: 400_00, status: 'done' })
    // the spending is on the card's row, so the plan expects what the bank says
    expect(out.accounts[DEMO_IDS.card].months['2026-10']).toMatchObject({ entered: true, computed: expected + 400_00, balance: expected + 400_00, adjustment: 0 })
    expect(out.accounts[DEMO_IDS.card].months['2026-11'].start).toBe(expected + 400_00)
    // every line of the month is ticked, the booked difference among them
    const progress = monthProgress(out.rows, out.cells, '2026-10')
    expect(progress.done).toBe(progress.total)
    expect(progress.total).toBeGreaterThan(monthProgress(before.out.rows, before.out.cells, '2026-10').done)

    await store.undo()
    const back = await read()
    expect(back.tables.monthStates).toEqual(before.tables.monthStates)
    expect(back.tables.accountMonths.filter((a) => a.actualBalance != null)).toEqual(before.tables.accountMonths.filter((a) => a.actualBalance != null))
    expect(back.tables.rows.filter((r) => !r.deletedAt).length).toBe(before.tables.rows.filter((r) => !r.deletedAt).length)
    expect(back.out.accounts).toEqual(before.out.accounts)
    expect(back.out.totals).toEqual(before.out.totals)
  })

  it('measures the card\'s difference against the end as it is calculated from a start typed in the same step', async () => {
    const { store, read } = await demo()
    const before = await read()
    const card = before.out.accounts[DEMO_IDS.card].months['2026-10']
    await setMonthBalances(store, '2026-10', { starts: { [DEMO_IDS.card]: card.start + 100_00 }, ends: { [DEMO_IDS.card]: card.computed + 150_00 }, book: [DEMO_IDS.card] }, { done: true })
    const { tables, out } = await read()
    const row = tables.rows.find((r) => r.name === 'Credit card – Not recorded')!
    // 100 more was owed from the start; only the other 50 is spending nobody typed
    expect(out.cells[cellKey(row.id, '2026-10')].value).toBe(50_00)
    expect(await stored(store, DEMO_IDS.card, '2026-09')).toBe(card.start + 100_00)
  })
})
