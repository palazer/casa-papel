import { describe, expect, it } from 'vitest'
import { amountUnits } from '@/engine'
import { RowSchema, accountRef, newId, poolRef, type CellItem } from '@/model'
import {
  CasaDb, Store, addAccount, addPool, addRecurringItem, addRow, addRowOfKind, followRow, loadTables, quickCreateHousehold, saveRowMonth, setCellItems, setCellValue,
  setRowFundedBy, thirdCurrencyReason, updateAccount, updatePool, updateRecurringItem, updateRow,
} from '@/store'

/**
 * Rule X15: no amount across three currencies. In a euro household a pound expense comes out of an account in pounds
 * or in euros; a euro amount moves money between the current accounts and an account in one other currency at most.
 * Every writer that can name a currency, an account or a source refuses a change that would bring a third one in.
 */
const item = (amount: number, over: Partial<CellItem> = {}): CellItem =>
  ({ id: newId(), label: '', amount, status: 'committed', fundedBy: 'cash', date: null, note: null, recurringItemId: null, kind: 'normal', skipped: false, ...over })

async function fresh() {
  const store = new Store(new CasaDb(`test-${newId()}`))
  await quickCreateHousehold(store, { name: 'Test', baseCurrency: 'EUR', locale: 'en-IE', startMonth: '2026-01' })
  const dollars = await addAccount(store, { name: 'Dollar savings', type: 'savings', currency: 'USD', openingMonth: '2026-01', openingBalance: 1100_00 })
  const pounds = await addAccount(store, { name: 'Pound savings', type: 'savings', currency: 'GBP', openingMonth: '2026-01', openingBalance: 800_00 })
  const hotel = await addRow(store, { name: 'London hotel', section: 'expense', categoryId: null, currency: 'GBP' })
  await setCellValue(store, hotel.id, '2026-01', 80_00, 'from-now-on')
  return { store, dollars, pounds, hotel }
}
const HOTEL_FROM_DOLLARS = '"London hotel" is in GBP, so it can come out of an account in GBP or in EUR. "Dollar savings" is in USD.'

describe('the accounts an amount moves money out of or into', () => {
  it('an expense has one amount per source, a row that moves money one', async () => {
    const { store, dollars, pounds, hotel } = await fresh()
    await setCellItems(store, hotel.id, '2026-02', [item(50_00), item(30_00, { fundedBy: accountRef(pounds.id) })], 'this-month')
    const move = await addRowOfKind(store, { section: 'transfer', name: 'To dollars', categoryId: null, kind: 'plain', accountId: dollars.id })
    const t = await loadTables(store)
    const units = (id: string) => amountUnits(t, t.rows.find((r) => r.id === id)!).map((u) => [u.key, u.currency, u.ends.map((e) => `${e.way} ${e.account.name}`)])
    expect(units(hotel.id)).toEqual([['cash', 'GBP', []], [accountRef(pounds.id), 'GBP', ['out-of Pound savings']]])
    expect(units(move.id)).toEqual([['row', 'EUR', ['into Dollar savings']]])
  })
})

describe('a change that brings in a third currency is refused', () => {
  it('a new source for the row', async () => {
    const { store, dollars, hotel } = await fresh()
    await expect(setRowFundedBy(store, hotel.id, accountRef(dollars.id), 'all-months')).rejects.toThrow(HOTEL_FROM_DOLLARS)
  })

  it('an item of the month from that account, saved from the dialog either way', async () => {
    const { store, dollars, hotel } = await fresh()
    await expect(setCellItems(store, hotel.id, '2026-02', [item(80_00, { fundedBy: accountRef(dollars.id) })], 'this-month')).rejects.toThrow(HOTEL_FROM_DOLLARS)
    await expect(saveRowMonth(store, hotel.id, '2026-02', { items: [item(80_00, { fundedBy: accountRef(dollars.id) })], scope: 'this-month' })).rejects.toThrow(HOTEL_FROM_DOLLARS)
    // the same items from the month's income are fine
    await setCellItems(store, hotel.id, '2026-02', [item(80_00)], 'this-month')
  })

  it('a new row that names both', async () => {
    const { store, dollars } = await fresh()
    await expect(addRow(store, { name: 'Paris hotel', section: 'expense', categoryId: null, currency: 'GBP', defaultFundedBy: accountRef(dollars.id) }))
      .rejects.toThrow('"Paris hotel" is in GBP, so it can come out of an account in GBP or in EUR. "Dollar savings" is in USD.')
  })

  it('the row\'s currency, from the row menu or with the month in its dialog', async () => {
    const { store, dollars } = await fresh()
    const hosting = await addRow(store, { name: 'Hosting', section: 'expense', categoryId: null, currency: 'USD', defaultFundedBy: accountRef(dollars.id) })
    const said = '"Hosting" comes out of "Dollar savings", in USD, so it can be in USD or in EUR.'
    await expect(updateRow(store, hosting.id, { currency: 'GBP' })).rejects.toThrow(said)
    await expect(setCellValue(store, hosting.id, '2026-01', 100_00, 'from-now-on', { currency: 'GBP' })).rejects.toThrow(said)
    // to the household's currency is two currencies again
    await updateRow(store, hosting.id, { currency: null })
  })

  it('a schedule paid from that account, made or changed', async () => {
    const { store, dollars, hotel } = await fresh()
    await expect(addRecurringItem(store, { name: 'Breakfast', rowId: hotel.id, amount: 20_00, startMonth: '2026-01', cadence: { intervalMonths: 1, anchorMonth: 1 }, fundedBy: accountRef(dollars.id) }))
      .rejects.toThrow(HOTEL_FROM_DOLLARS)
    const breakfast = await addRecurringItem(store, { name: 'Breakfast', rowId: hotel.id, amount: 20_00, startMonth: '2026-01', cadence: { intervalMonths: 1, anchorMonth: 1 } })
    await expect(updateRecurringItem(store, breakfast.id, { fundedBy: accountRef(dollars.id) })).rejects.toThrow(HOTEL_FROM_DOLLARS)
  })

  it('the currency of an account an amount comes out of', async () => {
    const { store, dollars } = await fresh()
    await addRow(store, { name: 'Hosting', section: 'expense', categoryId: null, currency: 'USD', defaultFundedBy: accountRef(dollars.id) })
    await expect(updateAccount(store, dollars.id, { currency: 'GBP' })).rejects.toThrow('"Hosting" is in USD and comes out of "Dollar savings", so "Dollar savings" can be in USD or in EUR.')
    // in euros the account takes two currencies: the expense's and the household's
    await updateAccount(store, dollars.id, { currency: 'EUR' })
  })

  it('a virtual account moved to a savings account in a third currency', async () => {
    const { store, pounds } = await fresh()
    const savings = (await loadTables(store)).accounts.find((a) => a.type === 'savings' && a.currency === 'EUR')!
    const holidays = await addPool(store, { name: 'Holidays', accountId: savings.id, openingBalance: 0, monthlyAllocation: 0, fromMonth: '2026-01' })
    await addRow(store, { name: 'New York', section: 'expense', categoryId: null, currency: 'USD', defaultFundedBy: poolRef(holidays.id) })
    await expect(updatePool(store, holidays.id, { accountId: pounds.id })).rejects.toThrow('"New York" is in USD, so it can come out of an account in USD or in EUR. "Pound savings" is in GBP.')
  })

  it('a row that follows one in another currency takes that currency', async () => {
    const { store, pounds } = await fresh()
    const pay = await addRow(store, { name: 'Dollar pay', section: 'income', categoryId: null, currency: 'USD' })
    const salary = (await loadTables(store)).rows.find((r) => r.name === 'Salary')!
    const tax = await addRowOfKind(store, { section: 'transfer', name: 'Tax', categoryId: null, kind: 'plain', accountId: pounds.id })
    await followRow(store, tax.id, salary.id, 0.25)
    await expect(followRow(store, tax.id, pay.id, 0.25)).rejects.toThrow('"Tax" goes into "Pound savings", in GBP, so it can follow a row in GBP or in EUR. "Dollar pay" is in USD.')
    // and the other way round: the row it follows changes its currency
    await expect(updateRow(store, salary.id, { currency: 'USD' })).rejects.toThrow('"Tax" goes into "Pound savings", in GBP, so it can follow a row in GBP or in EUR. "Salary" is in USD.')
  })

  it('in the household\'s currency, between accounts in two others', async () => {
    const { store, dollars } = await fresh()
    const card = await addAccount(store, { name: 'Pound card', type: 'credit-card', currency: 'GBP', openingMonth: '2026-01', openingBalance: 0 })
    const taxi = await addRow(store, { name: 'Taxi', section: 'expense', categoryId: null, accountId: card.id })
    await expect(setRowFundedBy(store, taxi.id, accountRef(dollars.id), 'all-months'))
      .rejects.toThrow('"Taxi" comes out of "Pound card", in GBP, so it can come out of an account in GBP or in EUR. "Dollar savings" is in USD.')
  })

  it('a refused change writes nothing', async () => {
    const { store, dollars, hotel } = await fresh()
    const before = await loadTables(store)
    await expect(setRowFundedBy(store, hotel.id, accountRef(dollars.id), 'all-months')).rejects.toThrow()
    expect((await loadTables(store)).rows).toEqual(before.rows)
  })
})

describe('what was stored before the rule keeps counting', () => {
  /** "London hotel" was set to come out of the dollar account by an older version. */
  async function old() {
    const f = await fresh()
    const row = (await loadTables(f.store)).rows.find((r) => r.id === f.hotel.id)!
    await f.store.commit([{ op: 'put', table: 'rows', record: RowSchema.parse({ ...row, defaultFundedBy: accountRef(f.dollars.id), updatedAt: Date.now() }) }])
    return f
  }

  it('a change that adds no currency to it is saved', async () => {
    const { store, hotel } = await old()
    await setCellValue(store, hotel.id, '2026-03', 95_00, 'from-now-on')
    await updateRow(store, hotel.id, { name: 'Hotel in London' })
    await updateRow(store, hotel.id, { currency: 'USD' })
    expect((await loadTables(store)).rows.find((r) => r.id === hotel.id)).toMatchObject({ name: 'Hotel in London', currency: 'USD' })
  })

  it('a change that brings in yet another currency is refused', async () => {
    const { store, hotel } = await old()
    await expect(updateRow(store, hotel.id, { currency: 'CHF' })).rejects.toThrow('"London hotel" comes out of "Dollar savings", in USD, so it can be in USD or in EUR.')
  })
})

describe('the dialogs ask before saving', () => {
  it('the sentence, or nothing for a change that is allowed', async () => {
    const { store, dollars, pounds, hotel } = await fresh()
    const tables = await loadTables(store)
    const row = tables.rows.find((r) => r.id === hotel.id)!
    const withSource = (fundedBy: string) => [{ op: 'put' as const, table: 'rows' as const, record: RowSchema.parse({ ...row, defaultFundedBy: fundedBy }) }]
    expect(thirdCurrencyReason(tables, withSource(accountRef(dollars.id)))).toBe(HOTEL_FROM_DOLLARS)
    expect(thirdCurrencyReason(tables, withSource(accountRef(pounds.id)))).toBeNull()
    expect(thirdCurrencyReason(tables, withSource('cash'))).toBeNull()
  })
})
