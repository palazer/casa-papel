import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { computeEngine } from '@/engine'
import { newId, type Row } from '@/model'
import {
  CasaDb, NO_QUESTION, PastChangeCancelled, PastChangeStale, Store, addAccount, addAccountWithRow, addRow, changeLineText, changesBetween, defaultMonths, loadTables,
  pastGuard, quickCreateHousehold, setAccountActual, setCellDone, setCellValue, setManualRate, updateAccount, updateRow,
  type PastAnswer, type PastQuestion,
} from '@/store'
import { loadDemo } from '@/demo/loadDemo'
import { restoreToday, setToday } from '../today'

/**
 * Rule T4: a change that alters a month that is over asks first. Today is 15 June 2026 and the household starts in
 * January: January to May are over. Rent is 1,200.00 a month and the salary 3,000.00, so the current account gains
 * 1,800.00 a month from its 1,000.00.
 */
async function fresh() {
  const store = new Store(new CasaDb(`test-${newId()}`))
  await quickCreateHousehold(store, { name: 'Test', baseCurrency: 'EUR', locale: 'en-IE', startMonth: '2026-01' })
  const current = await addAccount(store, { name: 'Current account', type: 'checking', currency: 'EUR', openingMonth: '2026-01', openingBalance: 1000_00 })
  const rows = (await loadTables(store)).rows
  const of = (name: string) => rows.find((r) => r.name === name)!
  await setCellValue(store, of('Salary').id, '2026-01', 3000_00, 'from-now-on')
  await setCellValue(store, of('Rent').id, '2026-01', 1200_00, 'from-now-on')
  return { store, current, rent: of('Rent'), salary: of('Salary') }
}

/** The guard with an answer given at once, and every question it was asked. */
function answering(store: Store, answer: PastAnswer = 'save') {
  const asked: PastQuestion[] = []
  const say = { answer }
  store.setGuard(pastGuard(store, async (q) => {
    asked.push(q)
    return say.answer
  }))
  return { asked, say }
}

/** The guard holding its question open until the test answers it. */
function waiting(store: Store) {
  let answer: (a: PastAnswer) => void = () => undefined
  let raised: () => void = () => undefined
  const raisedOnce = new Promise<void>((r) => { raised = r })
  store.setGuard(pastGuard(store, (q) => {
    void q
    raised()
    return new Promise<PastAnswer>((r) => { answer = r })
  }))
  return { raised: raisedOnce, answer: (a: PastAnswer) => answer(a) }
}

const rentIn = async (store: Store, rent: Row, month: string) => {
  const tables = await loadTables(store)
  return computeEngine({ tables, months: defaultMonths(tables.household[0], tables, '2026-06') }).cells[`${rent.id}|${month}`]?.value
}

describe('a change that reaches into months that are over asks first', () => {
  beforeEach(() => setToday('2026-06-15'))
  afterEach(restoreToday)

  it('names the months and what changes in them; Cancel writes nothing and leaves Undo as it was', async () => {
    const { store, rent } = await fresh()
    const { asked } = answering(store, 'cancel')
    const undoable = store.canUndo
    await expect(setCellValue(store, rent.id, '2026-03', 1300_00, 'from-now-on')).rejects.toBeInstanceOf(PastChangeCancelled)
    expect(asked).toHaveLength(1)
    const q = asked[0]
    expect(q.changes.months).toEqual(['2026-03', '2026-04', '2026-05'])
    expect(q.changes.lines.map((l) => changeLineText(l, q.locale))).toEqual([
      '"Rent", Mar–May 2026: €1,200.00 → €1,300.00',
      // the month's leftover goes to savings: less of it
      '"To savings", Mar–May 2026: €1,800.00 → €1,700.00',
      '"Savings" at the end of May 2026: €9,000.00 → €8,700.00',
    ])
    expect(q.fromNow).toBeNull()
    expect(await rentIn(store, rent, '2026-03')).toBe(1200_00)
    expect(store.canUndo).toBe(undoable)
  })

  it('"Save anyway" writes it, and Undo takes it back', async () => {
    const { store, rent } = await fresh()
    answering(store, 'save')
    await setCellValue(store, rent.id, '2026-03', 1300_00, 'from-now-on')
    expect(await rentIn(store, rent, '2026-03')).toBe(1300_00)
    await store.undo()
    expect(await rentIn(store, rent, '2026-03')).toBe(1200_00)
  })

  it('a change in the current month or later asks nothing', async () => {
    const { store, rent } = await fresh()
    const { asked } = answering(store, 'cancel')
    await setCellValue(store, rent.id, '2026-06', 1300_00, 'from-now-on')
    await setCellValue(store, rent.id, '2026-09', 1350_00, 'this-month')
    expect(asked).toHaveLength(0)
    expect(await rentIn(store, rent, '2026-06')).toBe(1300_00)
  })

  it('a change that moves no figure of a month that is over asks nothing: a name', async () => {
    const { store, rent } = await fresh()
    const { asked } = answering(store, 'cancel')
    await updateRow(store, rent.id, { name: 'Flat' })
    expect(asked).toHaveLength(0)
  })

  it('a rate typed for a month that is over asks, in the household\'s currency', async () => {
    const { store } = await fresh()
    const pay = await addRow(store, { name: 'Dollar pay', section: 'income', categoryId: null, currency: 'USD' })
    await setManualRate(store, 'EUR/USD', '2026-01', 1.1)
    await setCellValue(store, pay.id, '2026-01', 1100_00, 'from-now-on')
    const { asked } = answering(store, 'cancel')
    await expect(setManualRate(store, 'EUR/USD', '2026-02', 1.25)).rejects.toBeInstanceOf(PastChangeCancelled)
    expect(asked[0].changes.months).toEqual(['2026-02', '2026-03', '2026-04', '2026-05'])
    expect(changeLineText(asked[0].changes.lines[0], 'en-IE')).toBe('"Dollar pay", Feb–May 2026: €1,000.00 → €880.00')
  })

  it('a change seen only in net worth gets a line of its own', async () => {
    const { store } = await fresh()
    const savings = (await loadTables(store)).accounts.find((a) => a.name === 'Savings')!
    await updateAccount(store, savings.id, { openingBalance: 500_00 })
    const { asked } = answering(store, 'cancel')
    await expect(updateAccount(store, savings.id, { outsideNetWorth: true })).rejects.toBeInstanceOf(PastChangeCancelled)
    // savings holds its 500.00 and every month's leftover: 9,500.00 by May; the current account 1,000.00
    expect(asked[0].changes.lines.map((l) => changeLineText(l, 'en-IE'))).toEqual(['Net worth at the end of May 2026: €10,500.00 → €1,000.00'])
  })
})

describe('a card that becomes a loan, with payments in months that are over', () => {
  beforeEach(() => setToday('2026-06-15'))
  afterEach(restoreToday)

  it('a card that records only its payments reads like a loan already: the change moves no figure, asks nothing, and writes account and row', async () => {
    const { store } = await fresh()
    const { account, row } = await addAccountWithRow(store, { name: 'Card', type: 'credit-card', currency: 'EUR', openingMonth: '2026-01', openingBalance: 5000_00, card: { cardMode: 'lump' } }, { kind: 'pay-off' })
    await setCellValue(store, row.id, '2026-01', 100_00, 'from-now-on')
    const { asked } = answering(store, 'cancel')
    const stored = async () => {
      const t = await loadTables(store)
      return [t.accounts.find((a) => a.id === account.id)!.type, t.rows.find((r) => r.id === row.id)!.kind]
    }

    await updateAccount(store, account.id, { type: 'loan', card: undefined })
    expect(asked).toHaveLength(0)
    expect(await stored()).toEqual(['loan', 'debt-payment'])
  })

  it('a card whose purchases are expense rows: the payment becomes an expense of months that are over, so the change asks; Cancel writes neither record', async () => {
    const { store } = await fresh()
    const { account, row } = await addAccountWithRow(store, { name: 'Card', type: 'credit-card', currency: 'EUR', openingMonth: '2026-01', openingBalance: 5000_00, card: { cardMode: 'itemized' } }, { kind: 'pay-off' })
    await setCellValue(store, row.id, '2026-01', 100_00, 'from-now-on')
    const { asked, say } = answering(store, 'cancel')
    const stored = async () => {
      const t = await loadTables(store)
      return [t.accounts.find((a) => a.id === account.id)!.type, t.rows.find((r) => r.id === row.id)!.kind]
    }

    await expect(updateAccount(store, account.id, { type: 'loan', card: undefined })).rejects.toBeInstanceOf(PastChangeCancelled)
    expect(asked).toHaveLength(1)
    expect(await stored()).toEqual(['credit-card', 'card-payment'])

    say.answer = 'save'
    await updateAccount(store, account.id, { type: 'loan', card: undefined })
    expect(await stored()).toEqual(['loan', 'debt-payment'])
  })

  it('a row that only moves to another section changes no figure, and asks nothing', async () => {
    const { store } = await fresh()
    const { account, row } = await addAccountWithRow(store, { name: 'Visa', type: 'credit-card', currency: 'EUR', openingMonth: '2026-01', card: { cardMode: 'itemized' } }, { kind: 'pay-off' })
    // what a save wrote before the rows followed: the card alone, now recording only its payments
    const t = await loadTables(store)
    await store.commit([{ op: 'put', table: 'accounts', record: { ...t.accounts.find((a) => a.id === account.id)!, card: { cardMode: 'lump' as const }, updatedAt: Date.now() } }], NO_QUESTION)
    const { asked } = answering(store, 'cancel')
    await updateAccount(store, account.id, { name: 'Visa card' })
    expect(asked).toHaveLength(0)
    expect((await loadTables(store)).rows.find((r) => r.id === row.id)).toMatchObject({ section: 'expense', kind: 'card-payment' })
  })
})

describe('what never asks', () => {
  beforeEach(() => setToday('2026-06-15'))
  afterEach(restoreToday)

  it('a tick, a real balance, something new, and a save marked so', async () => {
    const { store, rent, current } = await fresh()
    const { asked } = answering(store, 'cancel')
    await setCellDone(store, rent.id, '2026-02', true)
    await setAccountActual(store, current.id, '2026-02', 4000_00)
    await addAccount(store, { name: 'Old savings', type: 'savings', currency: 'EUR', openingMonth: '2026-01', openingBalance: 2000_00 })
    const tables = await loadTables(store)
    const rentCell = tables.cells.find((c) => c.rowId === rent.id && c.month === '2026-01')!
    await store.commit([{ op: 'put', table: 'cells', record: { ...rentCell, value: 1250_00, updatedAt: Date.now() } }], NO_QUESTION)
    expect(asked).toHaveLength(0)
  })

  it('without a guard, as in every other test, nothing asks', async () => {
    const { store, rent } = await fresh()
    await setCellValue(store, rent.id, '2026-03', 1300_00, 'from-now-on')
    expect(await rentIn(store, rent, '2026-03')).toBe(1300_00)
  })
})

describe('while the question is open', () => {
  beforeEach(() => setToday('2026-06-15'))
  afterEach(restoreToday)

  it('Undo waits', async () => {
    const { store, rent } = await fresh()
    const q = waiting(store)
    const saving = setCellValue(store, rent.id, '2026-03', 1300_00, 'from-now-on')
    await q.raised
    expect(store.isAsking).toBe(true)
    expect(await store.undo()).toBe(false)
    q.answer('save')
    await saving
    expect(store.isAsking).toBe(false)
    expect(await rentIn(store, rent, '2026-03')).toBe(1300_00)
  })

  it('something else saved meanwhile: "Save anyway" writes nothing and says so', async () => {
    const { store, rent, salary } = await fresh()
    const q = waiting(store)
    const saving = setCellValue(store, rent.id, '2026-03', 1300_00, 'from-now-on')
    await q.raised
    // the other device's change arrives, written by the app
    const tables = await loadTables(store)
    const pay = tables.cells.find((c) => c.rowId === salary.id && c.month === '2026-01')!
    await store.commitSystem([{ op: 'put', table: 'cells', record: { ...pay, value: 3100_00, updatedAt: Date.now() } }])
    q.answer('save')
    await expect(saving).rejects.toBeInstanceOf(PastChangeStale)
    await expect(saving).rejects.toThrow('Something else was saved while the question was open. Nothing was saved: save again.')
    expect(await rentIn(store, rent, '2026-03')).toBe(1200_00)
  })

  it('a save that waited is stamped with the time it is written', async () => {
    const { store, rent } = await fresh()
    const q = waiting(store)
    const saving = setCellValue(store, rent.id, '2026-03', 1300_00, 'from-now-on')
    await q.raised
    // the answer comes a minute later
    const answeredAt = Date.now() + 60_000
    vi.setSystemTime(answeredAt)
    q.answer('save')
    await saving
    const cell = (await loadTables(store)).cells.find((c) => c.rowId === rent.id && c.month === '2026-03')!
    expect(cell.updatedAt).toBeGreaterThanOrEqual(answeredAt)
  })
})

describe('"Only from <Month> on"', () => {
  beforeEach(() => setToday('2026-06-15'))
  afterEach(restoreToday)

  it('is offered with a version that leaves the past alone, and that version is what is written', async () => {
    const { store, rent } = await fresh()
    const { asked } = answering(store, 'from-now')
    const tables = await loadTables(store)
    const january = tables.cells.find((c) => c.rowId === rent.id && c.month === '2026-01')!
    const all = [{ op: 'put' as const, table: 'cells' as const, record: { ...january, value: 1300_00, updatedAt: Date.now() } }]
    const june = [{ op: 'put' as const, table: 'cells' as const, record: { ...january, month: '2026-06', value: 1300_00, updatedAt: Date.now() } }]
    await store.commit(all, { fromNow: june })
    expect(asked[0].fromNow).toBe('2026-06')
    expect(await rentIn(store, rent, '2026-05')).toBe(1200_00)
    expect(await rentIn(store, rent, '2026-06')).toBe(1300_00)
  })

  it('is not offered when that version too reaches back', async () => {
    const { store, rent } = await fresh()
    const { asked } = answering(store, 'save')
    const tables = await loadTables(store)
    const january = tables.cells.find((c) => c.rowId === rent.id && c.month === '2026-01')!
    const all = [{ op: 'put' as const, table: 'cells' as const, record: { ...january, value: 1300_00, updatedAt: Date.now() } }]
    await store.commit(all, { fromNow: all })
    expect(asked[0].fromNow).toBeNull()
  })
})

describe('the list', () => {
  beforeEach(() => setToday('2026-06-15'))
  afterEach(restoreToday)

  it('runs of months with the same before and after, at most eight lines, then how many more', async () => {
    const { store, rent } = await fresh()
    const before = await loadTables(store)
    const work = (tables: typeof before) => ({ tables, engine: computeEngine({ tables, months: ['2026-01', '2026-02', '2026-03', '2026-04', '2026-05'] }) })
    // February alone, then March to May: two runs
    await setCellValue(store, rent.id, '2026-02', 1250_00, 'this-month')
    await setCellValue(store, rent.id, '2026-03', 1300_00, 'from-now-on')
    for (let i = 0; i < 9; i++) await addRow(store, { name: `Thing ${i}`, section: 'expense', categoryId: null })
    const things = (await loadTables(store)).rows.filter((r) => r.name.startsWith('Thing'))
    for (const t of things) await setCellValue(store, t.id, '2026-04', 10_00, 'this-month')
    const changes = changesBetween(work(before), work(await loadTables(store)), ['2026-01', '2026-02', '2026-03', '2026-04', '2026-05'], 'EUR')!
    expect(changes.lines.slice(0, 2).map((l) => changeLineText(l, 'en-IE'))).toEqual([
      '"Rent", Feb 2026: €1,200.00 → €1,250.00',
      '"Rent", Mar–May 2026: €1,200.00 → €1,300.00',
    ])
    // the rows as the plan lists them: the expenses before what goes to savings
    expect(changeLineText(changes.lines[2], 'en-IE')).toBe('"Thing 0", Apr 2026: nothing → €10.00')
    expect(changes.lines).toHaveLength(8)
    // the other three things, "To savings" (four runs, so one line) and the savings account
    expect(changes.more).toBe(5)
  })

  it('an amount that changes in more than two runs is one line: by how much in each month, where that is the same', async () => {
    const { store, rent, salary } = await fresh()
    // a salary that is different every month makes what is left, and so "To savings", different every month
    for (const [m, v] of [['2026-02', 3100_00], ['2026-03', 3050_00], ['2026-04', 3200_00], ['2026-05', 3150_00]] as const) await setCellValue(store, salary.id, m, v, 'this-month')
    const { asked } = answering(store, 'cancel')
    await expect(setCellValue(store, rent.id, '2026-01', 1300_00, 'from-now-on')).rejects.toBeInstanceOf(PastChangeCancelled)
    const lines = asked[0].changes.lines.map((l) => changeLineText(l, 'en-IE'))
    expect(lines).toContain('"Rent", Jan–May 2026: €1,200.00 → €1,300.00')
    expect(lines).toContain('"To savings", Jan–May 2026: €100.00 less in each of 5 months')
  })

  it('a run that reaches the plan\'s last month reads "from" when the list covers the whole plan', () => {
    const line = { kind: 'amount' as const, name: 'Rent', months: ['2026-03', '2026-04'], currency: 'EUR', before: 130000, after: 120000 }
    expect(changeLineText(line, 'en-IE', { planEnd: '2026-04' })).toBe('"Rent" from Mar 2026: €1,300.00 → €1,200.00')
    expect(changeLineText(line, 'en-IE')).toBe('"Rent", Mar–Apr 2026: €1,300.00 → €1,200.00')
  })
})

describe('what the question costs', () => {
  afterEach(restoreToday)

  it('a household of the demo\'s size over two years is looked at in well under a tenth of a second', async () => {
    setToday('2028-09-15')
    const store = new Store(new CasaDb(`test-${newId()}`))
    await loadDemo(store)
    const { asked } = answering(store, 'save')
    const tables = await loadTables(store)
    const row = tables.rows.find((r) => r.name === 'Health')!
    const started = performance.now()
    await setCellValue(store, row.id, '2026-10', 77_00, 'this-month')
    const took = performance.now() - started
    expect(asked).toHaveLength(1)
    expect(took).toBeLessThan(100)
  })
})
