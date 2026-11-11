import { describe, expect, it } from 'vitest'
import { cellKey, computeEngine, type EngineOutput } from '@/engine'
import { monthRange, newId, type MonthKey, type Row } from '@/model'
import {
  CasaDb, Store, addAccount, addPool, addRow, addRowOfKind, closeMonth, derivedRowReason, followRow, loadTables, planRemoval, previewRule,
  quickCreateHousehold, setCellValue, setDerivedDone, setRule,
} from '@/store'

const months = monthRange('2026-01', '2026-06')
const before = (m: MonthKey) => months.filter((x) => x < m)

/** Salary 4,000 and rent 1,500 every month; 300 typed to the Broker; Savings takes the rest by default. */
async function fresh(closingRule: 'savings-plug' | 'leftover-plug' = 'savings-plug') {
  const store = new Store(new CasaDb(`test-${newId()}`))
  await quickCreateHousehold(store, { name: 'T', baseCurrency: 'EUR', locale: 'en-IE', startMonth: '2026-01', closingRule })
  const t = await loadTables(store)
  const named = (name: string) => t.rows.find((r) => r.name === name)!
  const savings = t.accounts.find((a) => a.type === 'savings')!
  const rainy = await addAccount(store, { name: 'Rainy day', type: 'savings', currency: 'EUR', openingMonth: '2026-01' })
  const broker = await addAccount(store, { name: 'Broker', type: 'investment', currency: 'EUR', openingMonth: '2026-01' })
  await setCellValue(store, named('Salary').id, '2026-01', 400000, 'from-now-on')
  await setCellValue(store, named('Rent').id, '2026-01', 150000, 'from-now-on')
  const toBroker = await addRowOfKind(store, { section: 'transfer', name: 'To Broker', categoryId: null, kind: 'to-investment', accountId: broker.id })
  await setCellValue(store, toBroker.id, '2026-01', 30000, 'from-now-on')
  return { store, savings, rainy, broker, toBroker, toSavings: named('To savings'), salary: named('Salary'), rent: named('Rent') }
}
const engineOf = async (store: Store): Promise<EngineOutput> => computeEngine({ tables: await loadTables(store), months })
const value = (out: EngineOutput, row: Pick<Row, 'id'>, m: MonthKey) => out.cells[cellKey(row.id, m)].value
const rowOf = async (store: Store, id: string) => (await loadTables(store)).rows.find((r) => r.id === id)!

/** The month's sums without the two fields that say how it was closed: a month whose rest was written down has no rest to work out. */
const money = (t: EngineOutput['totals'][MonthKey]) => ({ ...t, rest: null, leftForShares: 0 })

/** Every amount, total and balance of the months before `m` is what it was. */
function expectSameBefore(was: EngineOutput, now: EngineOutput, m: MonthKey) {
  for (const month of before(m)) {
    expect(money(now.totals[month]), month).toEqual(money(was.totals[month]))
    for (const row of was.rows) expect(value(now, row, month), `${row.name} ${month}`).toBe(value(was, row, month))
    for (const [id, s] of Object.entries(was.accounts)) expect(now.accounts[id].months[month].balance, `${id} ${month}`).toBe(s.months[month].balance)
    expect(now.netWorth[month], month).toBe(was.netWorth[month])
  }
}

describe('setRule', () => {
  it('a rule counts from its month on: earlier months keep every figure, and one undo takes it back', async () => {
    const { store, toBroker, toSavings } = await fresh()
    const was = await engineOf(store)
    await setRule(store, { rowId: toBroker.id }, { kind: 'share-of-income', share: 0.1 }, '2026-03')
    const now = await engineOf(store)
    expectSameBefore(was, now, '2026-03')
    expect(await rowOf(store, toBroker.id)).toMatchObject({ rule: 'share-of-income', ruleShare: 0.1 })
    expect(now.cells[cellKey(toBroker.id, '2026-02')]).toMatchObject({ value: 30000, source: 'value' })
    expect(now.cells[cellKey(toBroker.id, '2026-03')]).toMatchObject({ value: 40000, source: 'derived' })
    expect(value(now, toBroker, '2026-06')).toBe(40000)
    // what the Broker gets more, the rest gets less
    expect(value(now, toSavings, '2026-03')).toBe(value(was, toSavings, '2026-03') - 10000)
    await store.undo()
    const back = await engineOf(store)
    expect(back.totals).toEqual(was.totals)
    expect((await rowOf(store, toBroker.id)).rule).toBeNull()
  })

  it('typed amounts from the start on are replaced, and a later change keeps what the old rule gave', async () => {
    const { store, toBroker } = await fresh()
    await setCellValue(store, toBroker.id, '2026-04', 99900, 'from-now-on')
    await setRule(store, { rowId: toBroker.id }, { kind: 'share-of-income', share: 0.1 }, '2026-01')
    let out = await engineOf(store)
    // from the first month on there is nothing to keep: every month follows the rule
    for (const m of months) expect(out.cells[cellKey(toBroker.id, m)], m).toMatchObject({ value: 40000, source: 'derived' })
    expect((await loadTables(store)).cells.filter((c) => c.rowId === toBroker.id && c.mode !== 'inherit')).toEqual([])

    const was = out
    await setRule(store, { rowId: toBroker.id }, { kind: 'share-of-income', share: 0.2 }, '2026-04')
    out = await engineOf(store)
    expectSameBefore(was, out, '2026-04')
    expect(value(out, toBroker, '2026-03')).toBe(40000)
    expect(value(out, toBroker, '2026-04')).toBe(80000)

    // and back to a fixed amount from May on
    await setRule(store, { rowId: toBroker.id }, { kind: 'fixed', amount: 25000 }, '2026-05')
    out = await engineOf(store)
    expect(months.map((m) => value(out, toBroker, m))).toEqual([40000, 40000, 40000, 80000, 25000, 25000])
    expect(out.cells[cellKey(toBroker.id, '2026-06')].source).toBe('inherit')
    expect((await rowOf(store, toBroker.id))).toMatchObject({ rule: 'fixed', ruleShare: null })
  })

  it('a typed row that gets another fixed amount needs nothing written down for its earlier months', async () => {
    const { store, toBroker } = await fresh()
    const cellsBefore = (await loadTables(store)).cells.filter((c) => c.rowId === toBroker.id).length
    await setRule(store, { rowId: toBroker.id }, { kind: 'fixed', amount: 45000 }, '2026-03')
    const out = await engineOf(store)
    expect(months.map((m) => value(out, toBroker, m))).toEqual([30000, 30000, 45000, 45000, 45000, 45000])
    expect((await loadTables(store)).cells.filter((c) => c.rowId === toBroker.id).length).toBe(cellsBefore + 1)
  })

  it('moves the rest to another savings account from a month on; the account that had it gets nothing more', async () => {
    const { store, toSavings, savings, rainy } = await fresh()
    await setDerivedDone(store, toSavings.id, '2026-01', true)
    const was = await engineOf(store)
    expect(value(was, toSavings, '2026-01')).toBe(220000)
    const toRainy = await setRule(store, { accountId: rainy.id }, { kind: 'rest' }, '2026-03')
    expect(toRainy).toMatchObject({ name: 'To Rainy day', section: 'transfer', kind: 'to-savings', accountId: rainy.id, rule: 'rest' })
    const now = await engineOf(store)
    expectSameBefore(was, now, '2026-03')
    expect(months.map((m) => value(now, toSavings, m))).toEqual([220000, 220000, 0, 0, 0, 0])
    expect(months.map((m) => value(now, toRainy, m))).toEqual([0, 0, 220000, 220000, 220000, 220000])
    expect(now.accounts[savings.id].months['2026-06'].balance).toBe(440000)
    expect(now.accounts[rainy.id].months['2026-06'].balance).toBe(880000)
    // the tick on January's transfer is kept
    expect(now.cells[cellKey(toSavings.id, '2026-01')].status).toBe('done')
    expect(now.cells[cellKey(toSavings.id, '2026-02')].status).not.toBe('done')
    const t = await loadTables(store)
    expect(t.household[0].closingRule).toBe('savings-plug')
    expect(t.rows.find((r) => r.id === toSavings.id)?.rule).toBe('fixed')
    // choosing the rest for the account that has it changes nothing
    const commits = (await store.db.table('events').count())
    await setRule(store, { rowId: toRainy.id }, { kind: 'rest' }, '2026-04')
    expect(await store.db.table('events').count()).toBe(commits)
  })

  it('moves the rest to an investment account; a savings row added afterwards is typed', async () => {
    const { store, toSavings, toBroker, broker, rainy } = await fresh()
    const was = await engineOf(store)
    await setRule(store, { accountId: broker.id }, { kind: 'rest' }, '2026-03')
    const now = await engineOf(store)
    expectSameBefore(was, now, '2026-03')
    expect(months.map((m) => value(now, toSavings, m))).toEqual([220000, 220000, 0, 0, 0, 0])
    // its own 300 goes back into what is left first: 4,000 − 1,500
    expect(months.map((m) => value(now, toBroker, m))).toEqual([30000, 30000, 250000, 250000, 250000, 250000])
    expect(now.accounts[broker.id].months['2026-06'].capital).toBe(1060000)
    const t = await loadTables(store)
    expect(t.household[0].closingRule).toBe('savings-plug')
    expect(derivedRowReason(t.rows.find((r) => r.id === toBroker.id)!, 'savings-plug')).toMatch(/rest of the month/)
    expect(derivedRowReason(t.rows.find((r) => r.id === toSavings.id)!, 'savings-plug')).toBeNull()
    const more = await addRowOfKind(store, { section: 'transfer', name: 'To Rainy day', categoryId: null, kind: 'to-savings', accountId: rainy.id })
    expect(more.rule).toBe('fixed')
    await setCellValue(store, more.id, '2026-03', 50000, 'from-now-on')
    const after = await engineOf(store)
    expect(value(after, more, '2026-04')).toBe(50000)
    expect(value(after, toBroker, '2026-04')).toBe(200000)
  })

  it('gives the rest account another rule: the rest then stays in the main account, and comes back when chosen again', async () => {
    const { store, toSavings } = await fresh()
    const was = await engineOf(store)
    await setRule(store, { rowId: toSavings.id }, { kind: 'share-of-rest', share: 0.5 }, '2026-03')
    let now = await engineOf(store)
    expect((await loadTables(store)).household[0].closingRule).toBe('leftover-plug')
    expectSameBefore(was, now, '2026-03')
    expect(value(now, toSavings, '2026-03')).toBe(110000)
    expect(now.totals['2026-03']).toMatchObject({ rest: null, leftover: 110000, toSavings: 110000 })

    const half = now
    await setRule(store, { rowId: toSavings.id }, { kind: 'rest' }, '2026-05')
    now = await engineOf(store)
    expect((await loadTables(store)).household[0].closingRule).toBe('savings-plug')
    expectSameBefore(half, now, '2026-05')
    expect(months.map((m) => value(now, toSavings, m))).toEqual([220000, 220000, 110000, 110000, 220000, 220000])
    expect(now.totals['2026-04'].leftover).toBe(110000)
    expect(now.totals['2026-05'].leftover).toBe(0)
  })

  it('turning the rest on leaves the other typed savings rows typed', async () => {
    const { store, toSavings, rainy } = await fresh('leftover-plug')
    await setCellValue(store, toSavings.id, '2026-01', 20000, 'from-now-on')
    const was = await engineOf(store)
    const toRainy = await setRule(store, { accountId: rainy.id }, { kind: 'rest' }, '2026-02')
    const now = await engineOf(store)
    expectSameBefore(was, now, '2026-02')
    expect((await rowOf(store, toSavings.id)).rule).toBe('fixed')
    expect(months.map((m) => value(now, toSavings, m))).toEqual([20000, 20000, 20000, 20000, 20000, 20000])
    expect(value(now, toRainy, '2026-01')).toBe(0)
    expect(value(now, toRainy, '2026-02')).toBe(400000 - 150000 - 30000 - 20000)
    expect(now.totals['2026-01'].leftover).toBe(200000)
    expect(now.totals['2026-02'].leftover).toBe(0)
  })

  it('makes the row for an account or a virtual account that has none', async () => {
    const { store, savings, broker, toBroker } = await fresh()
    const pool = await addPool(store, { name: 'Travel', accountId: savings.id, openingBalance: 0 })
    await store.commit(planRemoval(await loadTables(store), { kind: 'row', id: pool.allocationRowId! }, Date.now()))
    const alloc = await setRule(store, { poolId: pool.id }, { kind: 'share-of-income', share: 0.05 }, '2026-02')
    expect(alloc).toMatchObject({ name: 'To Travel', kind: 'pool-allocation', accountId: savings.id, rule: 'share-of-income', ruleShare: 0.05 })
    let t = await loadTables(store)
    expect(t.pools.find((p) => p.id === pool.id)?.allocationRowId).toBe(alloc.id)
    const out = await engineOf(store)
    expect(months.map((m) => value(out, alloc, m))).toEqual([0, 20000, 20000, 20000, 20000, 20000])
    expect(out.pools[pool.id].months['2026-06'].balance).toBe(100000)
    // an account that already has its row gets the rule on that row
    expect((await setRule(store, { accountId: broker.id }, { kind: 'fixed', amount: 10000 }, '2026-04')).id).toBe(toBroker.id)
    t = await loadTables(store)
    expect(t.rows.filter((r) => !r.deletedAt && r.kind === 'to-investment')).toHaveLength(1)
  })

  it('says on the spot what cannot be', async () => {
    const { store, toBroker, toSavings, rent, broker, rainy } = await fresh()
    const loan = await addAccount(store, { name: 'Car loan', type: 'loan', currency: 'EUR', openingMonth: '2026-01' })
    const rule = (target: Parameters<typeof setRule>[1], choice: Parameters<typeof setRule>[2], from: MonthKey = '2026-02') => setRule(store, target, choice, from)
    await expect(rule({ rowId: toBroker.id }, { kind: 'share-of-income', share: 0 })).rejects.toThrow(/above 0 and at most 100/)
    await expect(rule({ rowId: toBroker.id }, { kind: 'share-of-rest', share: 1.2 })).rejects.toThrow(/above 0 and at most 100/)
    await expect(rule({ rowId: toBroker.id }, { kind: 'fixed', amount: -1 })).rejects.toThrow(/below zero/)
    await expect(rule({ rowId: rent.id }, { kind: 'fixed', amount: 100 })).rejects.toThrow(/cannot have a rule/)
    await expect(rule({ accountId: loan.id }, { kind: 'fixed', amount: 100 })).rejects.toThrow(/not a savings or an investment account/)
    await expect(rule({ rowId: toBroker.id }, { kind: 'share-of-income', share: 0.1 }, '2025-12')).rejects.toThrow(/starts in 2026-01/)
    // the percentages of what is left cannot pass 100 % together
    await rule({ accountId: rainy.id }, { kind: 'share-of-rest', share: 0.7 })
    await expect(rule({ rowId: toBroker.id }, { kind: 'share-of-rest', share: 0.4 })).rejects.toThrow(/"To Rainy day".*110%.*100% at most/)
    await rule({ rowId: toBroker.id }, { kind: 'share-of-rest', share: 0.3 })
    // two rows into one account: the account cannot say which
    await addRowOfKind(store, { section: 'transfer', name: 'Bonus to Broker', categoryId: null, kind: 'to-investment', accountId: broker.id })
    await expect(rule({ accountId: broker.id }, { kind: 'fixed', amount: 100 })).rejects.toThrow(/Several rows move money to "Broker": To Broker, Bonus to Broker/)
    // a closed month cannot start a rule, and a rule cannot start before one
    await closeMonth(store, '2026-02')
    await expect(rule({ rowId: toSavings.id }, { kind: 'share-of-rest', share: 0.1 }, '2026-02')).rejects.toThrow(/2026-02 is closed\. Reopen it, or start the rule in an open month/)
    await expect(rule({ rowId: toSavings.id }, { kind: 'share-of-rest', share: 0.1 }, '2026-01')).rejects.toThrow(/2026-02 is closed, and a rule counts for every month from its start on/)
  })

  it('a row with a rule is automatic: it cannot follow, be followed or be typed over as paid', async () => {
    const { store, toBroker, toSavings, rainy } = await fresh()
    await setRule(store, { rowId: toBroker.id }, { kind: 'share-of-income', share: 0.1 }, '2026-01')
    const t = await loadTables(store)
    const ruled = t.rows.find((r) => r.id === toBroker.id)!
    expect(derivedRowReason(ruled, 'savings-plug')).toBe('"To Broker" is worked out by its rule: 10% of income.')
    expect(derivedRowReason(t.rows.find((r) => r.id === toSavings.id)!, 'savings-plug')).toMatch(/rest of the month/)
    const plain = await addRow(store, { name: 'Gift', section: 'transfer' })
    await expect(followRow(store, plain.id, toBroker.id)).rejects.toThrow(/worked out by its rule/)
    await expect(followRow(store, toBroker.id, plain.id)).rejects.toThrow(/cannot follow another row/)
    // beside the rest row, a second savings row is typed
    const second = await addRowOfKind(store, { section: 'transfer', name: 'To Rainy day', categoryId: null, kind: 'to-savings', accountId: rainy.id })
    expect(second.rule).toBe('fixed')
    expect(derivedRowReason(second, 'savings-plug')).toBeNull()
  })

  it('previewRule shows what a rule would give without saving anything', async () => {
    const { store, toBroker, toSavings } = await fresh()
    const t = await loadTables(store)
    const { row, engine } = previewRule(t, { rowId: toBroker.id }, { kind: 'share-of-rest', share: 0.5 }, '2026-03', months)
    expect(row.rule).toBe('share-of-rest')
    expect(value(engine, toBroker, '2026-02')).toBe(30000)
    // 4,000 − 1,500 = 2,500 left; half to the Broker, the rest to Savings
    expect(value(engine, toBroker, '2026-03')).toBe(125000)
    expect(value(engine, toSavings, '2026-03')).toBe(125000)
    expect((await loadTables(store)).rows.find((r) => r.id === toBroker.id)?.rule).toBeNull()
    expect(() => previewRule(t, { rowId: toBroker.id }, { kind: 'share-of-income', share: 0 }, '2026-03', months)).toThrow(/above 0 and at most 100/)
  })

  it('an amount typed for one month only leaves the next month to the rule', async () => {
    const { store, toBroker, rainy } = await fresh()
    await setRule(store, { rowId: toBroker.id }, { kind: 'share-of-income', share: 0.1 }, '2026-02')
    await setCellValue(store, toBroker.id, '2026-03', 55000, 'this-month')
    let out = await engineOf(store)
    expect(out.cells[cellKey(toBroker.id, '2026-03')]).toMatchObject({ value: 55000, source: 'value' })
    // April is still the rule's: nothing was written down to hold it
    expect(out.cells[cellKey(toBroker.id, '2026-04')]).toMatchObject({ value: 40000, source: 'derived' })
    expect((await loadTables(store)).cells.some((c) => c.rowId === toBroker.id && c.month === '2026-04')).toBe(false)
    // the same for a row chosen to take the rest: a typed month, then the rest again
    const toRainy = await setRule(store, { accountId: rainy.id }, { kind: 'rest' }, '2026-02')
    await setCellValue(store, toRainy.id, '2026-03', 100000, 'this-month')
    out = await engineOf(store)
    expect(out.cells[cellKey(toRainy.id, '2026-03')]).toMatchObject({ value: 100000, source: 'value' })
    expect(out.cells[cellKey(toRainy.id, '2026-04')].source).toBe('derived')
    // a typed row still holds its next month, as before
    await setCellValue(store, (await loadTables(store)).rows.find((r) => r.name === 'Rent')!.id, '2026-03', 160000, 'this-month')
    out = await engineOf(store)
    const rent = out.rows.find((r) => r.name === 'Rent')!
    expect(value(out, rent, '2026-03')).toBe(160000)
    expect(value(out, rent, '2026-04')).toBe(150000)
  })
})
