import { describe, expect, it } from 'vitest'
import { computeEngine } from '@/engine'
import { DEFAULT_CATEGORIES, monthRange, newId } from '@/model'
import {
  CasaDb, Store, addCategory, addRow, buildSetupMutations, deleteCategory, loadTables, moveCategory, moveRow, quickCreateHousehold, renameCategory,
  seedDefaultCategories, setRowCategory,
} from '@/store'

const months = monthRange('2026-01', '2026-02')

async function fresh() {
  const store = new Store(new CasaDb(`test-${newId()}`))
  await quickCreateHousehold(store, { name: 'T', baseCurrency: 'EUR', locale: 'en-IE', startMonth: '2026-01' })
  const t = await loadTables(store)
  const pick = (name: string) => t.rows.find((r) => r.name === name)!
  return { store, rent: pick('Rent'), groceries: pick('Groceries'), other: pick('Other'), salary: pick('Salary') }
}
const expenseNames = async (store: Store) => computeEngine({ tables: await loadTables(store), months }).rows.filter((r) => r.section === 'expense').map((r) => r.name)

describe('categories', () => {
  it('adds, reorders, renames and removes categories; removing keeps the rows, undo brings everything back', async () => {
    const { store, rent, groceries, other } = await fresh()
    const living = await addCategory(store, { name: 'Living', section: 'expense', rowIds: [other.id, groceries.id] })
    const housing = await addCategory(store, { name: 'Housing', section: 'expense', rowIds: [rent.id] })
    expect(await expenseNames(store)).toEqual(['Groceries', 'Other', 'Rent'])

    await moveCategory(store, housing.id, 'up')
    expect(await expenseNames(store)).toEqual(['Rent', 'Groceries', 'Other'])
    await moveCategory(store, housing.id, 'up') // already first: nothing happens
    expect(await expenseNames(store)).toEqual(['Rent', 'Groceries', 'Other'])

    await renameCategory(store, living.id, 'Daily life')
    expect((await loadTables(store)).categories.find((c) => c.id === living.id)?.name).toBe('Daily life')
    await expect(renameCategory(store, living.id, 'housing')).rejects.toThrow(/already a category/)
    await expect(addCategory(store, { name: '  ', section: 'expense' })).rejects.toThrow(/name/)
    await expect(addCategory(store, { name: 'Pay', section: 'income', rowIds: [rent.id] })).rejects.toThrow(/not in this section/)

    await deleteCategory(store, living.id)
    let t = await loadTables(store)
    expect(t.categories.find((c) => c.id === living.id)?.deletedAt).not.toBeNull()
    expect(t.rows.filter((r) => r.categoryId === living.id)).toHaveLength(0)
    expect(await expenseNames(store)).toEqual(['Rent', 'Groceries', 'Other'])
    await store.undo()
    t = await loadTables(store)
    expect(t.categories.find((c) => c.id === living.id)?.deletedAt).toBeNull()
    expect(t.rows.find((r) => r.id === groceries.id)?.categoryId).toBe(living.id)
  })

  it('setRowCategory moves a row to the end of its new group and stays inside the section', async () => {
    const { store, rent, groceries, salary } = await fresh()
    const housing = await addCategory(store, { name: 'Housing', section: 'expense', rowIds: [rent.id] })
    await setRowCategory(store, groceries.id, housing.id)
    expect(await expenseNames(store)).toEqual(['Rent', 'Groceries', 'Other'])
    await setRowCategory(store, rent.id, null)
    expect(await expenseNames(store)).toEqual(['Groceries', 'Other', 'Rent'])
    await expect(setRowCategory(store, salary.id, housing.id)).rejects.toThrow(/another section/)
    await expect(setRowCategory(store, rent.id, newId())).rejects.toThrow(/no longer exists/)
  })

  it('a row added after another inherits its category; moving stays inside the group', async () => {
    const { store, rent, groceries } = await fresh()
    const housing = await addCategory(store, { name: 'Housing', section: 'expense', rowIds: [rent.id] })
    const utilities = await addRow(store, { name: 'Utilities', section: 'expense' }, rent.id)
    expect(utilities.categoryId).toBe(housing.id)
    expect(await expenseNames(store)).toEqual(['Rent', 'Utilities', 'Groceries', 'Other'])
    await moveRow(store, rent.id, 'down')
    expect(await expenseNames(store)).toEqual(['Utilities', 'Rent', 'Groceries', 'Other'])
    await moveRow(store, rent.id, 'down') // the end of its group: nothing happens
    expect(await expenseNames(store)).toEqual(['Utilities', 'Rent', 'Groceries', 'Other'])
    await moveRow(store, groceries.id, 'up') // first of the rows without a category: nothing happens
    expect(await expenseNames(store)).toEqual(['Utilities', 'Rent', 'Groceries', 'Other'])
    const water = await addRow(store, { name: 'Water', section: 'expense', categoryId: null }, rent.id)
    expect(water.categoryId).toBeNull()
    expect(await expenseNames(store)).toEqual(['Utilities', 'Rent', 'Groceries', 'Other', 'Water'])
    await expect(addRow(store, { name: 'Bonus', section: 'income', categoryId: housing.id })).rejects.toThrow(/not in this section/)
  })

  it('seeds the usual categories once; a new household files its suggested rows into them', async () => {
    const { store } = await fresh()
    expect(await seedDefaultCategories(store)).toBe(DEFAULT_CATEGORIES.length)
    expect(await seedDefaultCategories(store)).toBe(0)
    const names = (await loadTables(store)).categories.filter((c) => !c.deletedAt).map((c) => c.name)
    expect(names).toEqual([...DEFAULT_CATEGORIES])

    const { mutations } = buildSetupMutations({
      household: { name: 'W', baseCurrency: 'EUR', locale: 'en-IE', startMonth: '2026-01', pocketTotal: 0 },
      adults: [{ name: 'A' }], dependents: [{ kind: 'pet', name: 'Dog' }],
      accounts: [{ name: 'Savings', type: 'savings' }],
      householdTemplates: ['h.groceries', 'h.transport', 'h.other', 'h.poolTravel'],
      entityTemplates: { 0: ['a.personal'], 1: ['p.food'] },
    })
    const categories = mutations.filter((m) => m.op === 'put' && m.table === 'categories').map((m) => (m as { record: { id: string; name: string } }).record)
    const rows = mutations.filter((m) => m.op === 'put' && m.table === 'rows').map((m) => (m as { record: { name: string; categoryId: string | null } }).record)
    const catName = (id: string | null) => categories.find((c) => c.id === id)?.name ?? null
    expect(categories.map((c) => c.name)).toEqual([...DEFAULT_CATEGORIES])
    expect(Object.fromEntries(rows.map((r) => [r.name, catName(r.categoryId)]))).toMatchObject({
      Groceries: 'Living', Transport: 'Transport', Other: null, Travel: 'Fun', 'To Travel': null, 'A – Personal': 'Personal', 'Dog – Food & supplies': 'Family & pets',
    })
  })
})
