import { describe, expect, it } from 'vitest'
import { cellKey, computeEngine } from '@/engine'
import { accountRef, monthRange, newId, poolRef, type CellItem } from '@/model'
import {
  CasaDb, Store, addAccount, addPool, addRecurringItem, addRow, archiveAccount, archivePool, closeMonth, describeRemoval, loadTables, postRecurring, quickCreateHousehold,
  removeAccount, removeIfFree, setCellItems, setCellValue, setRowAccount, setRowFundedBy,
} from '@/store'
import { fundingOptions } from '@/features/grid/funding'

const months = monthRange('2026-01', '2026-04')
const OPTS = { today: '2026-03', locale: 'en-IE' }

/** A fresh household (one savings account that takes the rest) with a second savings account and an expense row. */
async function fresh() {
  const store = new Store(new CasaDb(`test-${newId()}`))
  await quickCreateHousehold(store, { name: 'T', baseCurrency: 'EUR', locale: 'en-IE', startMonth: '2026-01' })
  const t = await loadTables(store)
  const savings = t.accounts.find((a) => a.type === 'savings')!
  const rainy = await addAccount(store, { name: 'Rainy day', type: 'savings', currency: 'EUR', openingMonth: '2026-01', openingBalance: 3000_00 })
  const school = await addRow(store, { name: 'School', section: 'expense' })
  return { store, savings, rainy, school, salary: t.rows.find((r) => r.name === 'Salary')! }
}

const item = (amount: number, fundedBy: CellItem['fundedBy'], label = ''): CellItem =>
  ({ id: newId(), label, amount, status: 'committed', fundedBy, date: null, note: null, recurringItemId: null, kind: 'normal', skipped: false })

describe('"Comes out of" an account: the list', () => {
  it('offers this month\'s income, every account that can pay under its kind, then the virtual accounts', async () => {
    const { store, savings, rainy } = await fresh()
    const fund = await addAccount(store, { name: 'Index fund', type: 'investment', currency: 'EUR', openingMonth: '2026-01' })
    const deposit = await addAccount(store, { name: 'Rental deposit', type: 'other-asset', currency: 'EUR', openingMonth: '2026-01' })
    await addAccount(store, { name: 'Visa', type: 'credit-card', currency: 'EUR', openingMonth: '2026-01' })
    await addAccount(store, { name: 'Car loan', type: 'loan', currency: 'EUR', openingMonth: '2026-01' })
    const travel = await addPool(store, { name: 'Travel', accountId: savings.id })
    const t = await loadTables(store)
    expect(fundingOptions(t)).toEqual([
      { value: 'cash', label: "This month's income" },
      { value: accountRef(savings.id), label: `Savings account: ${savings.name}` },
      { value: accountRef(rainy.id), label: 'Savings account: Rainy day' },
      { value: accountRef(fund.id), label: 'Investment account: Index fund' },
      { value: accountRef(deposit.id), label: 'Other asset: Rental deposit' },
      { value: poolRef(travel.id), label: 'Virtual account: Travel' },
    ])
  })

  it('shows what was set to the old "Savings balance" under the first savings account\'s name, without rewriting it', async () => {
    const { store, savings, rainy } = await fresh()
    const t = await loadTables(store)
    // the account's entry carries the old value while something still says it: the select shows it, and saving changes nothing
    expect(fundingOptions(t, ['savings']).slice(1)).toEqual([
      { value: 'savings', label: `Savings account: ${savings.name}` },
      { value: accountRef(rainy.id), label: 'Savings account: Rainy day' },
    ])
    // both ways of saying that account in one dialog: each keeps its entry
    expect(fundingOptions(t, ['savings', accountRef(savings.id)]).slice(1, 3)).toEqual([
      { value: 'savings', label: `Savings balance (${savings.name})` },
      { value: accountRef(savings.id), label: `Savings account: ${savings.name}` },
    ])
    // a household without a savings account keeps the old name, and only while something says it
    const bare = { ...t, accounts: t.accounts.filter((a) => a.type !== 'savings') }
    expect(fundingOptions(bare, ['savings'])).toEqual([{ value: 'cash', label: "This month's income" }, { value: 'savings', label: 'Savings balance' }])
    expect(fundingOptions(bare)).toEqual([{ value: 'cash', label: "This month's income" }])
  })

  it('keeps an archived account in the list only while the row or an item still names it', async () => {
    const { store, rainy } = await fresh()
    await archiveAccount(store, rainy.id, '2026-03')
    const t = await loadTables(store)
    expect(fundingOptions(t).map((o) => o.value)).not.toContain(accountRef(rainy.id))
    expect(fundingOptions(t, [accountRef(rainy.id)]).map((o) => o.label)).toContain('Savings account: Rainy day')
  })
})

describe('"Comes out of" an account: the row\'s default', () => {
  it('from a month on: earlier months keep the month\'s income, later ones lower the account', async () => {
    const { store, rainy, school } = await fresh()
    await setCellValue(store, school.id, '2026-01', 300_00, 'from-now-on')
    await setRowFundedBy(store, school.id, accountRef(rainy.id), { from: '2026-03' })
    const t = await loadTables(store)
    expect(t.rows.find((r) => r.id === school.id)?.defaultFundedBy).toBe(accountRef(rainy.id))
    const out = computeEngine({ tables: t, months })
    expect(months.map((m) => out.totals[m].accountFundedByAccount[rainy.id] ?? 0)).toEqual([0, 0, 300_00, 300_00])
    expect(months.map((m) => out.accounts[rainy.id].months[m].balance)).toEqual([3000_00, 3000_00, 2700_00, 2400_00])
    expect(out.cells[cellKey(school.id, '2026-02')].funding).toMatchObject({ cash: 300_00, accounts: {} })
  })

  it('refuses an account an expense cannot come out of, one that is gone and one that is archived', async () => {
    const { store, rainy, school } = await fresh()
    const t = await loadTables(store)
    const current = t.accounts.find((a) => a.type === 'checking' || a.type === 'joint') ?? await addAccount(store, { name: 'Current', type: 'checking', currency: 'EUR', openingMonth: '2026-01' })
    const visa = await addAccount(store, { name: 'Visa', type: 'credit-card', currency: 'EUR', openingMonth: '2026-01' })
    await expect(setRowFundedBy(store, school.id, accountRef(current.id), 'all-months')).rejects.toThrow(/cannot come straight out of/)
    await expect(setRowFundedBy(store, school.id, accountRef(visa.id), 'all-months')).rejects.toThrow(/cannot come straight out of "Visa"/)
    await expect(setRowFundedBy(store, school.id, accountRef(newId()), 'all-months')).rejects.toThrow(/no longer exists/)
    await archiveAccount(store, rainy.id, '2026-03')
    await expect(setRowFundedBy(store, school.id, accountRef(rainy.id), 'all-months')).rejects.toThrow(/is archived/)
    expect((await loadTables(store)).rows.find((r) => r.id === school.id)?.defaultFundedBy).toBe('cash')
  })
})

describe('"Comes out of" an account: removing the account', () => {
  it('deleting it moves what came out of it to the month\'s income, in one write per row and schedule', async () => {
    const { store, rainy, school } = await fresh()
    // the row both names the account and comes out of it
    await setRowAccount(store, school.id, rainy.id)
    await setRowFundedBy(store, school.id, accountRef(rainy.id), 'all-months')
    const boiler = await addRow(store, { name: 'Boiler', section: 'expense' })
    await setCellItems(store, boiler.id, '2026-02', [item(900_00, accountRef(rainy.id), 'New boiler'), item(50_00, 'cash', 'Fitting')], 'this-month')
    const fee = await addRecurringItem(store, { name: 'Term fee', rowId: school.id, amount: 200_00, startMonth: '2026-01', fundedBy: accountRef(rainy.id), accountId: rainy.id })
    await postRecurring(store, months)
    let t = await loadTables(store)

    const impact = describeRemoval(t, { kind: 'account', id: rainy.id }, OPTS)
    expect(impact).toMatchObject({ canDelete: true, blockers: [] })
    expect(impact.changes).toEqual([
      '"School" no longer names it as the paying account',
      '1 schedule no longer names it',
      '"School" comes out of the month\'s income instead',
      'What came out of it in 4 months counts as spent from that month\'s income, so the leftover there falls',
      '1 schedule comes out of the month\'s income instead',
    ])
    // more than the account itself changes, so it is never removed without the dialog
    expect(await removeIfFree(store, { kind: 'account', id: rainy.id })).toBeNull()

    await removeAccount(store, rainy.id)
    t = await loadTables(store)
    expect(t.rows.find((r) => r.id === school.id)).toMatchObject({ accountId: null, defaultFundedBy: 'cash' })
    expect(t.recurringItems.find((r) => r.id === fee.id)).toMatchObject({ accountId: null, fundedBy: 'cash' })
    expect(t.cells.flatMap((c) => c.items).filter((i) => i.fundedBy === accountRef(rainy.id))).toEqual([])
    const out = computeEngine({ tables: t, months })
    expect(months.map((m) => out.totals[m].accountFunded)).toEqual([0, 0, 0, 0])
    expect(out.totals['2026-02'].cashExpense).toBeGreaterThanOrEqual(900_00 + 50_00 + 200_00)

    await store.undo()
    t = await loadTables(store)
    expect(t.rows.find((r) => r.id === school.id)).toMatchObject({ accountId: rainy.id, defaultFundedBy: accountRef(rainy.id) })
  })

  it('an account that paid in a closed month can only be archived, tracked or not', async () => {
    const { store, school } = await fresh()
    const stash = await addAccount(store, { name: 'Stash', type: 'other-asset', currency: 'EUR', openingMonth: '2026-01', tracked: false })
    await setCellItems(store, school.id, '2026-01', [item(120_00, accountRef(stash.id))], 'this-month')
    await closeMonth(store, '2026-01')
    const impact = describeRemoval(await loadTables(store), { kind: 'account', id: stash.id }, OPTS)
    expect(impact).toMatchObject({ canDelete: false, canArchive: true, closedHistory: 'Jan 2026' })
    await expect(removeAccount(store, stash.id)).rejects.toThrow(/closed months/)
  })

  it('archiving it moves what came out of it to the month\'s income from that month on; earlier months keep the account', async () => {
    const { store, savings, rainy, school } = await fresh()
    const travel = await addPool(store, { name: 'Travel', accountId: rainy.id, openingBalance: 500_00 })
    const trips = await addRow(store, { name: 'Trips', section: 'expense' })
    await setRowFundedBy(store, trips.id, poolRef(travel.id), 'all-months')
    await setCellValue(store, trips.id, '2026-01', 50_00, 'from-now-on')
    await setRowFundedBy(store, school.id, accountRef(rainy.id), 'all-months')
    await setCellValue(store, school.id, '2026-01', 300_00, 'from-now-on')
    const boiler = await addRow(store, { name: 'Boiler', section: 'expense' })
    // one cell that both the account and its virtual account paid into
    await setCellItems(store, boiler.id, '2026-03', [item(900_00, accountRef(rainy.id)), item(40_00, poolRef(travel.id)), item(10_00, accountRef(savings.id))], 'this-month')

    const impact = describeRemoval(await loadTables(store), { kind: 'account', id: rainy.id }, { ...OPTS, archiveFrom: '2026-03' })
    expect(impact.archiveChanges.at(-1)).toBe('From Mar 2026, "School" and "Trips" come out of the month\'s income; earlier months keep the account as their source')

    await archiveAccount(store, rainy.id, '2026-03')
    const t = await loadTables(store)
    expect(t.rows.find((r) => r.id === school.id)?.defaultFundedBy).toBe('cash')
    expect(t.rows.find((r) => r.id === trips.id)?.defaultFundedBy).toBe('cash')
    // the cell keeps what another account paid, and loses both sources that are gone
    expect(t.cells.find((c) => c.rowId === boiler.id && c.month === '2026-03')?.items.map((i) => i.fundedBy)).toEqual(['cash', 'cash', accountRef(savings.id)])
    const out = computeEngine({ tables: t, months })
    expect(months.map((m) => out.totals[m].accountFundedByAccount[rainy.id] ?? 0)).toEqual([300_00, 300_00, 0, 0])
    expect(months.map((m) => out.totals[m].poolFundedByPool[travel.id] ?? 0)).toEqual([50_00, 50_00, 0, 0])
    expect(out.accounts[rainy.id].months['2026-02'].balance).toBe(3000_00 - 2 * 350_00)
    expect(out.accounts[rainy.id].months['2026-03']).toBeUndefined()
  })

  it('a removed virtual account hands its spending to the account it was held in, not to the first savings account', async () => {
    const { store, savings, rainy } = await fresh()
    const travel = await addPool(store, { name: 'Travel', accountId: rainy.id, openingBalance: 500_00 })
    const trips = await addRow(store, { name: 'Trips', section: 'expense' })
    await setRowFundedBy(store, trips.id, poolRef(travel.id), 'all-months')
    await setCellValue(store, trips.id, '2026-01', 50_00, 'from-now-on')
    const before = computeEngine({ tables: await loadTables(store), months })
    await archivePool(store, travel.id, '2026-03')
    const t = await loadTables(store)
    expect(t.rows.find((r) => r.id === trips.id)?.defaultFundedBy).toBe(accountRef(rainy.id))
    const out = computeEngine({ tables: t, months })
    // the same money leaves the same account as before; the first savings account is not touched
    expect(months.map((m) => out.accounts[rainy.id].months[m].balance)).toEqual(months.map((m) => before.accounts[rainy.id].months[m].balance))
    expect(months.map((m) => out.accounts[savings.id].months[m].balance)).toEqual(months.map((m) => before.accounts[savings.id].months[m].balance))
  })
})
