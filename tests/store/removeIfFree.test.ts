import { describe, expect, it } from 'vitest'
import { newId } from '@/model'
import {
  CasaDb, Store, addAccount, addCategory, addGoal, addRow, addSuggestion, closeMonth, createHouseholdFromSetup, loadTables, removeIfFree, rowSuggestions,
  setCellValue, setRule,
} from '@/store'

/** A household that is being set up: its people and things, the usual categories, nothing else. */
async function fresh() {
  const store = new Store(new CasaDb(`test-${newId()}`))
  await createHouseholdFromSetup(store, {
    household: { name: 'T', baseCurrency: 'EUR', locale: 'en-IE', startMonth: '2026-09', closingRule: 'leftover-plug', setupOpen: true },
    adults: [{ name: 'Sam' }], dependents: [{ kind: 'property', name: 'The flat' }], accounts: [], householdTemplates: [], entityTemplates: {},
  })
  return store
}
const live = async (store: Store) => {
  const t = await loadTables(store)
  return { rows: t.rows.filter((r) => !r.deletedAt).map((r) => r.name), accounts: t.accounts.filter((a) => !a.deletedAt).map((a) => a.name), categories: t.categories.filter((c) => !c.deletedAt).map((c) => c.name), pools: t.pools.filter((p) => !p.deletedAt).map((p) => p.name) }
}

describe('the cheap delete of a household that is being set up', () => {
  it('deletes a row with its amounts in one undoable step, and its suggestion is offered again', async () => {
    const store = await fresh()
    const row = await addSuggestion(store, 'household:h.groceries', { amount: 600_00 })
    expect(rowSuggestions(await loadTables(store)).map((s) => s.title)).not.toContain('Groceries')
    expect(await removeIfFree(store, { kind: 'row', id: row.id })).toBe('Groceries')
    expect((await live(store)).rows).toEqual([])
    expect(rowSuggestions(await loadTables(store)).map((s) => s.title)).toContain('Groceries')
    await store.undo()
    const t = await loadTables(store)
    expect(t.rows.find((r) => r.id === row.id)?.deletedAt).toBeNull()
    expect(t.cells.find((c) => c.rowId === row.id && !c.deletedAt)?.value).toBe(600_00)
  })

  it('deletes a category that has no rows; one that has rows goes to the dialog, which says they are kept', async () => {
    const store = await fresh()
    const hobbies = await addCategory(store, { name: 'Hobbies', section: 'expense' })
    expect(await removeIfFree(store, { kind: 'category', id: hobbies.id })).toBe('Hobbies')
    expect((await live(store)).categories).not.toContain('Hobbies')
    const housing = (await loadTables(store)).categories.find((c) => c.name === 'Housing')!
    await addRow(store, { name: 'Rent', section: 'expense', categoryId: housing.id })
    expect(await removeIfFree(store, { kind: 'category', id: housing.id })).toBeNull()
    expect((await live(store)).categories).toContain('Housing')
  })

  it('deletes an account nothing points at; rows that use it, a virtual account in it or a goal on it go to the dialog', async () => {
    const store = await fresh()
    const spare = await addAccount(store, { name: 'Spare', type: 'savings', currency: 'EUR', openingMonth: '2026-09', openingBalance: 100_00 })
    expect(await removeIfFree(store, { kind: 'account', id: spare.id })).toBe('Spare')
    expect((await live(store)).accounts).toEqual([])

    const savings = await addAccount(store, { name: 'Savings', type: 'savings', currency: 'EUR', openingMonth: '2026-09' })
    const goal = await addGoal(store, { name: 'Cushion', kind: 'account-balance', accountId: savings.id, target: 1000_00 })
    expect(await removeIfFree(store, { kind: 'account', id: savings.id })).toBeNull()
    await removeIfFree(store, { kind: 'goal', id: goal.id })
    // the row that sends it the rest uses it
    await setRule(store, { accountId: savings.id }, { kind: 'rest' }, '2026-09')
    expect(await removeIfFree(store, { kind: 'account', id: savings.id })).toBeNull()
    // and that row is more than itself: the account would stop receiving the rest
    const toSavings = (await loadTables(store)).rows.find((r) => r.name === 'To Savings')!
    expect(await removeIfFree(store, { kind: 'row', id: toSavings.id })).toBeNull()
    // a virtual account whose spending row would lose its source
    await addSuggestion(store, 'household:h.poolTravel', { amount: 50_00 })
    const pool = (await loadTables(store)).pools[0]
    expect(await removeIfFree(store, { kind: 'pool', id: pool.id })).toBeNull()
    expect(await live(store)).toMatchObject({ accounts: ['Savings'], pools: ['Travel'] })
    expect((await live(store)).rows).toEqual(expect.arrayContaining(['To Savings', 'Travel', 'To Travel']))
  })

  it('never deletes what has amounts in a closed month', async () => {
    const store = await fresh()
    const row = await addRow(store, { name: 'Rent', section: 'expense' })
    await setCellValue(store, row.id, '2026-09', 900_00, 'this-month')
    await closeMonth(store, '2026-09')
    expect(await removeIfFree(store, { kind: 'row', id: row.id })).toBeNull()
    expect((await live(store)).rows).toEqual(['Rent'])
  })
})
