import { describe, expect, it } from 'vitest'
import { cellKey, computeEngine } from '@/engine'
import { monthRange, newId } from '@/model'
import {
  CasaDb, Store, addAccount, addEntity, applyTemplates, buildSetupMutations, createHouseholdFromSetup, loadTables, setAccountActual, setCellDone, setCellValue,
} from '@/store'

const setup = {
  household: { name: 'Palaz', baseCurrency: 'EUR', locale: 'de-DE', startMonth: '2026-11', pocketTotal: 120000 },
  adults: [{ name: 'A' }, { name: 'B' }],
  dependents: [{ kind: 'child' as const, name: 'Kid', paidByIndex: 1 }, { kind: 'pet' as const, name: 'Dog' }],
  accounts: [{ name: 'Main', type: 'checking' as const }, { name: 'Savings', type: 'savings' as const, openingBalance: 500000 }, { name: 'ETF', type: 'investment' as const }],
  householdTemplates: ['h.groceries', 'h.toSavings', 'h.toInvestments', 'h.poolTravel'],
  entityTemplates: { 0: ['a.salary', 'a.pocket'], 1: ['a.salary', 'a.pocket', 'a.personal'], 2: ['c.benefit', 'c.longterm'], 3: ['p.food'] },
}

describe('setup and household actions', () => {
  it('builds a complete household in one commit', async () => {
    const store = new Store(new CasaDb(`test-${newId()}`))
    await createHouseholdFromSetup(store, setup)
    const t = await loadTables(store)
    expect(t.entities.map((e) => e.name)).toEqual(['A', 'B', 'Kid', 'Dog'])
    expect(t.entities[2].paidBy).toBe(t.entities[1].id)
    expect(t.accounts.find((a) => a.type === 'savings')).toMatchObject({ tracked: true, openingBalance: 500000 })
    const names = t.rows.map((r) => r.name)
    expect(names).toEqual(expect.arrayContaining(['A – Salary', 'Pocket – A', 'B – Personal', 'Child benefit – Kid', 'Long-term savings – Kid', 'Food & supplies – Dog', 'Groceries', 'To savings', 'To investments', 'Travel', 'Travel pool']))
    expect(t.pools).toHaveLength(1)
    const travel = t.rows.find((r) => r.name === 'Travel')!
    expect(travel.defaultFundedBy).toBe(`pool:${t.pools[0].id}`)
    expect(t.rows.find((r) => r.name === 'To savings')?.accountId).toBe(t.accounts.find((a) => a.type === 'savings')?.id)
    expect(t.rows.find((r) => r.name === 'Long-term savings – Kid')).toMatchObject({ kind: 'to-investment', scope: t.entities[2].id })
    const pocket = t.rows.find((r) => r.name === 'Pocket – A')!
    expect(pocket.pocketShare).toBeCloseTo(0.5)
    const out = computeEngine({ tables: t, months: monthRange('2026-11', '2026-12') })
    expect(out.cells[cellKey(pocket.id, '2026-11')].value).toBe(60000)
    expect(await store.db.events.count()).toBeGreaterThan(10)
    await store.undo()
    expect(await store.db.household.count()).toBe(0)
  })

  it('skips pocket rows in proportional mode', () => {
    const { mutations } = buildSetupMutations({ ...setup, household: { ...setup.household, moneyMode: 'proportional' } })
    const rows = mutations.filter((m) => m.op === 'put' && m.table === 'rows').map((m) => (m as { record: { name: string } }).record.name)
    expect(rows.some((n) => n.startsWith('Pocket'))).toBe(false)
    expect(rows).toContain('A – Salary')
  })

  it('adds entities, accounts, templates and actual balances later', async () => {
    const store = new Store(new CasaDb(`test-${newId()}`))
    await createHouseholdFromSetup(store, { ...setup, dependents: [], entityTemplates: {} })
    const car = await addEntity(store, { kind: 'vehicle', name: 'Volvo' })
    await applyTemplates(store, ['v.insurance', 'v.fuel'], car.id)
    const t = await loadTables(store)
    expect(t.rows.filter((r) => r.entityTags.includes(car.id)).map((r) => r.name)).toEqual(['Insurance – Volvo', 'Fuel & parking – Volvo'])

    const card = await addAccount(store, { name: 'Amex', type: 'credit-card', currency: 'EUR', openingMonth: '2026-11' })
    expect(card.tracked).toBe(true)
    const savings = t.accounts.find((a) => a.type === 'savings')!
    await setAccountActual(store, savings.id, '2026-11', 777777)
    const out = computeEngine({ tables: await loadTables(store), months: ['2026-11'] })
    expect(out.accounts[savings.id].months['2026-11'].balance).toBe(777777)
    await setAccountActual(store, savings.id, '2026-11', null)
    expect((await loadTables(store)).accountMonths).toHaveLength(0)
  })

  it('setCellDone turns a value into a done item and back', async () => {
    const store = new Store(new CasaDb(`test-${newId()}`))
    await createHouseholdFromSetup(store, { ...setup, dependents: [], entityTemplates: {} })
    const groceries = (await loadTables(store)).rows.find((r) => r.name === 'Groceries')!
    await setCellValue(store, groceries.id, '2026-11', 50000, 'from-now-on')
    await setCellDone(store, groceries.id, '2026-11', true)
    let out = computeEngine({ tables: await loadTables(store), months: ['2026-11', '2026-12'] })
    expect(out.cells[cellKey(groceries.id, '2026-11')]).toMatchObject({ value: 50000, status: 'done', source: 'items' })
    expect(out.cells[cellKey(groceries.id, '2026-12')].value).toBe(50000)
    await setCellDone(store, groceries.id, '2026-11', false)
    out = computeEngine({ tables: await loadTables(store), months: ['2026-11'] })
    expect(out.cells[cellKey(groceries.id, '2026-11')].status).toBe('projected')
  })
})
