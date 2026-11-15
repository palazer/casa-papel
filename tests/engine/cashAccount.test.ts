import { describe, expect, it } from 'vitest'
import { buildStatement, computeEngine, mainAccountLabel, type StatementLine } from '@/engine'
import { accountGroup, accountRef, monthRange, paysExpenses } from '@/model'
import { account, actual, cellItems, cellValue, household, row, tables } from './helpers'

const months = monthRange('2026-01', '2026-03')
const walk = (lines: StatementLine[]): StatementLine[] => lines.flatMap((l) => [l, ...walk(l.children)])

/** A household with one current account holding 1,000 and a wallet holding 300, stored the way a cash account was before it had a balance of its own. */
function world() {
  const main = account({ name: 'Landing account', type: 'checking', openingBalance: 1000_00, tracked: false, order: 'a0' })
  const wallet = account({ name: 'Wallet', type: 'cash', openingBalance: 300_00, tracked: false, order: 'a1' })
  const salary = row({ name: 'Salary', section: 'income', order: 'a0' })
  const market = row({ name: 'Market', section: 'expense', order: 'b0' })
  const t = tables({
    household: [household({ closingRule: 'leftover-plug' })], accounts: [main, wallet], rows: [salary, market],
    cells: [cellValue(salary.id, '2026-01', 2000_00)],
  })
  return { t, main, wallet, salary, market }
}

describe('engine: a cash account', () => {
  it('is an asset with a balance of its own, and no current account', () => {
    const { t, main, wallet } = world()
    const out = computeEngine({ tables: t, months })
    expect(accountGroup(wallet)).toBe('other')
    expect(paysExpenses(wallet)).toBe(true)
    // it carries what it was opened with, also when it was stored as untracked
    expect(months.map((m) => out.accounts[wallet.id].months[m].balance)).toEqual([300_00, 300_00, 300_00])
    expect(out.accounts[wallet.id]).toMatchObject({ liability: false })
    // the current accounts are the landing account alone: the line keeps its name and counts no cash
    expect(out.main!.accountIds).toEqual([main.id])
    expect(mainAccountLabel(out.main!, t.accounts)).toBe('Landing account')
    expect(out.main!.months['2026-01']).toMatchObject({ start: 1000_00, balance: 3000_00 })
    // and net worth counts the cash once
    expect(out.netWorth['2026-01']).toBe(3000_00 + 300_00)
  })

  it('pays an expense straight out of it, and continues from a real balance', () => {
    const { t, wallet, market } = world()
    const paid = { ...t, cells: [...t.cells, cellItems(market.id, '2026-01', [{ label: 'Vegetables', amount: 40_00, fundedBy: accountRef(wallet.id) }]), cellValue(market.id, '2026-02', 0)] }
    const out = computeEngine({ tables: paid, months })
    expect(out.accounts[wallet.id].months['2026-01']).toMatchObject({ start: 300_00, outflow: 40_00, balance: 260_00 })
    // the month's own money is untouched: the expense came out of the wallet
    expect(out.totals['2026-01']).toMatchObject({ accountFunded: 40_00, leftover: 2000_00 })
    // counted and found short: the real amount is the wallet's own, and February starts with it
    const counted = computeEngine({ tables: { ...paid, accountMonths: [actual(wallet.id, '2026-01', 250_00)] }, months })
    expect(counted.accounts[wallet.id].months['2026-01']).toMatchObject({ computed: 260_00, balance: 250_00, adjustment: -10_00, entered: true })
    expect(counted.accounts[wallet.id].months['2026-02'].start).toBe(250_00)
    // a real balance of the wallet says nothing about the current accounts
    expect(counted.main!.months['2026-01'].entered).toBe(false)
  })

  it('stands under "Other assets" on the Statement, beside what the household owns', () => {
    const { t, wallet } = world()
    const deposit = account({ name: 'Rental deposit', type: 'other-asset', openingBalance: 2000_00, order: 'a2' })
    const withBoth = { ...t, accounts: [...t.accounts, deposit] }
    const s = buildStatement(withBoth, computeEngine({ tables: withBoth, months }), '2026-01')!
    expect(s.position.left.lines.map((l) => [l.label, l.amount])).toEqual([['Landing account', 3000_00], ['Other assets', 2300_00]])
    // one current account is its own line: nothing is listed under it
    expect(walk(s.position.left.lines).filter((l) => l.id.startsWith('cur:'))).toEqual([])
    expect(s.position.left.lines[1].children.map((c) => [c.label, c.amount])).toEqual([['Wallet', 300_00], ['Rental deposit', 2000_00]])
    expect(walk(s.position.left.lines).find((l) => l.accountId === wallet.id)).toMatchObject({ kind: 'account', id: `acc:${wallet.id}` })
    expect(s.position.difference).toBe(0)
  })
})
