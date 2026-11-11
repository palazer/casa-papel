import { describe, expect, it } from 'vitest'
import { buildStatement, cellKey, computeEngine, type EngineOutput, type StatementLine } from '@/engine'
import { EntitySchema, monthRange, newId, resolveRules, type Entity, type Row, type Tables } from '@/model'
import { T0, account, cellValue, closedMonth, household, row, tables } from './helpers'

const months = monthRange('2026-01', '2026-03')
const adult = (name: string, order: string): Entity => EntitySchema.parse({ id: newId(), createdAt: T0, updatedAt: T0, kind: 'adult', name, order })
const run = (t: Tables): EngineOutput => computeEngine({ tables: t, months })
const value = (out: EngineOutput, r: Row, m: string) => out.cells[cellKey(r.id, m)].value
const walk = (lines: StatementLine[]): StatementLine[] => lines.flatMap((l) => [l, ...walk(l.children)])

/**
 * Ana brings 3,000 with 500 tax deducted from it (2,500 take-home), Ben 2,500, a shared child benefit 250: the
 * household takes home 5,250. Rent is 1,400 and Savings takes the rest.
 */
function world(pocket: (ids: { ana: string; ben: string }) => Array<Partial<Row> & { name: string }>, over: { household?: Record<string, unknown> } = {}) {
  const ana = adult('Ana', 'a0')
  const ben = adult('Ben', 'a1')
  const savings = account({ name: 'Savings', type: 'savings' })
  const r = {
    anaSalary: row({ name: 'Ana – Salary', section: 'income', kind: 'salary', scope: ana.id, order: 'a0' }),
    benSalary: row({ name: 'Ben – Salary', section: 'income', kind: 'salary', scope: ben.id, order: 'a1' }),
    benefit: row({ name: 'Child benefit', section: 'income', order: 'a2' }),
    rent: row({ name: 'Rent', section: 'expense', order: 'a1' }),
    toSavings: row({ name: 'To Savings', section: 'transfer', kind: 'to-savings', accountId: savings.id, order: 'a0' }),
  }
  const tax = row({ name: 'Ana – Tax', section: 'expense', deductedFromRowId: r.anaSalary.id, scope: ana.id, order: 'a0' })
  const pockets = pocket({ ana: ana.id, ben: ben.id }).map((p, i) => row({ section: 'transfer', kind: 'pocket-money', pocketMode: 'fixed', order: `b${i}`, ...p }))
  const t = tables({
    household: [household({ closingRule: 'savings-plug', ...over.household })],
    entities: [ana, ben],
    accounts: [savings],
    rows: [...Object.values(r), tax, ...pockets],
    cells: [
      cellValue(r.anaSalary.id, '2026-01', 300000), cellValue(tax.id, '2026-01', 50000), cellValue(r.benSalary.id, '2026-01', 250000),
      cellValue(r.benefit.id, '2026-01', 25000), cellValue(r.rent.id, '2026-01', 140000),
    ],
  })
  return { t, r, pockets, ana, ben }
}

function expectBalanced(t: Tables, out: EngineOutput) {
  for (const m of out.months) {
    const tot = out.totals[m]
    expect(tot.cashExpense + tot.allocations + tot.toInvestment + tot.pocket + tot.debt + tot.toSavings + tot.leftover, m).toBe(tot.income)
    const s = buildStatement(t, out, m)!
    expect(s.flow.difference, `${m} month`).toBe(0)
    expect(s.position.difference, `${m} position`).toBe(0)
  }
}

describe('pocket money by rule', () => {
  it('a share of the adult\'s own income counts what that adult takes home; a share of income counts the household\'s', () => {
    const { t, r, pockets, ana, ben } = world(({ ana, ben }) => [
      { name: 'Ana – Pocket', scope: ana, rule: 'share-of-own-income', ruleShare: 0.1 },
      { name: 'Ben – Pocket', scope: ben, rule: 'share-of-income', ruleShare: 0.02 },
    ])
    const out = run(t)
    const tot = out.totals['2026-02']
    expect(tot.takeHome).toBe(525000)
    expect(tot.takeHomeBy).toEqual({ [ana.id]: 250000, [ben.id]: 250000 }) // the shared child benefit is nobody's own
    expect(value(out, pockets[0], '2026-02')).toBe(25000) // 10 % of 2,500, not of the 3,000 before tax
    expect(value(out, pockets[1], '2026-02')).toBe(10500) // 2 % of 5,250
    expect(tot.pocket).toBe(35500)
    // the rest follows: 5,750 in, 500 tax and 1,400 rent out, 355 pocket money
    expect(value(out, r.toSavings, '2026-02')).toBe(575000 - 50000 - 140000 - 35500)
    expect(out.cells[cellKey(pockets[0].id, '2026-02')].source).toBe('derived')
    expect(out.warnings).toEqual([])
    expectBalanced(t, out)
  })

  it('a share of what is left is taken with the accounts\' shares, after the fixed amounts and the buffer', () => {
    const { t, r, pockets } = world(({ ana, ben }) => [
      { name: 'Ana – Pocket', scope: ana, rule: 'share-of-rest', ruleShare: 0.1 },
      { name: 'Ben – Pocket', scope: ben, rule: 'fixed' },
    ], { household: { cashBuffer: 10000 } })
    t.cells.push(cellValue(pockets[1].id, '2026-01', 30000))
    const out = run(t)
    const tot = out.totals['2026-02']
    // 5,750 in − 500 tax − 1,400 rent − 300 Ben's pocket − 100 kept = 3,450 left
    expect(tot.leftForShares).toBe(345000)
    expect(value(out, pockets[0], '2026-02')).toBe(34500)
    expect(value(out, pockets[1], '2026-02')).toBe(30000)
    expect(tot.pocket).toBe(64500)
    expect(value(out, r.toSavings, '2026-02')).toBe(345000 - 34500)
    expectBalanced(t, out)
  })

  it('never takes the rest: a pocket row set to it is typed, and the savings row keeps the rest', () => {
    const { t, r, pockets } = world(({ ana }) => [{ name: 'Ana – Pocket', scope: ana, rule: 'rest' }])
    const rules = resolveRules(run(t).rows, 'savings-plug')
    expect(rules.restRowId).toBe(r.toSavings.id)
    expect(rules.byRow.has(pockets[0].id)).toBe(false)
    expect(rules.warnings).toEqual([])
    const out = run(t)
    expect(value(out, pockets[0], '2026-02')).toBe(0)
    expect(out.cells[cellKey(pockets[0].id, '2026-02')].source).toBe('empty')
  })

  it('a share of own income on a row that belongs to no adult is nothing, and says so once', () => {
    const { t, pockets } = world(() => [{ name: 'Pocket', scope: 'shared', rule: 'share-of-own-income', ruleShare: 0.1 }])
    const out = run(t)
    for (const m of months) expect(value(out, pockets[0], m)).toBe(0)
    expect(out.warnings).toEqual(['"Pocket" takes a percentage of its adult\'s own income, but it does not belong to an adult.'])
    expectBalanced(t, out)
  })

  it('a share of own income is pocket money\'s alone: on a transfer to an account it is ignored', () => {
    const { t, r } = world(() => [])
    const toSavings = t.rows.find((x) => x.id === r.toSavings.id)!
    Object.assign(toSavings, { rule: 'share-of-own-income', ruleShare: 0.5 })
    expect(resolveRules(run(t).rows, 'savings-plug').byRow.has(toSavings.id)).toBe(false)
  })

  it('a month with a typed amount shows the typed amount, whatever the rule says', () => {
    const { t, pockets } = world(({ ana }) => [{ name: 'Ana – Pocket', scope: ana, rule: 'share-of-own-income', ruleShare: 0.1 }])
    t.cells.push(cellValue(pockets[0].id, '2026-01', 40000))
    const out = run(t)
    expect(value(out, pockets[0], '2026-01')).toBe(40000)
    expect(value(out, pockets[0], '2026-02')).toBe(25000)
  })

  it('a row from before rules still reads the household\'s pocket total, until it gets a rule', () => {
    const old = (scope: string) => ({ scope, pocketMode: 'share-of-pocket-total' as const, pocketShare: 0.5 })
    const { t, pockets } = world(({ ana, ben }) => [{ name: 'Ana – Pocket', ...old(ana) }, { name: 'Ben – Pocket', ...old(ben), rule: 'share-of-income', ruleShare: 0.02 }], { household: { pocketTotal: 100000 } })
    t.monthStates.push(closedMonth('2026-01', { pocketTotalOverride: 80000 }))
    const out = run(t)
    expect(value(out, pockets[0], '2026-01')).toBe(40000) // the total the month was closed with
    expect(value(out, pockets[0], '2026-02')).toBe(50000)
    expect(value(out, pockets[1], '2026-02')).toBe(10500) // its own rule, not the total
    expectBalanced(t, out)
  })

  it('the Statement shows the rule on the pocket line', () => {
    const { t, pockets } = world(({ ana, ben }) => [
      { name: 'Ana – Pocket', scope: ana, rule: 'share-of-own-income', ruleShare: 0.1 },
      { name: 'Ben – Pocket', scope: ben },
    ])
    const s = buildStatement(t, run(t), '2026-02')!
    const lines = walk(s.flow.right.lines)
    expect(lines.find((l) => l.rowId === pockets[0].id)?.rule).toEqual({ kind: 'share-of-own-income', share: 0.1, rowId: pockets[0].id })
    expect(lines.find((l) => l.rowId === pockets[0].id)?.automatic).toBe(true)
    expect(lines.find((l) => l.rowId === pockets[1].id)?.rule).toEqual({ kind: 'fixed', share: undefined, rowId: pockets[1].id })
  })
})
