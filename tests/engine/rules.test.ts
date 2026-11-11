import { describe, expect, it } from 'vitest'
import { buildStatement, cellKey, computeEngine, type EngineOutput, type Statement, type StatementLine } from '@/engine'
import { FxRateSchema, monthRange, resolveRules, sharePercent, type Row, type Tables } from '@/model'
import { T0, account, cellValue, household, pool, row, tables } from './helpers'

const months = monthRange('2026-01', '2026-04')
const walk = (lines: StatementLine[]): StatementLine[] => lines.flatMap((l) => [l, ...walk(l.children)])
const all = (s: Statement) => walk([...s.flow.left.lines, ...s.flow.right.lines, ...s.position.left.lines, ...s.position.right.lines])

/**
 * Salary 5,000 with 1,000 tax deducted from it (take-home 4,000), rent 1,500, 100 kept in the account.
 * Broker takes 10 % of income, Rainy day 25 % of what is left, Savings the rest.
 */
function world(over: { closingRule?: 'savings-plug' | 'leftover-plug'; rows?: (r: Record<string, Row>) => Partial<Record<string, Partial<Row>>> } = {}) {
  const savings = account({ name: 'Savings', type: 'savings', order: 'a0' })
  const rainy = account({ name: 'Rainy day', type: 'savings', order: 'a1' })
  const broker = account({ name: 'Broker', type: 'investment', order: 'a2' })
  const r: Record<string, Row> = {
    salary: row({ name: 'Salary', section: 'income', kind: 'salary', order: 'a0' }),
    rent: row({ name: 'Rent', section: 'expense', order: 'a1' }),
    toSavings: row({ name: 'To savings', section: 'transfer', kind: 'to-savings', accountId: savings.id, order: 'a0' }),
    toRainy: row({ name: 'To Rainy day', section: 'transfer', kind: 'to-savings', accountId: rainy.id, order: 'a1', rule: 'share-of-rest', ruleShare: 0.25 }),
    toBroker: row({ name: 'To Broker', section: 'transfer', kind: 'to-investment', accountId: broker.id, order: 'a2', rule: 'share-of-income', ruleShare: 0.1 }),
  }
  r.tax = row({ name: 'Tax', section: 'expense', deductedFromRowId: r.salary.id, order: 'a0' })
  const patch = over.rows?.(r) ?? {}
  for (const [k, p] of Object.entries(patch)) r[k] = { ...r[k], ...p }
  const t = tables({
    household: [household({ closingRule: over.closingRule ?? 'savings-plug', cashBuffer: 10000 })],
    accounts: [savings, rainy, broker],
    rows: Object.values(r),
    cells: [cellValue(r.salary.id, '2026-01', 500000), cellValue(r.tax.id, '2026-01', 100000), cellValue(r.rent.id, '2026-01', 150000)],
  })
  return { t, r, savings, rainy, broker }
}
const run = (t: Tables): EngineOutput => computeEngine({ tables: t, months })
const value = (out: EngineOutput, r: Row, m: string) => out.cells[cellKey(r.id, m)].value
/** The month identity both month-end rules keep. */
function expectIdentity(out: EngineOutput) {
  for (const m of out.months) {
    const t = out.totals[m]
    expect(t.cashExpense + t.allocations + t.toInvestment + t.pocket + t.debt + t.toSavings + t.leftover, m).toBe(t.income)
  }
}
function expectBalanced(t: Tables, out: EngineOutput) {
  for (const m of out.months) {
    const s = buildStatement(t, out, m)!
    expect(s.flow.difference, `${m} month`).toBe(0)
    expect(s.position.difference, `${m} position`).toBe(0)
  }
}

describe('rules: how a transfer is worked out', () => {
  it('fills the month in order: shares of income, the buffer, shares of what is left, then the rest', () => {
    const { t, r, savings, rainy, broker } = world()
    const out = run(t)
    const tot = out.totals['2026-02']
    expect(tot.takeHome).toBe(400000)
    expect(value(out, r.toBroker, '2026-02')).toBe(40000) // 10 % of take-home, not of the 5,000 before tax
    expect(tot.leftForShares).toBe(200000) // 5,000 − 2,500 spent − 400 invested − 100 kept
    expect(value(out, r.toRainy, '2026-02')).toBe(50000)
    expect(tot.rest).toBe(150000)
    expect(value(out, r.toSavings, '2026-02')).toBe(150000)
    expect(tot.toSavings).toBe(200000)
    expect(tot.leftover).toBe(10000)
    for (const row of [r.toBroker, r.toRainy, r.toSavings]) expect(out.cells[cellKey(row.id, '2026-02')]).toMatchObject({ source: 'derived', status: 'derived', currency: 'EUR' })
    expect(out.accounts[savings.id].months['2026-02'].balance).toBe(300000)
    expect(out.accounts[rainy.id].months['2026-02'].balance).toBe(100000)
    expect(out.accounts[broker.id].months['2026-02'].capital).toBe(80000)
    expectIdentity(out)
    expectBalanced(t, out)
    expect(out.warnings).toEqual([])
  })

  it('in a short month a share of what is left gives nothing and the rest account covers the gap', () => {
    const { t, r, savings } = world()
    const short = { ...t, cells: [...t.cells, cellValue(r.rent.id, '2026-02', 480000), cellValue(r.rent.id, '2026-03', 150000)] }
    const out = run(short)
    const tot = out.totals['2026-02']
    expect(tot.leftForShares).toBe(0)
    expect(value(out, r.toRainy, '2026-02')).toBe(0)
    expect(value(out, r.toBroker, '2026-02')).toBe(40000) // a share of income still moves
    expect(tot.rest).toBe(-130000)
    expect(out.accounts[savings.id].months['2026-02'].balance).toBe(150000 - 130000)
    const s = buildStatement(short, out, '2026-02')!
    const cover = s.flow.left.lines.find((l) => l.id === 'cover')!
    expect(cover.children).toHaveLength(1)
    expect(cover.children[0]).toMatchObject({ rowId: r.toSavings.id, label: 'From Savings', amount: 130000, balancing: true })
    expectIdentity(out)
    expectBalanced(short, out)
  })

  it('counts money taken out of investments as income, but not for a share of income', () => {
    const { t, r, broker } = world()
    const sold = row({ name: 'Sold shares', section: 'income', kind: 'from-investment', accountId: broker.id, order: 'a1' })
    const withSale = { ...t, rows: [...t.rows, sold], cells: [...t.cells, cellValue(sold.id, '2026-03', 100000), cellValue(sold.id, '2026-04', 0)] }
    const out = run(withSale)
    expect(out.totals['2026-03'].income).toBe(600000)
    expect(out.totals['2026-03'].takeHome).toBe(400000)
    expect(value(out, r.toBroker, '2026-03')).toBe(40000)
    expectIdentity(out)
    expectBalanced(withSale, out)
  })

  it('money taken from a savings account comes in, lowers that account, and is not income for a share', () => {
    const { t, r, savings } = world()
    const taken = row({ name: 'From Savings', section: 'transfer', kind: 'from-savings', accountId: savings.id, order: 'a5' })
    const withTaken = { ...t, rows: [...t.rows, taken], cells: [...t.cells, cellValue(taken.id, '2026-02', 100000), cellValue(taken.id, '2026-03', 0)] }
    const out = run(withTaken)
    const tot = out.totals['2026-02']
    expect(tot).toMatchObject({ income: 600000, fromAccounts: 100000, takeHome: 400000 })
    expect(value(out, r.toBroker, '2026-02')).toBe(40000)
    // the month has 1,000 more to share out: 3,000 left, a quarter to Rainy day, the rest to Savings
    expect(tot.leftForShares).toBe(300000)
    expect(value(out, r.toRainy, '2026-02')).toBe(75000)
    expect(tot.rest).toBe(225000)
    // Savings: 1,500 in January, then 2,250 in and 1,000 out
    expect(out.accounts[savings.id].months['2026-02']).toMatchObject({ balance: 275000, inflow: 225000, outflow: 100000 })
    const s = buildStatement(withTaken, out, '2026-02')!
    const group = s.flow.left.lines.find((l) => l.id === 'from-accounts')!
    expect(group).toMatchObject({ label: 'Taken from accounts', amount: 100000 })
    expect(group.children).toMatchObject([{ kind: 'row', rowId: taken.id, label: 'From Savings', amount: 100000 }])
    // nothing was earned by it: net worth grows by income minus spending, as in any other month
    expect(s.position.right.lines.find((l) => l.id === 'net-worth')!.change).toBe(500000 - 250000)
    expect(out.totals['2026-03'].fromAccounts).toBe(0)
    expectIdentity(out)
    expectBalanced(withTaken, out)
  })

  it('a typed month shows the typed amount and the rule takes over again after it', () => {
    const { t, r } = world()
    const typed = { ...t, cells: [...t.cells, cellValue(r.toBroker.id, '2026-02', 99900), cellValue(r.toSavings.id, '2026-02', 1)] }
    const out = run(typed)
    expect(out.cells[cellKey(r.toBroker.id, '2026-02')]).toMatchObject({ value: 99900, source: 'value' })
    expect(out.cells[cellKey(r.toBroker.id, '2026-03')]).toMatchObject({ value: 40000, source: 'derived' })
    // a household that never chose its rest row keeps ignoring what that row's cells hold
    expect(out.cells[cellKey(r.toSavings.id, '2026-02')].source).toBe('derived')
    expect(out.totals['2026-02'].rest).not.toBeNull()
    expectIdentity(out)
  })

  it('gives the rest to the row chosen for it; the row that had it is idle until it has a fixed amount', () => {
    const chosen = world({ rows: () => ({ toRainy: { rule: 'rest', ruleShare: null } }) })
    let out = run(chosen.t)
    expect(resolveRules(out.rows, 'savings-plug').restRowId).toBe(chosen.r.toRainy.id)
    expect(value(out, chosen.r.toSavings, '2026-02')).toBe(0)
    expect(value(out, chosen.r.toRainy, '2026-02')).toBe(200000)
    // an idle row has nothing to show on the Statement
    expect(all(buildStatement(chosen.t, out, '2026-02')!).some((l) => l.rowId === chosen.r.toSavings.id)).toBe(false)

    const fixed = world({ rows: () => ({ toRainy: { rule: 'rest', ruleShare: null }, toSavings: { rule: 'fixed' } }) })
    const t = { ...fixed.t, cells: [...fixed.t.cells, cellValue(fixed.r.toSavings.id, '2026-01', 30000)] }
    out = run(t)
    expect(value(out, fixed.r.toSavings, '2026-03')).toBe(30000)
    expect(out.cells[cellKey(fixed.r.toSavings.id, '2026-03')].source).toBe('inherit')
    expect(value(out, fixed.r.toRainy, '2026-03')).toBe(170000)
    expect(out.accounts[fixed.rainy.id].months['2026-02'].balance).toBe(340000)
    expectIdentity(out)
    expectBalanced(t, out)
  })

  it('gives the rest to an investment account, and a month that overruns takes the gap back out of it', () => {
    const { t, r, broker, rainy } = world({ rows: () => ({ toBroker: { rule: 'rest', ruleShare: null }, toSavings: { rule: 'fixed' } }) })
    const short = { ...t, cells: [...t.cells, cellValue(r.rent.id, '2026-02', 480000), cellValue(r.rent.id, '2026-03', 150000)] }
    const out = run(short)
    expect(resolveRules(out.rows, 'savings-plug').restRowId).toBe(r.toBroker.id)
    // January: 2,400 left after the buffer, a quarter to Rainy day, the rest to the Broker
    expect(value(out, r.toRainy, '2026-01')).toBe(60000)
    expect(value(out, r.toBroker, '2026-01')).toBe(180000)
    expect(out.totals['2026-01']).toMatchObject({ rest: 180000, toInvestment: 180000, toSavings: 60000, leftover: 10000 })
    expect(out.accounts[broker.id].months['2026-01']).toMatchObject({ capital: 180000, inflow: 180000, outflow: 0 })
    // February overruns by 900: nothing for Rainy day, and the Broker gives it back as money taken out
    expect(value(out, r.toBroker, '2026-02')).toBe(-90000)
    expect(out.totals['2026-02']).toMatchObject({ rest: -90000, toInvestment: -90000, toSavings: 0, leftover: 10000 })
    expect(out.accounts[broker.id].months['2026-02']).toMatchObject({ capital: 90000, inflow: 0, outflow: 90000 })
    expect(out.accounts[rainy.id].months['2026-02'].balance).toBe(60000)
    expect(out.accounts[broker.id].months['2026-03'].capital).toBe(270000)
    const s = buildStatement(short, out, '2026-02')!
    expect(s.flow.left.lines.find((l) => l.id === 'cover')!.children).toMatchObject([{ rowId: r.toBroker.id, label: 'From Broker', amount: 90000, balancing: true }])
    expect(all(buildStatement(short, out, '2026-01')!).find((l) => l.id === r.toBroker.id)).toMatchObject({ amount: 180000, balancing: true, rule: { kind: 'rest' } })
    expectIdentity(out)
    expectBalanced(short, out)
  })

  it('gives the rest to a virtual account, which pays back in a month that overruns', () => {
    const base = world({ rows: () => ({ toSavings: { rule: 'fixed' }, toRainy: { rule: 'fixed', ruleShare: null }, toBroker: { rule: 'fixed', ruleShare: null } }) })
    const travel = pool({ name: 'Travel', accountId: base.savings.id, order: 'a0' })
    const alloc = row({ name: 'To Travel', section: 'transfer', kind: 'pool-allocation', accountId: base.savings.id, order: 'a3', rule: 'rest' })
    travel.allocationRowId = alloc.id
    const t: Tables = { ...base.t, pools: [travel], rows: [...base.t.rows, alloc], cells: [...base.t.cells, cellValue(base.r.rent.id, '2026-02', 480000), cellValue(base.r.rent.id, '2026-03', 150000)] }
    const out = run(t)
    expect(resolveRules(out.rows, 'savings-plug').restRowId).toBe(alloc.id)
    expect(value(out, alloc, '2026-01')).toBe(240000)
    expect(out.totals['2026-01']).toMatchObject({ rest: 240000, allocations: 240000, toSavings: 0 })
    expect(out.pools[travel.id].months['2026-01'].balance).toBe(240000)
    expect(value(out, alloc, '2026-02')).toBe(-90000)
    expect(out.pools[travel.id].months['2026-02'].balance).toBe(150000)
    // the virtual account lives in the savings account, which moves with it
    expect(out.accounts[base.savings.id].months['2026-02'].balance).toBe(150000)
    const s = buildStatement(t, out, '2026-02')!
    expect(s.flow.left.lines.find((l) => l.id === 'cover')!.children).toMatchObject([{ rowId: alloc.id, label: 'From Travel', amount: 90000, balancing: true }])
    expectIdentity(out)
    expectBalanced(t, out)
  })

  it('a typed month on the chosen rest row means no rest that month: the month closes with the leftover', () => {
    const { t, r } = world({ rows: () => ({ toSavings: { rule: 'rest' }, toRainy: { rule: 'fixed', ruleShare: null } }) })
    const typed = { ...t, cells: [...t.cells, cellValue(r.toSavings.id, '2026-01', 120000)] }
    const out = run(typed)
    expect(out.totals['2026-01'].rest).toBeNull()
    expect(out.totals['2026-01'].toSavings).toBe(120000)
    expect(out.totals['2026-01'].leftover).toBe(500000 - 250000 - 40000 - 120000)
    expect(out.totals['2026-02'].rest).toBe(200000)
    const s = buildStatement(typed, out, '2026-01')!
    const line = all(s).find((l) => l.rowId === r.toSavings.id)!
    expect(line.balancing).toBeUndefined()
    expect(all(s).find((l) => l.id === 'leftover')).toMatchObject({ amount: 90000, balancing: true })
    expectIdentity(out)
    expectBalanced(typed, out)
  })

  it('without a rest account the shares still work and what remains is the leftover; a row set to take the rest is typed', () => {
    const { t, r } = world({ closingRule: 'leftover-plug', rows: () => ({ toSavings: { rule: 'rest' } }) })
    const typed = { ...t, cells: [...t.cells, cellValue(r.toSavings.id, '2026-01', 20000)] }
    const out = run(typed)
    const tot = out.totals['2026-02']
    expect(resolveRules(out.rows, 'leftover-plug').restRowId).toBeNull()
    expect(tot.rest).toBeNull()
    expect(value(out, r.toSavings, '2026-02')).toBe(20000)
    // nothing is kept back for the buffer when no account takes the rest
    expect(tot.leftForShares).toBe(500000 - 250000 - 40000 - 20000)
    expect(value(out, r.toRainy, '2026-02')).toBe(47500)
    expect(tot.leftover).toBe(190000 - 47500)
    expectIdentity(out)
    expectBalanced(typed, out)
  })

  it('feeds a virtual account from a share and an investment account in another currency at the month\'s rate', () => {
    const base = world()
    const travel = pool({ name: 'Travel', accountId: base.savings.id, order: 'a0' })
    const alloc = row({ name: 'To Travel', section: 'transfer', kind: 'pool-allocation', accountId: base.savings.id, order: 'a3', rule: 'share-of-income', ruleShare: 0.05 })
    travel.allocationRowId = alloc.id
    const t: Tables = {
      ...base.t,
      accounts: base.t.accounts.map((a) => (a.id === base.broker.id ? { ...a, currency: 'USD' } : a)),
      pools: [travel], rows: [...base.t.rows, alloc],
      fxRates: months.map((m) => FxRateSchema.parse({ pair: 'USD/EUR', month: m, rate: 0.8, source: 'manual', updatedAt: T0 })),
    }
    const out = run(t)
    expect(value(out, alloc, '2026-02')).toBe(20000)
    expect(out.totals['2026-02'].allocationsByPool[travel.id]).toBe(20000)
    expect(out.pools[travel.id].months['2026-02'].balance).toBe(40000)
    // 400.00 EUR at 0.8 EUR per USD is 500.00 USD a month
    expect(out.accounts[base.broker.id].months['2026-02'].capital).toBe(100000)
    const s = buildStatement(t, out, '2026-02')!
    expect(all(s).find((l) => l.id === `pool:${travel.id}`)?.rule).toEqual({ kind: 'share-of-income', share: 0.05, rowId: alloc.id })
    expectIdentity(out)
    expectBalanced(t, out)
  })

  it('a share stops with its archived row, and shares of what is left above 100 % are named', () => {
    const { t, r } = world({ rows: () => ({ toBroker: { archivedMonth: '2026-03' } }) })
    let out = run(t)
    expect(out.cells[cellKey(r.toBroker.id, '2026-03')]).toMatchObject({ source: 'archived', value: 0 })
    expect(out.totals['2026-03'].toInvestment).toBe(0)
    expect(out.totals['2026-02'].toInvestment).toBe(40000)
    expectIdentity(out)

    const over = world({ rows: () => ({ toBroker: { rule: 'share-of-rest', ruleShare: 0.9 } }) })
    out = run(over.t)
    expect(out.warnings).toContain('The percentages of what is left add up to more than 100%.')
    expectIdentity(out)
  })

  it('reads a household that never set a rule as before: the first "to savings" row takes the rest, the others stay idle', () => {
    const { t, r } = world({ rows: () => ({ toRainy: { rule: null, ruleShare: null }, toBroker: { rule: null, ruleShare: null } }) })
    const typed = { ...t, cells: [...t.cells, cellValue(r.toRainy.id, '2026-01', 5000), cellValue(r.toBroker.id, '2026-01', 30000)] }
    const out = run(typed)
    const rules = resolveRules(out.rows, 'savings-plug')
    expect(rules.restRowId).toBe(r.toSavings.id)
    expect(rules.byRow.get(r.toSavings.id)).toMatchObject({ kind: 'rest', typedCounts: false })
    expect(rules.byRow.get(r.toRainy.id)?.kind).toBe('idle')
    expect(rules.byRow.has(r.toBroker.id)).toBe(false)
    expect(value(out, r.toRainy, '2026-02')).toBe(0)
    expect(value(out, r.toBroker, '2026-02')).toBe(30000)
    expect(value(out, r.toSavings, '2026-02')).toBe(500000 - 250000 - 30000 - 10000)
    expect(out.warnings).toContain('More than one "to savings" row: the plug goes to the first one.')
  })
})

describe('rules on the Statement', () => {
  it('a transfer line and the account it feeds carry the same rule; an account without a row says so', () => {
    const { t, r, savings, rainy, broker } = world()
    const spare = account({ name: 'Old account', type: 'savings', order: 'a3' })
    const loan = account({ name: 'Car loan', type: 'loan', order: 'a4', openingBalance: 500000 })
    const withSpare = { ...t, accounts: [...t.accounts, spare, loan] }
    const s = buildStatement(withSpare, run(withSpare), '2026-02')!
    const lines = all(s)
    const line = (id: string) => lines.find((l) => l.id === id)!
    expect(line(r.toBroker.id).rule).toEqual({ kind: 'share-of-income', share: 0.1, rowId: r.toBroker.id })
    expect(line(`acc:${broker.id}`).rule).toEqual(line(r.toBroker.id).rule)
    expect(line(r.toRainy.id).rule).toMatchObject({ kind: 'share-of-rest', share: 0.25 })
    expect(line(`acc:${rainy.id}`).rule?.rowId).toBe(r.toRainy.id)
    expect(line(r.toSavings.id)).toMatchObject({ balancing: true, automatic: true, rule: { kind: 'rest', rowId: r.toSavings.id } })
    // the rule symbol says it: no word tag on these lines
    expect(line(r.toSavings.id).chip).toBeUndefined()
    expect(line(r.toBroker.id).chip).toBeUndefined()
    expect(line(`acc:${savings.id}`).rule?.kind).toBe('rest')
    expect(line(`acc:${spare.id}`).rule).toEqual({ kind: 'none' })
    expect(line(`acc:${loan.id}`).rule).toBeUndefined()
    expect(line(r.rent.id).rule).toBeUndefined()
  })

  it('an account fed by two rows shows no rule of its own, and a typed row reads as a fixed amount', () => {
    const { t, r, broker } = world({ rows: () => ({ toBroker: { rule: null, ruleShare: null } }) })
    const second = row({ name: 'Bonus to Broker', section: 'transfer', kind: 'to-investment', accountId: broker.id, order: 'a4' })
    let s = buildStatement(t, run(t), '2026-02')!
    expect(all(s).find((l) => l.id === `acc:${broker.id}`)?.rule).toEqual({ kind: 'fixed', share: undefined, rowId: r.toBroker.id })
    const two = { ...t, rows: [...t.rows, second] }
    s = buildStatement(two, run(two), '2026-02')!
    expect(all(s).find((l) => l.id === `acc:${broker.id}`)?.rule).toBeUndefined()
    expect(all(s).find((l) => l.id === second.id)?.rule?.kind).toBe('fixed')
  })

  it('writes a share to a tenth of a percent', () => {
    expect(sharePercent(0.1)).toBe('10%')
    expect(sharePercent(0.125)).toBe('12.5%')
    expect(sharePercent(1)).toBe('100%')
  })
})
