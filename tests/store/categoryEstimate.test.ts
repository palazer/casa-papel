import { describe, expect, it } from 'vitest'
import { cellKey, computeEngine } from '@/engine'
import { monthRange, newId } from '@/model'
import {
  CasaDb, Store, addCategory, deleteCategory, derivedRowReason, describeRemoval, estimateRowOf, loadTables, removeThing, renameCategory, setCategoryEstimate, setRowCategory,
} from '@/store'
import { DEMO_IDS } from '@/demo/demoHousehold'
import { loadDemo } from '@/demo/loadDemo'

const months = monthRange('2026-09', '2027-02')

async function world() {
  const store = new Store(new CasaDb(`test-${newId()}`))
  await loadDemo(store)
  const read = async () => {
    const tables = await loadTables(store)
    return { tables, out: computeEngine({ tables, months }) }
  }
  return { store, read }
}

describe('a category\'s estimate in the store', () => {
  it('makes the estimate row on first use and counts the rest from that month on', async () => {
    const { store, read } = await world()
    // Housing in the demo: Utilities carries 210 forward; Rent is on a schedule and not posted in this test
    const row = await setCategoryEstimate(store, DEMO_IDS.catHousing, '2026-11', 2000_00)
    expect(row).toMatchObject({ name: 'Housing – Not broken down yet', section: 'expense', kind: 'category-estimate', categoryId: DEMO_IDS.catHousing, defaultStatus: 'projected' })
    const { tables, out } = await read()
    expect(estimateRowOf(tables, DEMO_IDS.catHousing)?.id).toBe(row.id)
    expect(['2026-10', '2026-11', '2026-12', '2027-01'].map((m) => [out.cells[cellKey(row.id, m)].estimate, out.cells[cellKey(row.id, m)].value])).toEqual([[0, 0], [2000_00, 1790_00], [2000_00, 1790_00], [2000_00, 1790_00]])
    // it sorts at the end of its category
    expect(out.rows.filter((r) => r.categoryId === DEMO_IDS.catHousing).at(-1)?.id).toBe(row.id)
    expect(derivedRowReason(row, 'savings-plug')).toMatch(/what is left of its category's estimate/)
  })

  it('changes it for one month or from a month on, on the same row, and 0 takes it away', async () => {
    const { store, read } = await world()
    const row = await setCategoryEstimate(store, DEMO_IDS.catHousing, '2026-11', 2000_00)
    expect((await setCategoryEstimate(store, DEMO_IDS.catHousing, '2026-12', 2500_00, 'this-month')).id).toBe(row.id)
    let { tables, out } = await read()
    expect(tables.rows.filter((r) => r.kind === 'category-estimate' && !r.deletedAt)).toHaveLength(1)
    // December only: January is back at what was typed before, the estimate and not what was left of it
    expect(['2026-11', '2026-12', '2027-01', '2027-02'].map((m) => out.cells[cellKey(row.id, m)].estimate)).toEqual([2000_00, 2500_00, 2000_00, 2000_00])
    await setCategoryEstimate(store, DEMO_IDS.catHousing, '2027-02', 0)
    ;({ tables, out } = await read())
    expect(out.cells[cellKey(row.id, '2027-02')]).toMatchObject({ estimate: 0, value: 0 })
    expect(out.cells[cellKey(row.id, '2027-01')].value).toBe(1790_00)
  })

  it('a first estimate for one month only does not carry on', async () => {
    const { store, read } = await world()
    const row = await setCategoryEstimate(store, DEMO_IDS.catLiving, '2026-11', 1500_00, 'this-month')
    const { out } = await read()
    expect(['2026-11', '2026-12'].map((m) => out.cells[cellKey(row.id, m)].estimate)).toEqual([1500_00, 0])
  })

  it('refuses a closed month, an income category, an amount below zero and a category that is gone', async () => {
    const { store } = await world()
    await expect(setCategoryEstimate(store, DEMO_IDS.catHousing, '2026-09', 100_00)).rejects.toThrow(/closed/)
    await expect(setCategoryEstimate(store, DEMO_IDS.catHousing, '2026-11', -1)).rejects.toThrow(/below zero/)
    await expect(setCategoryEstimate(store, newId(), '2026-11', 100_00)).rejects.toThrow(/no longer exists/)
    const pay = await addCategory(store, { name: 'Pay', section: 'income' })
    await expect(setCategoryEstimate(store, pay.id, '2026-11', 100_00)).rejects.toThrow(/Only an expense category/)
  })

  it('a new category can start with its estimate, in one step that one undo takes back', async () => {
    const { store, read } = await world()
    const hobbies = await addCategory(store, { name: 'Hobbies', section: 'expense', estimate: { month: '2026-11', amount: 60_00 } })
    let { tables, out } = await read()
    const row = estimateRowOf(tables, hobbies.id)!
    expect(row.name).toBe('Hobbies – Not broken down yet')
    expect(['2026-10', '2026-11', '2026-12'].map((m) => out.cells[cellKey(row.id, m)].value)).toEqual([0, 60_00, 60_00])
    await store.undo()
    ;({ tables } = await read())
    expect(tables.categories.some((c) => c.id === hobbies.id && !c.deletedAt)).toBe(false)
    expect(tables.rows.some((r) => r.id === row.id && !r.deletedAt)).toBe(false)
    // without an amount it is the plain category it always was
    const plain = await addCategory(store, { name: 'Sports', section: 'expense', estimate: { month: '2026-11', amount: 0 } })
    expect(estimateRowOf((await read()).tables, plain.id)).toBeUndefined()
  })

  it('follows its category: renamed with it, removed with it, and it cannot be moved out of it', async () => {
    const { store, read } = await world()
    const row = await setCategoryEstimate(store, DEMO_IDS.catHousing, '2026-11', 2000_00)
    await renameCategory(store, DEMO_IDS.catHousing, 'Home')
    expect((await read()).tables.rows.find((r) => r.id === row.id)?.name).toBe('Home – Not broken down yet')
    await expect(setRowCategory(store, row.id, DEMO_IDS.catLiving)).rejects.toThrow(/stays with it/)

    // the remove dialog names the estimate among what is lost, and the rows keep their place
    const impact = describeRemoval((await read()).tables, { kind: 'category', id: DEMO_IDS.catHousing })
    expect(impact.loses).toEqual(['its estimate, in every month'])
    expect(impact.changes[0]).toMatch(/keep their place without a category/)
    expect(impact.changes[0]).not.toMatch(/Not broken down yet/)
    await removeThing(store, { kind: 'category', id: DEMO_IDS.catHousing })
    let { tables, out } = await read()
    expect(tables.rows.find((r) => r.id === row.id)?.deletedAt).not.toBeNull()
    expect(tables.rows.find((r) => r.id === DEMO_IDS.rowUtilities)).toMatchObject({ categoryId: null, deletedAt: null })
    expect(out.cells[cellKey(row.id, '2026-11')]).toBeUndefined()

    // the plain action does the same
    const living = await setCategoryEstimate(store, DEMO_IDS.catLiving, '2026-11', 900_00)
    await deleteCategory(store, DEMO_IDS.catLiving)
    ;({ tables, out } = await read())
    expect(tables.rows.find((r) => r.id === living.id)?.deletedAt).not.toBeNull()
    expect(tables.rows.find((r) => r.id === DEMO_IDS.rowGroceries)).toMatchObject({ categoryId: null, deletedAt: null })
  })
})
