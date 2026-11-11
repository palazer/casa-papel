import { describe, expect, it } from 'vitest'
import { cellKey, computeEngine } from '@/engine'
import { monthRange, newId, poolRef } from '@/model'
import {
  CasaDb, Store, addAccount, addEntity, addPool, addRow, closeMonth, derivedRowReason, followRow, loadTables, quickCreateHousehold, setCellValue, setRowAccount, setRowDeductedFrom, setRowFundedBy, setRowScope,
} from '@/store'

const months = monthRange('2026-01', '2026-04')

async function fresh() {
  const store = new Store(new CasaDb(`test-${newId()}`))
  await quickCreateHousehold(store, { name: 'T', baseCurrency: 'EUR', locale: 'en-IE', startMonth: '2026-01' })
  const t = await loadTables(store)
  const savings = t.accounts.find((a) => a.type === 'savings')!
  const salary = t.rows.find((r) => r.name === 'Salary')!
  const rent = t.rows.find((r) => r.name === 'Rent')!
  const toSavings = t.rows.find((r) => r.kind === 'to-savings')!
  return { store, savings, salary, rent, toSavings }
}

async function engine(store: Store) {
  return computeEngine({ tables: await loadTables(store), months })
}

describe('setRowFundedBy', () => {
  it('from a month on: earlier months are pinned to the old source, later ones draw the virtual account', async () => {
    const { store, savings } = await fresh()
    const pool = await addPool(store, { name: 'Travel', accountId: savings.id, openingBalance: 100000 })
    const trips = await addRow(store, { name: 'Trips', section: 'expense' })
    await setCellValue(store, trips.id, '2026-01', 30000, 'from-now-on')
    await closeMonth(store, '2026-01')
    await setRowFundedBy(store, trips.id, poolRef(pool.id), { from: '2026-03' })

    const t = await loadTables(store)
    expect(t.rows.find((r) => r.id === trips.id)?.defaultFundedBy).toBe(poolRef(pool.id))
    const jan = t.cells.find((c) => c.rowId === trips.id && c.month === '2026-01')!
    const feb = t.cells.find((c) => c.rowId === trips.id && c.month === '2026-02')!
    expect(jan.mode).toBe('items')
    expect(jan.items).toHaveLength(1)
    expect(jan.items[0]).toMatchObject({ amount: 30000, fundedBy: 'cash', label: '' })
    expect(feb.items[0]).toMatchObject({ amount: 30000, fundedBy: 'cash', status: 'projected' })
    expect(t.cells.find((c) => c.rowId === trips.id && c.month === '2026-03')).toBeUndefined()

    const out = computeEngine({ tables: t, months })
    expect(months.map((m) => out.cells[cellKey(trips.id, m)].value)).toEqual([30000, 30000, 30000, 30000])
    expect(months.map((m) => out.totals[m].poolFundedByPool[pool.id] ?? 0)).toEqual([0, 0, 30000, 30000])
    expect(months.map((m) => out.totals[m].cashExpense)).toEqual([30000, 30000, 0, 0])
    expect(out.pools[pool.id].months['2026-02'].balance).toBe(100000)
    expect(out.pools[pool.id].months['2026-04'].balance).toBe(40000)
    // the closed month stays closed and done
    expect(out.cells[cellKey(trips.id, '2026-01')].status).toBe('done')
  })

  it('all months: only the row changes, and the past is recomputed', async () => {
    const { store } = await fresh()
    const trips = await addRow(store, { name: 'Trips', section: 'expense' })
    await setCellValue(store, trips.id, '2026-01', 30000, 'from-now-on')
    await setRowFundedBy(store, trips.id, 'savings', 'all-months')
    const t = await loadTables(store)
    expect(t.cells.filter((c) => c.rowId === trips.id)).toHaveLength(1)
    const out = computeEngine({ tables: t, months })
    expect(months.map((m) => out.totals[m].savingsFunded)).toEqual([30000, 30000, 30000, 30000])
  })

  it('refuses non-spending rows and pools that do not exist', async () => {
    const { store, salary, rent } = await fresh()
    await expect(setRowFundedBy(store, salary.id, 'savings', 'all-months')).rejects.toThrow(/spending rows/)
    await expect(setRowFundedBy(store, rent.id, poolRef(newId()), 'all-months')).rejects.toThrow(/no longer exists/)
  })
})

describe('followRow', () => {
  it('mirrors another row and can be undone', async () => {
    const { store, salary, rent, toSavings } = await fresh()
    const fund = await addAccount(store, { name: 'Fund', type: 'investment', currency: 'EUR', openingMonth: '2026-01' })
    const longTerm = await addRow(store, { name: 'Long-term', section: 'transfer', kind: 'to-investment', accountId: fund.id })
    await setCellValue(store, salary.id, '2026-01', 300000, 'from-now-on')
    await followRow(store, longTerm.id, salary.id)
    let out = await engine(store)
    expect(out.cells[cellKey(longTerm.id, '2026-02')]).toMatchObject({ value: 300000, source: 'derived' })

    await expect(followRow(store, longTerm.id, longTerm.id)).rejects.toThrow(/itself/)
    await expect(followRow(store, rent.id, longTerm.id)).rejects.toThrow(/follows another row itself/)
    await expect(followRow(store, salary.id, rent.id)).rejects.toThrow(/already follows/)
    await expect(followRow(store, rent.id, toSavings.id)).rejects.toThrow(/worked out by the app/)
    await expect(followRow(store, toSavings.id, rent.id)).rejects.toThrow(/cannot follow/)
    expect(derivedRowReason(toSavings, 'leftover-plug')).toBeNull()

    await followRow(store, longTerm.id, null)
    out = await engine(store)
    expect(out.cells[cellKey(longTerm.id, '2026-02')]).toMatchObject({ value: 0, source: 'empty' })
    await store.undo()
    expect((await loadTables(store)).rows.find((r) => r.id === longTerm.id)?.followsRowId).toBe(salary.id)
  })
})

describe('setRowAccount', () => {
  it('checks the account type the row kind needs', async () => {
    const { store, savings, rent, toSavings } = await fresh()
    const fund = await addAccount(store, { name: 'Fund', type: 'investment', currency: 'EUR', openingMonth: '2026-01' })
    const longTerm = await addRow(store, { name: 'Long-term', section: 'transfer', kind: 'to-investment' })
    await expect(setRowAccount(store, longTerm.id, savings.id)).rejects.toThrow(/needs an account of type Investments, and "Savings" is of type Savings/)
    await expect(setRowAccount(store, longTerm.id, null)).rejects.toThrow(/needs an account of type Investments/)
    await expect(setRowAccount(store, longTerm.id, newId())).rejects.toThrow(/no longer exists/)
    await setRowAccount(store, longTerm.id, fund.id)
    await setRowAccount(store, rent.id, null)
    await setRowAccount(store, toSavings.id, savings.id)
    const t = await loadTables(store)
    expect(t.rows.find((r) => r.id === longTerm.id)?.accountId).toBe(fund.id)
    expect(t.rows.find((r) => r.id === rent.id)?.accountId).toBeNull()
  })
})

describe('followRow with a share', () => {
  it('keeps the share with the follow and refuses a share of nothing', async () => {
    const { store, salary } = await fresh()
    const tax = await addRow(store, { name: 'Tax', section: 'expense' })
    await setCellValue(store, salary.id, '2026-01', 400000, 'from-now-on')
    await expect(followRow(store, tax.id, salary.id, 0)).rejects.toThrow(/above zero/)
    await followRow(store, tax.id, salary.id, 0.25)
    expect((await engine(store)).cells[cellKey(tax.id, '2026-02')]).toMatchObject({ value: 100000, source: 'derived' })
    // the whole amount is one state, whether typed as 100 or left alone
    await followRow(store, tax.id, salary.id, 1)
    expect((await loadTables(store)).rows.find((r) => r.id === tax.id)).toMatchObject({ followsRowId: salary.id, followShare: null })
    await followRow(store, tax.id, null, 0.25)
    expect((await loadTables(store)).rows.find((r) => r.id === tax.id)).toMatchObject({ followsRowId: null, followShare: null })
  })
})

describe('setRowDeductedFrom and setRowScope', () => {
  it('ties a spending row to an income row, gives it the same owner, and lets go again', async () => {
    const { store, salary, rent } = await fresh()
    const pat = await addEntity(store, { kind: 'adult', name: 'Pat' })
    await setRowScope(store, salary.id, pat.id)
    await setRowDeductedFrom(store, rent.id, salary.id)
    let t = await loadTables(store)
    expect(t.rows.find((r) => r.id === salary.id)).toMatchObject({ scope: pat.id, entityTags: [pat.id] })
    expect(t.rows.find((r) => r.id === rent.id)).toMatchObject({ deductedFromRowId: salary.id, scope: pat.id })
    expect(t.rows.find((r) => r.id === rent.id)!.entityTags).toContain(pat.id)

    // the income row's new owner takes its deductions along
    await setRowScope(store, salary.id, 'shared')
    t = await loadTables(store)
    expect(t.rows.find((r) => r.id === salary.id)).toMatchObject({ scope: 'shared', entityTags: [] })
    expect(t.rows.find((r) => r.id === rent.id)?.scope).toBe('shared')
    expect(t.rows.find((r) => r.id === rent.id)!.entityTags).not.toContain(pat.id)

    await setRowDeductedFrom(store, rent.id, null)
    expect((await loadTables(store)).rows.find((r) => r.id === rent.id)?.deductedFromRowId).toBeNull()
    await store.undo()
    expect((await loadTables(store)).rows.find((r) => r.id === rent.id)?.deductedFromRowId).toBe(salary.id)
  })

  it('refuses the wrong kinds of row and people who are gone', async () => {
    const { store, salary, rent } = await fresh()
    await expect(setRowDeductedFrom(store, salary.id, rent.id)).rejects.toThrow(/Only spending rows/)
    await expect(setRowDeductedFrom(store, rent.id, rent.id)).rejects.toThrow(/Pick an income row/)
    await expect(setRowDeductedFrom(store, rent.id, newId())).rejects.toThrow(/Pick an income row/)
    await expect(setRowScope(store, rent.id, newId())).rejects.toThrow(/no longer exists/)
  })
})
