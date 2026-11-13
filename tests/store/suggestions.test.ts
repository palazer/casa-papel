import { describe, expect, it } from 'vitest'
import { cellKey, computeEngine } from '@/engine'
import { monthRange, newId } from '@/model'
import {
  CasaDb, Store, accountSuggestions, addAccount, addEntity, addPool, addRow, addSuggestion, applyTemplates, closeMonth, createHouseholdFromSetup,
  dismissSuggestion, loadTables, removeThing, rowSuggestions, setRule, setupFocus, setupSteps, shownRowSuggestions, stepSuggestions, suggestionId, updateRow,
} from '@/store'

/** What the first screen makes: the household, its people and things, the usual categories. No accounts, no rows. */
async function fresh() {
  const store = new Store(new CasaDb(`test-${newId()}`))
  await createHouseholdFromSetup(store, {
    household: { name: 'T', baseCurrency: 'EUR', locale: 'en-IE', startMonth: '2026-09', closingRule: 'leftover-plug', setupOpen: true },
    adults: [{ name: 'Sam' }, { name: 'Alex' }],
    dependents: [{ kind: 'child', name: 'Robin' }, { kind: 'property', name: 'The flat' }, { kind: 'vehicle', name: 'The car' }],
    accounts: [], householdTemplates: [], entityTemplates: {},
  })
  return store
}
const titles = (xs: Array<{ title: string }>) => xs.map((x) => x.title)

describe('suggestions for setting up on the Statement', () => {
  it('offers the rows of every person and thing where they will appear, the usual ones first', async () => {
    const store = await fresh()
    const t = await loadTables(store)
    expect(t.rows).toHaveLength(0)
    expect(t.accounts).toHaveLength(0)
    const all = rowSuggestions(t)
    const at = (place: string, usual = true) => titles(all.filter((s) => s.place === place && s.usual === usual))
    expect(at('income')).toEqual(['Sam – Salary', 'Alex – Salary', 'Robin – Child benefit', 'Other income'])
    expect(at('income', false)).toEqual(['Sam – Extra income', 'Alex – Extra income'])
    const housing = t.categories.find((c) => c.name === 'Housing')!
    expect(at(`cat:expense:${housing.id}`)).toEqual(['The flat – Rent or mortgage', 'The flat – Utilities'])
    expect(at(`cat:expense:${housing.id}`, false)).toEqual(['The flat – Internet & phone', 'The flat – Home improvement', 'The flat – Home insurance'])
    // no category of that name: the foot of Expenses, where the pocket lines sit too
    expect(at('expenses')).toEqual(['Sam – Pocket', 'Alex – Pocket', 'Other'])
    // a loan payment and a child's long-term savings sit with what is set aside and paid off, and wait for their account
    const setAside = all.filter((s) => s.place === 'set-aside')
    expect(setAside.map((s) => [s.title, s.needs, s.usual])).toEqual([['Robin – Long-term savings', 'investment', false], ['The car – Loan or lease', 'loan', false]])
    // transfers into savings and investments come from the account's rule, never from a suggestion
    expect(titles(all)).not.toContain('To savings')
    expect(titles(all)).not.toContain('To investments')
    // a virtual account lives in a savings account
    expect(all.find((s) => s.title === 'Travel')).toMatchObject({ pool: true, needs: 'savings', usual: true })
    expect(accountSuggestions(t).map((a) => [a.name, a.type])).toEqual([['Main account', 'checking'], ['Savings', 'savings']])
  })

  it('adds a suggestion with its first amount in the month on screen, and does not offer it again', async () => {
    const store = await fresh()
    const t0 = await loadTables(store)
    const sam = t0.entities.find((e) => e.name === 'Sam')!
    const salary = await addSuggestion(store, suggestionId(sam.id, 'a.salary'), { amount: 4200_00, month: '2026-10' })
    expect(salary).toMatchObject({ name: 'Sam – Salary', section: 'income', kind: 'salary', templateKey: 'a.salary', scope: sam.id, defaultStatus: 'committed' })
    let t = await loadTables(store)
    const out = computeEngine({ tables: t, months: monthRange('2026-09', '2026-12') })
    expect(out.cells[cellKey(salary.id, '2026-09')].value).toBe(0)
    expect(out.cells[cellKey(salary.id, '2026-10')].value).toBe(4200_00)
    expect(out.cells[cellKey(salary.id, '2026-12')].value).toBe(4200_00)
    expect(titles(rowSuggestions(t))).not.toContain('Sam – Salary')
    expect(titles(rowSuggestions(t))).toContain('Alex – Salary')
    // renamed, it is still the row its suggestion made
    await updateRow(store, salary.id, { name: 'Sam – Net pay' })
    expect(titles(rowSuggestions(await loadTables(store)))).not.toContain('Sam – Salary')
    // without an amount the row is added empty; one undo takes a suggested row back
    const rent = await addSuggestion(store, suggestionId(t0.entities.find((e) => e.name === 'The flat')!.id, 'r.rent'))
    t = await loadTables(store)
    expect(t.cells.filter((c) => c.rowId === rent.id)).toHaveLength(0)
    expect(rent.categoryId).toBe(t.categories.find((c) => c.name === 'Housing')!.id)
    await store.undo()
    expect(titles(rowSuggestions(await loadTables(store)))).toContain('The flat – Rent or mortgage')
    // deleted, a row is suggested again
    await removeThing(store, { kind: 'row', id: salary.id })
    expect(titles(rowSuggestions(await loadTables(store)))).toContain('Sam – Salary')
    await expect(addSuggestion(store, 'household:h.nothing')).rejects.toThrow(/no longer there/)
  })

  it('a row made before suggestions carried their key counts by its name', async () => {
    const store = await fresh()
    await addRow(store, { name: 'groceries', section: 'expense' })
    const t = await loadTables(store)
    expect(t.rows[0].templateKey).toBeNull()
    expect(titles(rowSuggestions(t))).not.toContain('Groceries')
    // the same name in another section is another row
    await addRow(store, { name: 'Other', section: 'income' })
    expect(titles(rowSuggestions(await loadTables(store)))).toContain('Other')
  })

  it('a dismissed suggestion is left out of what the Statement lists, usual rows first, and can still be added', async () => {
    const store = await fresh()
    await dismissSuggestion(store, 'household:h.groceries')
    await dismissSuggestion(store, 'household:h.groceries')
    let t = await loadTables(store)
    expect(t.household[0].dismissedSuggestions).toEqual(['household:h.groceries'])
    expect(rowSuggestions(t).find((s) => s.title === 'Groceries')).toMatchObject({ usual: false, dismissed: true })
    const shown = shownRowSuggestions(t)
    expect(shown.some((s) => s.title === 'Groceries')).toBe(false)
    expect(shown.length).toBe(rowSuggestions(t).length - 1)
    // every usual row comes before the first rarer one
    expect(shown.map((s) => s.usual).join('')).toMatch(/^(true)*(false)*$/)
    const row = await addSuggestion(store, 'household:h.groceries', { amount: 600_00 })
    expect(row.name).toBe('Groceries')
    await dismissSuggestion(store, 'account:checking')
    t = await loadTables(store)
    expect(accountSuggestions(t).map((a) => a.name)).toEqual(['Savings'])
  })

  it('a suggestion that needs an account waits for it; a pool one makes its virtual account; a pocket line is typed', async () => {
    const store = await fresh()
    await expect(addSuggestion(store, 'household:h.poolTravel', { amount: 200_00 })).rejects.toThrow(/needs a savings account/)
    const savings = await addAccount(store, { name: 'Savings', type: 'savings', currency: 'EUR', openingMonth: '2026-09', openingBalance: 9000_00 })
    let t = await loadTables(store)
    expect(accountSuggestions(t).map((a) => a.name)).toEqual(['Main account'])
    expect(rowSuggestions(t).find((s) => s.title === 'Travel')?.needs).toBeNull()
    const travel = await addSuggestion(store, 'household:h.poolTravel', { amount: 200_00 })
    t = await loadTables(store)
    expect(t.pools).toHaveLength(1)
    expect(t.pools[0]).toMatchObject({ name: 'Travel', accountId: savings.id })
    expect(travel.defaultFundedBy).toBe(`pool:${t.pools[0].id}`)
    // the amount is what is set aside each month, so it sits on the virtual account's own row
    const out = computeEngine({ tables: t, months: monthRange('2026-09', '2026-10') })
    expect(out.cells[cellKey(t.pools[0].allocationRowId!, '2026-10')].value).toBe(200_00)
    expect(out.cells[cellKey(travel.id, '2026-10')].value).toBe(0)

    // a child's long-term savings goes into the child's own fund when there is one
    const robin = t.entities.find((e) => e.name === 'Robin')!
    await addAccount(store, { name: 'Index fund', type: 'investment', currency: 'EUR', openingMonth: '2026-09' })
    const own = await addAccount(store, { name: 'Robin fund', type: 'investment', currency: 'EUR', openingMonth: '2026-09', ownerEntityId: robin.id })
    const longterm = await addSuggestion(store, suggestionId(robin.id, 'c.longterm'), { amount: 50_00 })
    expect(longterm).toMatchObject({ kind: 'to-investment', accountId: own.id })

    // pocket money: an amount of its own for each adult, typed like any other
    const sam = t.entities.find((e) => e.name === 'Sam')!
    const pocket = await addSuggestion(store, suggestionId(sam.id, 'a.pocket'), { amount: 300_00 })
    expect(pocket).toMatchObject({ kind: 'pocket-money', pocketMode: 'fixed', pocketShare: null, scope: sam.id })
    t = await loadTables(store)
    const month = computeEngine({ tables: t, months: monthRange('2026-09', '2026-10') })
    expect(month.cells[cellKey(pocket.id, '2026-10')].value).toBe(300_00)
    expect(month.totals['2026-10'].pocket).toBe(300_00)
    // the Household screen's own "Suggested rows" makes the same kind of line, and counts as the same suggestion
    const alex = t.entities.find((e) => e.name === 'Alex')!
    await applyTemplates(store, ['a.pocket'], alex.id)
    t = await loadTables(store)
    expect(t.rows.find((r) => r.name === 'Alex – Pocket')).toMatchObject({ pocketMode: 'fixed', pocketShare: null, templateKey: 'a.pocket' })
    expect(titles(rowSuggestions(t))).not.toContain('Alex – Pocket')
  })

  it('an amount cannot start in a closed month or before the first one', async () => {
    const store = await fresh()
    await expect(addSuggestion(store, 'household:h.groceries', { amount: 100_00, month: '2026-08' })).rejects.toThrow(/starts in 2026-09/)
    await expect(addSuggestion(store, 'household:h.groceries', { amount: -1 })).rejects.toThrow(/below zero/)
    await closeMonth(store, '2026-09')
    await expect(addSuggestion(store, 'household:h.groceries', { amount: 100_00, month: '2026-09' })).rejects.toThrow(/closed/)
    // without an amount nothing is written into the month, so the row can still be added
    expect((await addSuggestion(store, 'household:h.groceries', { month: '2026-09' })).name).toBe('Groceries')
  })

  it('a new person or thing brings its own suggestions; an archived one takes them away', async () => {
    const store = await fresh()
    const rex = await addEntity(store, { kind: 'pet', name: 'Rex' })
    const t = await loadTables(store)
    expect(titles(rowSuggestions(t).filter((s) => s.entityId === rex.id && s.usual))).toEqual(['Rex – Insurance', 'Rex – Food & supplies'])
    const archived = { ...t, entities: t.entities.map((e) => (e.id === rex.id ? { ...e, archivedMonth: '2026-10' } : e)) }
    expect(rowSuggestions(archived).filter((s) => s.entityId === rex.id)).toEqual([])
  })

  it('the six setup steps tick themselves as the page fills, and nothing takes the rest until an account is given it', async () => {
    const store = await fresh()
    const done = async () => Object.fromEntries(setupSteps(await loadTables(store)).map((s) => [s.key, s.done]))
    // savings comes before the virtual accounts, which sit inside a savings account
    expect(setupSteps(await loadTables(store)).map((s) => [s.key, s.label])).toEqual([
      ['income', 'Income'], ['expenses', 'Expenses'], ['savings', 'Savings'], ['virtual', 'Virtual accounts'], ['investments', 'Investments'], ['debts', 'Loans and cards'],
    ])
    expect(await done()).toEqual({ income: false, expenses: false, savings: false, virtual: false, investments: false, debts: false })
    await addSuggestion(store, 'household:h.otherIncome', { amount: 1000_00 })
    await addSuggestion(store, 'household:h.groceries', { amount: 400_00 })
    expect(await done()).toMatchObject({ income: true, expenses: true, savings: false })
    const savings = await addAccount(store, { name: 'Savings', type: 'savings', currency: 'EUR', openingMonth: '2026-09' })
    // a savings account alone is not the step: something has to take the rest
    expect(await done()).toMatchObject({ savings: false, virtual: false })
    // the month keeps its leftover until an account takes the rest
    let t = await loadTables(store)
    let out = computeEngine({ tables: t, months: ['2026-09'] })
    expect(out.totals['2026-09']).toMatchObject({ leftover: 600_00, rest: null, toSavings: 0 })
    await setRule(store, { accountId: savings.id }, { kind: 'rest' }, '2026-09')
    expect(await done()).toMatchObject({ savings: true, virtual: false, investments: false, debts: false })
    t = await loadTables(store)
    expect(t.household[0].closingRule).toBe('savings-plug')
    out = computeEngine({ tables: t, months: ['2026-09'] })
    expect(out.totals['2026-09']).toMatchObject({ leftover: 0, rest: 600_00, toSavings: 600_00 })
    // the three kinds of account that are left: a virtual account, an investment account, a loan or a card
    await addPool(store, { name: 'Travel', accountId: savings.id, openingBalance: 0 })
    expect(await done()).toMatchObject({ virtual: true, investments: false, debts: false })
    await addAccount(store, { name: 'Fund', type: 'investment', currency: 'EUR', openingMonth: '2026-09' })
    await addAccount(store, { name: 'Visa', type: 'credit-card', currency: 'EUR', openingMonth: '2026-09' })
    expect(await done()).toEqual({ income: true, expenses: true, savings: true, virtual: true, investments: true, debts: true })
  })

  it('a step lights its part of the Statement and offers the suggestions that belong to it', async () => {
    const store = await fresh()
    // income and expenses light one group each; every step that makes an account lights its side and the second group
    expect(setupFocus('income')).toEqual({ sides: [], lines: ['income'] })
    expect(setupFocus('expenses')).toEqual({ sides: [], lines: ['expenses'] })
    for (const step of ['savings', 'virtual', 'investments'] as const) expect(setupFocus(step), step).toEqual({ sides: ['assets'], lines: ['set-aside'] })
    expect(setupFocus('debts')).toEqual({ sides: ['claims'], lines: ['set-aside'] })

    const all = shownRowSuggestions(await loadTables(store))
    const of = (step: Parameters<typeof stepSuggestions>[0]) => stepSuggestions(step, all)
    expect(of('income').length).toBeGreaterThan(0)
    expect(of('income').every((s) => s.section === 'income')).toBe(true)
    // a virtual account is not offered among the expenses: it waits for its own step
    expect(of('expenses').length).toBeGreaterThan(0)
    expect(of('expenses').some((s) => s.pool)).toBe(false)
    expect(titles(of('virtual'))).toEqual(['Travel', 'Clothing', 'Entertainment & dining out'])
    expect(of('savings')).toEqual([])
    // nothing is offered twice, and nothing of the page is lost: only what the second group offers for another step is left out
    const offered = [...of('income'), ...of('expenses'), ...of('virtual'), ...of('investments'), ...of('debts')]
    expect(new Set(offered.map((s) => s.id)).size).toBe(offered.length)
    expect(all.filter((s) => !offered.includes(s)).every((s) => s.place === 'set-aside')).toBe(true)
  })
})
