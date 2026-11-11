import { describe, expect, it } from 'vitest'
import { buildStatement, cellKey, computeEngine, type EngineOutput, type StatementLine } from '@/engine'
import { monthRange, newId, type MonthKey } from '@/model'
import { CasaDb, Store, addAccount, addPool, closeMonth, loadTables, quickCreateHousehold, setCellValue, setRule, topUpPool } from '@/store'

const months = monthRange('2026-01', '2026-04')
const walk = (lines: StatementLine[]): StatementLine[] => lines.flatMap((l) => [l, ...walk(l.children)])

/**
 * Salary 4,000 a month; Savings takes the rest. The Clothing virtual account gets 100 a month and its expense row takes
 * 500 in February: it then holds 200 and is 300 short.
 */
async function fresh() {
  const store = new Store(new CasaDb(`test-${newId()}`))
  await quickCreateHousehold(store, { name: 'T', baseCurrency: 'EUR', locale: 'en-IE', startMonth: '2026-01' })
  let t = await loadTables(store)
  const savings = t.accounts.find((a) => a.type === 'savings')!
  const fund = await addAccount(store, { name: 'Fund', type: 'investment', currency: 'EUR', openingMonth: '2026-01', openingBalance: 500000 })
  await setCellValue(store, t.rows.find((r) => r.name === 'Salary')!.id, '2026-01', 400000, 'from-now-on')
  const pool = await addPool(store, { name: 'Clothing', accountId: savings.id, openingBalance: 0, monthlyAllocation: 10000, fromMonth: '2026-01', createSpendRow: true })
  t = await loadTables(store)
  const clothes = t.rows.find((r) => r.section === 'expense' && r.name === 'Clothing')!
  const setAside = t.rows.find((r) => r.id === pool.allocationRowId)!
  await setCellValue(store, clothes.id, '2026-02', 50000, 'this-month')
  return { store, savings, fund, pool, clothes, setAside }
}
const engineOf = async (store: Store): Promise<EngineOutput> => computeEngine({ tables: await loadTables(store), months })
const value = (out: EngineOutput, rowId: string, m: MonthKey) => out.cells[cellKey(rowId, m)].value

describe('a virtual account that is short', () => {
  it('stops at zero; its savings account still falls by everything that came out', async () => {
    const { store, pool, savings } = await fresh()
    const out = await engineOf(store)
    expect(months.map((m) => out.pools[pool.id].months[m])).toMatchObject([
      { balance: 10000, short: 0 }, { balance: 0, short: 30000, spend: 50000 }, { balance: 10000, short: 0 }, { balance: 20000, short: 0 },
    ])
    // Savings: the rest of each month (3,900) plus the 100 set aside, minus what came out of the virtual account
    expect(out.accounts[savings.id].months['2026-02'].balance).toBe(400000 + 400000 - 50000)
    const t = await loadTables(store)
    const s = buildStatement(t, out, '2026-02')!
    const lines = walk([...s.flow.left.lines, ...s.position.left.lines])
    expect(lines.find((l) => l.id === `pool:${pool.id}`)).toMatchObject({ amount: 0, short: 30000, shortFrom: 'Savings' })
    expect(lines.find((l) => l.id === `src:${pool.id}`)).toMatchObject({ amount: 50000, short: 30000, shortFrom: 'Savings', paidFor: ['Clothing'] })
    // the unassigned part of Savings is what paid: it holds everything the virtual account does not
    expect(lines.find((l) => l.id === `free:${savings.id}`)?.amount).toBe(750000)
    expect(s.flow.difference).toBe(0)
    expect(s.position.difference).toBe(0)
  })

  it('a top-up from its savings account leaves two lines for this month only, and neither the rest nor the balance moves', async () => {
    const { store, pool, savings, setAside } = await fresh()
    const was = await engineOf(store)
    await topUpPool(store, pool.id, '2026-02', { kind: 'account', accountId: savings.id }, 30000)
    const now = await engineOf(store)
    const t = await loadTables(store)
    const from = t.rows.find((r) => r.kind === 'from-savings')!
    expect(from).toMatchObject({ name: 'From Savings', section: 'transfer', accountId: savings.id })
    expect(months.map((m) => value(now, from.id, m))).toEqual([0, 30000, 0, 0])
    expect(months.map((m) => value(now, setAside.id, m))).toEqual([10000, 40000, 10000, 10000])
    expect(now.cells[cellKey(from.id, '2026-02')].items.map((i) => [i.label, i.amount])).toEqual([['Top-up for Clothing', 30000]])
    expect(now.cells[cellKey(setAside.id, '2026-02')].items.map((i) => [i.label, i.amount])).toEqual([['', 10000], ['Top-up from Savings', 30000]])
    expect(now.pools[pool.id].months['2026-02']).toMatchObject({ balance: 0, short: 0 })
    expect(now.pools[pool.id].months['2026-03'].balance).toBe(10000)
    for (const m of months) {
      expect(now.totals[m].rest, m).toBe(was.totals[m].rest)
      expect(now.accounts[savings.id].months[m].balance, m).toBe(was.accounts[savings.id].months[m].balance)
    }
    expect(now.totals['2026-02']).toMatchObject({ fromAccounts: 30000, allocations: 40000 })
    // the Statement names the one-off on both rows
    const s = buildStatement(t, now, '2026-02')!
    const lines = walk([...s.flow.left.lines, ...s.flow.right.lines, ...s.position.left.lines])
    expect(lines.find((l) => l.id === from.id)).toMatchObject({ amount: 30000, note: 'Top-up for Clothing' })
    expect(lines.find((l) => l.id === `pool:${pool.id}`)?.short).toBeUndefined()
    expect(s.flow.difference).toBe(0)
    // a second top-up joins the first on the same row
    await topUpPool(store, pool.id, '2026-02', { kind: 'account', accountId: savings.id }, 5000)
    const twice = await engineOf(store)
    expect((await loadTables(store)).rows.filter((r) => r.kind === 'from-savings')).toHaveLength(1)
    expect(value(twice, from.id, '2026-02')).toBe(35000)
    expect(twice.pools[pool.id].months['2026-02'].balance).toBe(5000)
    // each was one step
    await store.undo()
    await store.undo()
    const back = await engineOf(store)
    expect(back.pools[pool.id].months['2026-02'].short).toBe(30000)
    expect((await loadTables(store)).rows.filter((r) => r.kind === 'from-savings' && !r.deletedAt)).toHaveLength(0)
  })

  it('from an investment account the money is taken out of it; from the month\'s income the rest shrinks instead', async () => {
    const { store, pool, fund, setAside } = await fresh()
    const was = await engineOf(store)
    await topUpPool(store, pool.id, '2026-02', { kind: 'account', accountId: fund.id }, 30000)
    let now = await engineOf(store)
    const from = (await loadTables(store)).rows.find((r) => r.kind === 'from-investment')!
    expect(from).toMatchObject({ name: 'From Fund', accountId: fund.id })
    expect(now.accounts[fund.id].months['2026-02'].outflow).toBe(30000)
    expect(now.totals['2026-02'].rest).toBe(was.totals['2026-02'].rest)
    expect(now.pools[pool.id].months['2026-02'].short).toBe(0)
    await store.undo()

    await topUpPool(store, pool.id, '2026-02', { kind: 'income' }, 30000)
    now = await engineOf(store)
    expect((await loadTables(store)).rows.some((r) => !r.deletedAt && (r.kind === 'from-savings' || r.kind === 'from-investment'))).toBe(false)
    expect(now.cells[cellKey(setAside.id, '2026-02')].items.map((i) => [i.label, i.amount])).toEqual([['', 10000], ['Top-up from this month\'s income', 30000]])
    expect(now.totals['2026-02'].rest).toBe(was.totals['2026-02'].rest! - 30000)
    expect(now.totals['2026-03'].rest).toBe(was.totals['2026-03'].rest)
    expect(now.pools[pool.id].months['2026-02'].short).toBe(0)
  })

  it('on a set-aside with a rule the month becomes a typed amount and the rule goes on the month after', async () => {
    const { store, pool, savings, setAside } = await fresh()
    await setRule(store, { poolId: pool.id }, { kind: 'share-of-income', share: 0.05 }, '2026-01')
    let out = await engineOf(store)
    expect(months.map((m) => value(out, setAside.id, m))).toEqual([20000, 20000, 20000, 20000])
    expect(out.pools[pool.id].months['2026-02'].short).toBe(10000)
    await topUpPool(store, pool.id, '2026-02', { kind: 'account', accountId: savings.id }, 10000)
    out = await engineOf(store)
    expect(months.map((m) => value(out, setAside.id, m))).toEqual([20000, 30000, 20000, 20000])
    expect(out.cells[cellKey(setAside.id, '2026-02')].source).toBe('items')
    expect(out.cells[cellKey(setAside.id, '2026-03')].source).toBe('derived')
    expect(out.pools[pool.id].months['2026-02']).toMatchObject({ balance: 0, short: 0 })
  })

  it('on the virtual account that takes the rest, the month keeps what the rest was and closes with a leftover from then on', async () => {
    const { store, pool, savings, setAside, clothes } = await fresh()
    await setRule(store, { poolId: pool.id }, { kind: 'rest' }, '2026-01')
    await setCellValue(store, clothes.id, '2026-02', 900000, 'this-month')
    let out = await engineOf(store)
    // 4,000 a month all go to Clothing; February takes 9,000 out of the 8,000 it then holds
    expect(out.totals['2026-02'].rest).toBe(400000)
    expect(out.pools[pool.id].months['2026-02'].short).toBe(100000)
    await topUpPool(store, pool.id, '2026-02', { kind: 'account', accountId: savings.id }, 100000)
    out = await engineOf(store)
    expect(out.cells[cellKey(setAside.id, '2026-02')]).toMatchObject({ value: 500000, source: 'items' })
    expect(out.pools[pool.id].months['2026-02']).toMatchObject({ balance: 0, short: 0 })
    // the month no longer takes the rest: it holds what the rest was, and both halves still agree
    expect(out.totals['2026-02']).toMatchObject({ rest: null, leftover: 0 })
    let s = buildStatement(await loadTables(store), out, '2026-02')!
    expect([s.flow.difference, s.position.difference]).toEqual([0, 0])
    // what changes in that month afterwards stays in the main account; the rest goes on the month after
    const salary = (await loadTables(store)).rows.find((r) => r.name === 'Salary')!
    await setCellValue(store, salary.id, '2026-02', 420000, 'this-month')
    out = await engineOf(store)
    expect(value(out, setAside.id, '2026-02')).toBe(500000)
    expect(out.totals['2026-02']).toMatchObject({ rest: null, leftover: 20000 })
    expect(out.cells[cellKey(setAside.id, '2026-03')].source).toBe('derived')
    expect(out.totals['2026-03'].rest).toBe(400000)
    s = buildStatement(await loadTables(store), out, '2026-02')!
    expect([s.flow.difference, s.position.difference]).toEqual([0, 0])
  })

  it('says what cannot be', async () => {
    const { store, pool, savings } = await fresh()
    const loan = await addAccount(store, { name: 'Car loan', type: 'loan', currency: 'EUR', openingMonth: '2026-01' })
    await expect(topUpPool(store, pool.id, '2026-02', { kind: 'account', accountId: savings.id }, 0)).rejects.toThrow(/more than zero/)
    await expect(topUpPool(store, pool.id, '2026-02', { kind: 'account', accountId: loan.id }, 100)).rejects.toThrow(/savings or an investment account/)
    await expect(topUpPool(store, newId(), '2026-02', { kind: 'income' }, 100)).rejects.toThrow(/no longer exists/)
    await closeMonth(store, '2026-02')
    await expect(topUpPool(store, pool.id, '2026-02', { kind: 'income' }, 100)).rejects.toThrow(/2026-02 is closed/)
  })
})
