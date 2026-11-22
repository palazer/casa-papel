import { describe, expect, it } from 'vitest'
import { buildTrends, computeEngine } from '@/engine'
import { monthRange, newId } from '@/model'
import { CasaDb, Store, addPlanYear, defaultMonths, keepHouse, loadTables, projectTables, trendMonths } from '@/store'
import { loadDemo } from '@/demo/loadDemo'

const TODAY = '2026-11'

async function demoStore() {
  const store = new Store(new CasaDb(`test-${newId()}`))
  await loadDemo(store)
  // the schedules as the app leaves them on that day
  await keepHouse(store, TODAY)
  return store
}

describe('how far the Trends page looks', () => {
  it('"Plan" is the plan\'s months; a number of years reaches the December that many years after this one', async () => {
    const store = await demoStore()
    const tables = await loadTables(store)
    const household = tables.household[0]
    expect(trendMonths(household, tables, 'plan', TODAY)).toEqual(defaultMonths(household, tables, TODAY))
    expect(trendMonths(household, tables, 3, TODAY)).toEqual(monthRange('2026-09', '2029-12'))
    expect(trendMonths(household, tables, 10, TODAY).at(-1)).toBe('2036-12')
    // never shorter than the plan
    const long = { ...household, planUntil: '2031-12' }
    expect(trendMonths(long, tables, 3, TODAY).at(-1)).toBe('2031-12')
  })

  it('looking no further than the plan changes nothing', async () => {
    const tables = await loadTables(await demoStore())
    expect(projectTables(tables, defaultMonths(tables.household[0], tables, TODAY), TODAY)).toBe(tables)
  })

  it('a year past the plan\'s end is what "Add <year>" gives, schedules included, and nothing is saved', async () => {
    const store = await demoStore()
    const before = await loadTables(store)
    const household = before.household[0]
    const planned = defaultMonths(household, before, TODAY)
    expect(planned.at(-1)).toBe('2027-12')
    const months = monthRange('2026-09', '2028-12')
    const projected = projectTables(before, months, TODAY)
    const looked = buildTrends(projected, computeEngine({ tables: projected, months }), months)
    expect((await loadTables(store)).cells).toHaveLength(before.cells.length)

    // the plan really grows by that year
    await addPlanYear(store, TODAY)
    await keepHouse(store, TODAY)
    const after = await loadTables(store)
    expect(defaultMonths(after.household[0], after, TODAY)).toEqual(months)
    const real = buildTrends(after, computeEngine({ tables: after, months }), months)
    expect(looked.points).toEqual(real.points)

    // and the schedules are what made the difference: without them the rent stops with the plan
    const bare = buildTrends(before, computeEngine({ tables: before, months }), months)
    expect(bare.points.at(-1)!.totals.expenses).toBeLessThan(real.points.at(-1)!.totals.expenses)
  })
})
