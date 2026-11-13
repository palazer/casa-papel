import { generateKeyBetween, generateNKeysBetween } from 'fractional-indexing'
import { CategorySchema, DEFAULT_CATEGORIES, RowSchema, newId, type Category, type Money, type MonthKey, type Section, type Tables } from '@/model'
import type { Mutation, Store } from './store'
import { categoryEstimateMutations, categoryPlacement, estimateRowName, estimateRowOf, loadTables } from './actions'

const now = () => Date.now()
const live = (cs: Category[]) => cs.filter((c) => !c.deletedAt)
const byOrder = (a: Category, b: Category) => (a.order < b.order ? -1 : a.order > b.order ? 1 : 0)

function assertName(tables: Tables, section: Section, name: string, exceptId?: string): string {
  const n = name.trim()
  if (!n) throw new Error('Give the category a name.')
  if (live(tables.categories).some((c) => c.section === section && c.id !== exceptId && c.name.toLowerCase() === n.toLowerCase())) {
    throw new Error(`There is already a category called "${n}" in this section.`)
  }
  return n
}

function findCategory(tables: Tables, id: string): Category {
  const c = tables.categories.find((x) => x.id === id && !x.deletedAt)
  if (!c) throw new Error('That category no longer exists.')
  return c
}

/**
 * A new category at the end of its section, optionally taking rows of that section with it. An expense category can
 * start with an estimate ("Hobbies, 60 a month"): it then counts from `estimate.month` on before it has a single row.
 */
export async function addCategory(store: Store, input: { name: string; section: Section; rowIds?: string[]; estimate?: { month: MonthKey; amount: Money } }): Promise<Category> {
  const tables = await loadTables(store)
  const name = assertName(tables, input.section, input.name)
  const ts = now()
  const last = live(tables.categories).filter((c) => c.section === input.section).map((c) => c.order).sort().at(-1) ?? null
  const category = CategorySchema.parse({ id: newId(), createdAt: ts, updatedAt: ts, name, section: input.section, order: generateKeyBetween(last, null) })
  const mutations: Mutation[] = [{ op: 'put', table: 'categories', record: category }]
  for (const id of input.rowIds ?? []) {
    const row = tables.rows.find((r) => r.id === id && !r.deletedAt)
    if (!row) continue
    if (row.section !== input.section) throw new Error(`"${row.name}" is not in this section.`)
    mutations.push({ op: 'put', table: 'rows', record: RowSchema.parse({ ...row, categoryId: category.id, updatedAt: ts }) })
  }
  if (input.estimate && input.estimate.amount > 0) {
    if (tables.monthStates.find((s) => s.month === input.estimate!.month)?.closed) throw new Error(`${input.estimate.month} is closed. Reopen it to edit.`)
    mutations.push(...categoryEstimateMutations({ ...tables, categories: [...tables.categories, category] }, category, input.estimate.month, input.estimate.amount, 'from-now-on').mutations)
  }
  await store.commit(mutations)
  return category
}

export async function renameCategory(store: Store, id: string, name: string): Promise<void> {
  const tables = await loadTables(store)
  const cat = findCategory(tables, id)
  const n = assertName(tables, cat.section, name, id)
  if (n === cat.name) return
  const ts = now()
  const mutations: Mutation[] = [{ op: 'put', table: 'categories', record: CategorySchema.parse({ ...cat, name: n, updatedAt: ts }) }]
  // the estimate's row is named after its category, so it follows the new name (unless someone renamed it by hand)
  const estimate = estimateRowOf(tables, id)
  if (estimate && estimate.name === estimateRowName(cat)) mutations.push({ op: 'put', table: 'rows', record: RowSchema.parse({ ...estimate, name: estimateRowName({ name: n }), updatedAt: ts }) })
  await store.commit(mutations)
}

export async function moveCategory(store: Store, id: string, direction: 'up' | 'down'): Promise<void> {
  const tables = await loadTables(store)
  const cat = findCategory(tables, id)
  const list = live(tables.categories).filter((c) => c.section === cat.section).sort(byOrder)
  const i = list.findIndex((c) => c.id === id)
  const j = direction === 'up' ? i - 1 : i + 1
  if (j < 0 || j >= list.length) return
  const far = direction === 'up' ? list[j - 1]?.order ?? null : list[j + 1]?.order ?? null
  const order = direction === 'up' ? generateKeyBetween(far, list[j].order) : generateKeyBetween(list[j].order, far)
  await store.commit([{ op: 'put', table: 'categories', record: CategorySchema.parse({ ...cat, order, updatedAt: now() }) }])
}

/** Remove a category. Its rows keep their place in the section, just without one; its estimate goes with it. One undoable commit. */
export async function deleteCategory(store: Store, id: string): Promise<void> {
  const tables = await loadTables(store)
  const cat = findCategory(tables, id)
  const ts = now()
  const mutations: Mutation[] = [{ op: 'put', table: 'categories', record: CategorySchema.parse({ ...cat, deletedAt: ts, updatedAt: ts }) }]
  for (const row of tables.rows) {
    if (row.deletedAt || row.categoryId !== id) continue
    mutations.push({ op: 'put', table: 'rows', record: RowSchema.parse(row.kind === 'category-estimate' ? { ...row, deletedAt: ts, updatedAt: ts } : { ...row, categoryId: null, updatedAt: ts }) })
  }
  await store.commit(mutations)
}

/** Put a row into a category of its own section, or into none; it joins at the end of that group. */
export async function setRowCategory(store: Store, rowId: string, categoryId: string | null): Promise<void> {
  const tables = await loadTables(store)
  const row = tables.rows.find((r) => r.id === rowId && !r.deletedAt)
  if (!row) throw new Error('Row not found')
  if (categoryId) {
    const cat = findCategory(tables, categoryId)
    if (cat.section !== row.section) throw new Error(`"${cat.name}" belongs to another section.`)
  }
  if ((row.categoryId ?? null) === categoryId) return
  await store.commit([{ op: 'put', table: 'rows', record: RowSchema.parse({ ...row, ...categoryPlacement(tables, row, categoryId), updatedAt: now() }) }])
}

/** The usual expense categories, skipping names the household already has (case does not matter). Pure. */
export function buildDefaultCategoryMutations(existing: Category[], ts: number): { mutations: Mutation[]; categories: Category[] } {
  const expense = live(existing).filter((c) => c.section === 'expense')
  const have = new Set(expense.map((c) => c.name.toLowerCase()))
  const names = DEFAULT_CATEGORIES.filter((n) => !have.has(n.toLowerCase()))
  const last = expense.map((c) => c.order).sort().at(-1) ?? null
  const orders = generateNKeysBetween(last, null, names.length)
  const categories = names.map((name, i) => CategorySchema.parse({ id: newId(), createdAt: ts, updatedAt: ts, name, section: 'expense', order: orders[i] }))
  return { mutations: categories.map((c): Mutation => ({ op: 'put', table: 'categories', record: c })), categories }
}

/** "Add the usual categories": returns how many were added. */
export async function seedDefaultCategories(store: Store): Promise<number> {
  const tables = await loadTables(store)
  const { mutations } = buildDefaultCategoryMutations(tables.categories, now())
  if (mutations.length) await store.commit(mutations)
  return mutations.length
}
