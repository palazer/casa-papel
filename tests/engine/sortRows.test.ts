import { describe, expect, it } from 'vitest'
import { groupRowsByCategory, sortRows } from '@/engine'
import { CategorySchema, newId, type Section } from '@/model'
import { T0, row } from './helpers'

const cat = (name: string, section: Section, order: string) => CategorySchema.parse({ id: newId(), createdAt: T0, updatedAt: T0, name, section, order })

describe('sortRows with categories', () => {
  const housing = cat('Housing', 'expense', 'a0')
  const living = cat('Living', 'expense', 'a1')
  const work = cat('Work', 'income', 'a0')
  const rent = row({ name: 'Rent', section: 'expense', order: 'a5', categoryId: housing.id })
  const groceries = row({ name: 'Groceries', section: 'expense', order: 'a0', categoryId: living.id })
  const health = row({ name: 'Health', section: 'expense', order: 'a2', categoryId: living.id })
  const other = row({ name: 'Other', section: 'expense', order: 'a3' })
  // a category of another section counts as none
  const wrong = row({ name: 'Wrong', section: 'expense', order: 'a7', categoryId: work.id })
  const salary = row({ name: 'Salary', section: 'income', order: 'a9', categoryId: work.id })
  const categories = [housing, living, work]

  it('sorts by section, then by the category order, then by the row order; rows without a category come last', () => {
    const sorted = sortRows([other, health, wrong, salary, groceries, rent], categories)
    expect(sorted.map((r) => r.name)).toEqual(['Salary', 'Rent', 'Groceries', 'Health', 'Other', 'Wrong'])
  })

  it('without categories keeps the plain order', () => {
    expect(sortRows([other, health, groceries, rent]).map((r) => r.name)).toEqual(['Groceries', 'Health', 'Other', 'Rent'])
  })

  it('a removed category counts as none', () => {
    const gone = { ...living, deletedAt: T0 }
    expect(sortRows([other, groceries, rent], [housing, gone]).map((r) => r.name)).toEqual(['Rent', 'Groceries', 'Other'])
  })

  it('cuts a section into groups with alternating bands; rows without a category come last and never carry one', () => {
    const expense = sortRows([other, health, wrong, groceries, rent], categories)
    const groups = groupRowsByCategory(expense, categories)
    expect(groups.map((g) => [g.category?.name ?? null, g.rows.map((r) => r.name), g.band])).toEqual([
      ['Housing', ['Rent'], true],
      ['Living', ['Groceries', 'Health'], false],
      [null, ['Other', 'Wrong'], false],
    ])
    const third = cat('Transport', 'expense', 'a2')
    const bus = row({ name: 'Bus', section: 'expense', order: 'a0', categoryId: third.id })
    const withThird = groupRowsByCategory(sortRows([bus, ...expense], [...categories, third]), [...categories, third])
    expect(withThird.map((g) => g.band)).toEqual([true, false, true, false])
  })
})
