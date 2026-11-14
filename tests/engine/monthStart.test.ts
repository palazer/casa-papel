import { describe, expect, it } from 'vitest'
import { buildStatement, computeEngine, type StatementLine } from '@/engine'
import { monthRange } from '@/model'
import { account, actual, cellValue, household, row, tables } from './helpers'

const months = monthRange('2026-01', '2026-03')

/** A savings account with 1,000 that gets 100 a month, a fund with 10,000 at 12% a year, a loan of 5,000 paid down by 200 a month. */
function world() {
  const savings = account({ name: 'Savings', type: 'savings', openingBalance: 1000_00, order: 'a0' })
  const fund = account({
    name: 'Fund', type: 'investment', openingBalance: 10_000_00, order: 'a1',
    investment: { projectionMode: 'fixed-rate', annualRate: 0.12, depositTiming: 'end', depositFxMode: 'monthly-rate', fixedRate: null },
  })
  const loan = account({ name: 'Car loan', type: 'loan', openingBalance: 5000_00, order: 'a2' })
  const late = account({ name: 'Bonus pot', type: 'savings', openingBalance: 300_00, openingMonth: '2026-02', order: 'a3' })
  const salary = row({ name: 'Salary', section: 'income', order: 'a0' })
  const toSavings = row({ name: 'To savings', section: 'transfer', kind: 'to-savings', accountId: savings.id, order: 'c0' })
  const payOff = row({ name: 'Car loan', section: 'expense', kind: 'debt-payment', accountId: loan.id, order: 'b0' })
  const t = tables({
    household: [household({ closingRule: 'leftover-plug' })], accounts: [savings, fund, loan, late], rows: [salary, toSavings, payOff],
    cells: [cellValue(salary.id, '2026-01', 3000_00), cellValue(toSavings.id, '2026-01', 100_00), cellValue(payOff.id, '2026-01', 200_00)],
  })
  return { t, savings, fund, loan, late }
}

describe('engine: what a month began with', () => {
  it('is the opening amount in the account\'s first month and the end of the month before after that', () => {
    const { t, savings, fund, loan, late } = world()
    const out = computeEngine({ tables: t, months })
    expect(out.accounts[savings.id].months['2026-01']).toMatchObject({ start: 1000_00, computed: 1100_00, entered: false })
    expect(out.accounts[savings.id].months['2026-02']).toMatchObject({ start: 1100_00, computed: 1200_00 })
    expect(out.accounts[loan.id].months['2026-01']).toMatchObject({ start: 5000_00, computed: 4800_00, entered: false })
    expect(out.accounts[loan.id].months['2026-03'].start).toBe(4600_00)
    // an investment account starts on last month's value, growth included
    const january = out.accounts[fund.id].months['2026-01']
    expect(january).toMatchObject({ start: 10_000_00, entered: false })
    expect(january.computed).toBeGreaterThan(10_000_00)
    expect(out.accounts[fund.id].months['2026-02'].start).toBe(january.balance)
    // an account that opens later has no month before its first
    expect(out.accounts[late.id].months['2026-01']).toBeUndefined()
    expect(out.accounts[late.id].months['2026-02'].start).toBe(300_00)
  })

  it('is the real balance of the month before once one is stored, whatever kind of account', () => {
    const { t, savings, fund, loan } = world()
    const out = computeEngine({ tables: { ...t, accountMonths: [actual(savings.id, '2026-01', 1250_00), actual(fund.id, '2026-01', 9500_00), actual(loan.id, '2026-01', 4700_00)] }, months })
    for (const [acc, real] of [[savings, 1250_00], [fund, 9500_00], [loan, 4700_00]] as const) {
      expect(out.accounts[acc.id].months['2026-01']).toMatchObject({ entered: true, balance: real })
      expect(out.accounts[acc.id].months['2026-02']).toMatchObject({ start: real, entered: false })
    }
    expect(out.accounts[savings.id].months['2026-02'].computed).toBe(1350_00)
    expect(out.accounts[loan.id].months['2026-02'].computed).toBe(4500_00)
  })

  it('counts a real balance that equals the calculated one as entered, and the Statement marks it', () => {
    const { t, savings } = world()
    const withReal = { ...t, accountMonths: [actual(savings.id, '2026-01', 1100_00)] }
    const out = computeEngine({ tables: withReal, months })
    expect(out.accounts[savings.id].months['2026-01']).toMatchObject({ entered: true, adjustment: 0, balance: 1100_00 })
    const walk = (lines: StatementLine[]): StatementLine[] => lines.flatMap((l) => [l, ...walk(l.children)])
    const lineOf = (tb: typeof t, o: typeof out) => walk(buildStatement(tb, o, '2026-01')!.position.left.lines).find((l) => l.id === `acc:${savings.id}`)
    expect(lineOf(withReal, out)).toMatchObject({ entered: true })
    expect(lineOf(withReal, out)?.adjustment).toBeUndefined()
    expect(lineOf(t, computeEngine({ tables: t, months }))?.entered).toBeUndefined()
  })
})
