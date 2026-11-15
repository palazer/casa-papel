import { describe, expect, it } from 'vitest'
import { buildStatement, computeEngine, computePersonBudgets, notSetAside, type StatementLine } from '@/engine'
import { EntitySchema, isOutsideNetWorth, monthRange, newId, pocketLandsIn, type Account, type Entity, type Tables } from '@/model'
import { T0, account, actual, cellValue, household, pool, row, tables } from './helpers'

const months = monthRange('2026-01', '2026-03')
const walk = (lines: StatementLine[]): StatementLine[] => lines.flatMap((l) => [l, ...walk(l.children)])
const adult = (name: string): Entity => EntitySchema.parse({ id: newId(), createdAt: T0, updatedAt: T0, kind: 'adult', name, order: 'a0' })

/**
 * A household with a current account holding 500, a savings account holding 1,000, and "Pocket savings" holding
 * 2,000 that is Sam's own and left out of net worth. Sam is paid 3,000 and gets 235 pocket money.
 */
function world(over: { pocketLandsIn?: 'pocket' | 'savings' | null; pocketType?: Account['type'] } = {}) {
  const sam = adult('Sam')
  const main = account({ name: 'Main', type: 'checking', openingBalance: 500_00, tracked: false, order: 'a0' })
  const savings = account({ name: 'Savings', type: 'savings', openingBalance: 1000_00, order: 'a1' })
  const type = over.pocketType ?? 'savings'
  const pocketSavings = account({
    name: 'Pocket savings', type, openingBalance: 2000_00, order: 'a2', outsideNetWorth: true,
    ...(type === 'investment' ? { investment: { projectionMode: 'fixed-rate' as const, annualRate: 0, depositTiming: 'start' as const, depositFxMode: 'monthly-rate' as const, fixedRate: null } } : {}),
  })
  const salary = row({ name: 'Sam – Salary', section: 'income', order: 'a0', scope: sam.id })
  const lands = over.pocketLandsIn === undefined ? 'pocket' : over.pocketLandsIn
  const pocket = row({ name: 'Sam – Pocket', section: 'transfer', kind: 'pocket-money', order: 'c0', scope: sam.id, accountId: lands === 'pocket' ? pocketSavings.id : lands === 'savings' ? savings.id : null })
  const t = tables({
    household: [household({ closingRule: 'leftover-plug' })], entities: [sam], accounts: [main, savings, pocketSavings], rows: [salary, pocket],
    cells: [cellValue(salary.id, '2026-01', 3000_00), cellValue(pocket.id, '2026-01', 235_00)],
  })
  return { t, sam, main, savings, pocketSavings, salary, pocket }
}
const statement = (t: Tables, month = '2026-01') => buildStatement(t, computeEngine({ tables: t, months }), month)!
const lineOf = (t: Tables, id: string, month = '2026-01') => walk([...statement(t, month).position.left.lines, ...statement(t, month).position.right.lines]).find((l) => l.id === id)

describe('an account left out of net worth', () => {
  it('reads the setting only on an account that holds money', () => {
    expect(isOutsideNetWorth({ type: 'savings', outsideNetWorth: true })).toBe(true)
    expect(isOutsideNetWorth({ type: 'investment', outsideNetWorth: true })).toBe(true)
    expect(isOutsideNetWorth({ type: 'other-asset', outsideNetWorth: true })).toBe(true)
    expect(isOutsideNetWorth({ type: 'cash', outsideNetWorth: true })).toBe(true)
    // the current accounts are the month's own money, and a debt is owed whoever counts it
    expect(isOutsideNetWorth({ type: 'checking', outsideNetWorth: true })).toBe(false)
    expect(isOutsideNetWorth({ type: 'loan', outsideNetWorth: true })).toBe(false)
    expect(isOutsideNetWorth({ type: 'savings', outsideNetWorth: false })).toBe(false)
    // a record stored before the setting existed has none
    expect(isOutsideNetWorth({ type: 'savings' } as Pick<Account, 'type' | 'outsideNetWorth'>)).toBe(false)
  })

  it('keeps its balance, stands under its heading with the mark, and is in no sum', () => {
    const { t, main, savings, pocketSavings } = world({ pocketLandsIn: null })
    const out = computeEngine({ tables: t, months })
    // it has its series like any account, and net worth passes it by: the main account (500 + 3,000 − 235) and the savings
    expect(out.accounts[pocketSavings.id]).toMatchObject({ outside: true })
    expect(out.accounts[savings.id].outside).toBeUndefined()
    expect(out.accounts[pocketSavings.id].months['2026-01'].balance).toBe(2000_00)
    expect(out.main!.accountIds).toEqual([main.id])
    expect(out.netWorth['2026-01']).toBe(3265_00 + 1000_00)

    const s = statement(t)
    const group = s.position.left.lines.find((l) => l.id === 'savings-accounts')!
    expect(group.children.map((l) => [l.label, l.amount, l.memo ?? false, l.outside ?? false])).toEqual([['Savings', 1000_00, false, false], ['Pocket savings', 2000_00, true, true]])
    // the heading, the side and net worth count the savings account alone
    expect(group).toMatchObject({ amount: 1000_00, change: 0 })
    expect(s.position.left.total).toBe(3265_00 + 1000_00)
    expect(lineOf(t, 'net-worth')).toMatchObject({ amount: out.netWorth['2026-01'] })
    expect(s.position.difference).toBe(0)
    expect(s.flow.difference).toBe(0)
    // it is not asked for a rule of its own, as a savings account of the household is
    expect(lineOf(t, `acc:${pocketSavings.id}`)!.rule).toBeUndefined()
    expect(lineOf(t, `acc:${savings.id}`)!.rule).toMatchObject({ kind: 'none' })
    // and it never stands for "the household's savings", even when it comes first
    expect(out.primarySavingsId).toBe(savings.id)
    expect(computeEngine({ tables: { ...t, accounts: [pocketSavings, main] }, months }).primarySavingsId).toBeNull()
    // every heading is the sum of what it counts
    for (const l of walk([...s.position.left.lines, ...s.position.right.lines])) {
      if (l.children.length && l.kind === 'group') expect(l.amount, l.label).toBe(l.children.reduce((sum, c) => (c.memo ? sum : sum + c.amount), 0))
    }
  })

  it('changes net worth when money moves to it or from it, since it is counted on one side only', () => {
    const { t, pocketSavings } = world({ pocketLandsIn: null })
    const before = computeEngine({ tables: t, months }).netWorth['2026-01']
    // 60 taken out of it into the month: the household has 60 more, and the account 60 less
    const from = row({ name: 'From Pocket savings', section: 'transfer', kind: 'from-savings', accountId: pocketSavings.id, order: 'd0' })
    const took = { ...t, rows: [...t.rows, from], cells: [...t.cells, cellValue(from.id, '2026-01', 60_00)] }
    const outTook = computeEngine({ tables: took, months })
    expect(outTook.netWorth['2026-01']).toBe(before + 60_00)
    expect(outTook.accounts[pocketSavings.id].months['2026-01']).toMatchObject({ outflow: 60_00, balance: 1940_00 })
    // it reads as money from an account, never as income
    const s = statement(took)
    const fromAccounts = s.flow.left.lines.find((l) => l.id === 'from-accounts')!
    expect(fromAccounts.children.map((l) => [l.label, l.amount])).toEqual([['From Pocket savings', 60_00]])
    expect(s.flow.left.lines.find((l) => l.id === 'income')!.amount).toBe(3000_00)
    // 100 put into it: gone from what the household counts, as pocket money is
    const to = row({ name: 'To Pocket savings', section: 'transfer', kind: 'to-savings', accountId: pocketSavings.id, order: 'd1', rule: 'fixed' })
    const put = { ...t, rows: [...t.rows, to], cells: [...t.cells, cellValue(to.id, '2026-01', 100_00)] }
    const outPut = computeEngine({ tables: put, months })
    expect(outPut.netWorth['2026-01']).toBe(before - 100_00)
    expect(outPut.accounts[pocketSavings.id].months['2026-01'].balance).toBe(2100_00)
    expect(statement(put).position.difference).toBe(0)
  })

  it('takes a real balance of its own, and the next month starts with it', () => {
    const { t, pocketSavings } = world()
    const out = computeEngine({ tables: { ...t, accountMonths: [actual(pocketSavings.id, '2026-01', 2100_00)] }, months })
    expect(out.accounts[pocketSavings.id].months['2026-01']).toMatchObject({ computed: 2235_00, balance: 2100_00, adjustment: -135_00, entered: true })
    expect(out.accounts[pocketSavings.id].months['2026-02'].start).toBe(2100_00)
  })

  it('leaves its virtual accounts out of "Set aside", which is a part of net worth', () => {
    const { t, savings, pocketSavings } = world({ pocketLandsIn: null })
    const mine = pool({ name: 'Bike', accountId: pocketSavings.id, openingBalance: 500_00, order: 'a0' })
    const ours = pool({ name: 'Travel', accountId: savings.id, openingBalance: 300_00, order: 'a1' })
    const withPools = { ...t, pools: [mine, ours] }
    const netWorth = computeEngine({ tables: withPools, months }).netWorth['2026-01']
    expect(lineOf(withPools, 'set-aside-total')).toMatchObject({ amount: 300_00 })
    expect(lineOf(withPools, 'free')).toMatchObject({ amount: netWorth - 300_00 })
    // the account still shows what it holds and how it is split
    expect(lineOf(withPools, `acc:${pocketSavings.id}`)!.children.map((c) => [c.label, c.amount])).toEqual([['Bike', 500_00], ['Not set aside', 1500_00]])
    expect(statement(withPools).position.difference).toBe(0)
  })
})

describe('pocket money that lands in an account', () => {
  it('raises the account, still leaves the month, and "Per person" still counts it', () => {
    const { t, sam, pocketSavings } = world()
    const nowhere = world({ pocketLandsIn: null })
    const out = computeEngine({ tables: t, months })
    const outNowhere = computeEngine({ tables: nowhere.t, months })
    expect(out.accounts[pocketSavings.id].months['2026-01']).toMatchObject({ start: 2000_00, inflow: 235_00, balance: 2235_00 })
    expect(outNowhere.accounts[nowhere.pocketSavings.id].months['2026-01'].balance).toBe(2000_00)
    // the month and net worth are the same either way: the pocket money is given away, and where it lands is not counted
    expect(out.totals['2026-01']).toMatchObject({ pocket: 235_00, leftover: outNowhere.totals['2026-01'].leftover })
    expect(out.netWorth['2026-01']).toBe(outNowhere.netWorth['2026-01'])
    expect(computePersonBudgets(t, out, '2026-01').find((p) => p.entityId === sam.id)).toMatchObject({ pocket: 235_00 })
    // the row carries its amount forward, so the account keeps rising
    expect(out.accounts[pocketSavings.id].months['2026-03'].balance).toBe(2000_00 + 3 * 235_00)
  })

  it('lands only where net worth does not count it: an account it merely names is untouched', () => {
    const { t, savings, pocket } = world({ pocketLandsIn: 'savings' })
    const out = computeEngine({ tables: t, months })
    expect(pocketLandsIn(pocket, savings)).toBe(false)
    expect(out.accounts[savings.id].months['2026-01']).toMatchObject({ inflow: 0, balance: 1000_00 })
    expect(out.totals['2026-01'].pocket).toBe(235_00)
  })

  it('lands in an investment account and in cash as well', () => {
    const invested = world({ pocketType: 'investment' })
    expect(computeEngine({ tables: invested.t, months }).accounts[invested.pocketSavings.id].months['2026-01']).toMatchObject({ inflow: 235_00, balance: 2235_00, capital: 2235_00 })
    const wallet = world({ pocketType: 'cash' })
    const out = computeEngine({ tables: wallet.t, months })
    expect(out.accounts[wallet.pocketSavings.id].months['2026-01']).toMatchObject({ inflow: 235_00, balance: 2235_00 })
    expect(out.accounts[wallet.pocketSavings.id].months['2026-02'].balance).toBe(2470_00)
    // under "Other assets", marked, and in no sum
    const group = statement(wallet.t).position.left.lines.find((l) => l.id === 'other-assets')!
    expect(group).toMatchObject({ amount: 0 })
    expect(group.children[0]).toMatchObject({ label: 'Pocket savings', amount: 2235_00, memo: true, outside: true })
  })

  it('is linked to the account on the Statement, both ways', () => {
    const { t, pocket, pocketSavings } = world()
    const s = statement(t)
    const line = walk(s.flow.right.lines).find((l) => l.rowId === pocket.id)!
    expect(line.link).toEqual({ to: [`acc:${pocketSavings.id}`], text: 'Lands in Pocket savings' })
    expect(lineOf(t, `acc:${pocketSavings.id}`)!.link).toEqual({ to: [line.id], text: 'Filled by Sam – Pocket' })
    // a pocket money row that lands nowhere has no link
    const loose = world({ pocketLandsIn: null })
    expect(walk(statement(loose.t).flow.right.lines).find((l) => l.rowId === loose.pocket.id)!.link).toBeUndefined()
  })
})

describe('what an account holds that is not set aside', () => {
  it('says so on the line when the virtual accounts claim more than the account holds', () => {
    const { t, savings } = world({ pocketLandsIn: null })
    // a virtual account that "already holds" 2,376 in an account holding 1,000
    const big = pool({ name: 'Pocket', accountId: savings.id, openingBalance: 2376_00, order: 'a0' })
    const over = { ...t, pools: [big] }
    const out = computeEngine({ tables: over, months })
    expect(notSetAside(over, out, savings.id, '2026-01')).toBe(-1376_00)
    expect(lineOf(over, `free:${savings.id}`)).toMatchObject({ amount: -1376_00, note: 'more is set aside than the account holds' })
    // within what it holds there is nothing to say
    const fine = { ...t, pools: [pool({ name: 'Travel', accountId: savings.id, openingBalance: 300_00, order: 'a0' })] }
    expect(notSetAside(fine, computeEngine({ tables: fine, months }), savings.id, '2026-01')).toBe(700_00)
    expect(lineOf(fine, `free:${savings.id}`)!.note).toBeUndefined()
    expect(notSetAside(fine, out, 'no-such-account', '2026-01')).toBeNull()
  })
})
