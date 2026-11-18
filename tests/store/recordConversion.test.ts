import { describe, expect, it } from 'vitest'
import { conversionCurrency } from '@/engine'
import { RowSchema, accountRef, newId, type CellItem, type Conversion, type Row } from '@/model'
import { CasaDb, Store, addAccount, addRow, addRowOfKind, currencyHeldReason, loadTables, quickCreateHousehold, setCellItems, setCellValue, updateRow } from '@/store'

/**
 * Where "Record the conversion…" is offered (rule X10): wherever money is really changed into another currency on its
 * way, and nowhere else. And a row keeps its currency while one of its months holds a recorded conversion.
 */
async function fresh() {
  const store = new Store(new CasaDb(`test-${newId()}`))
  await quickCreateHousehold(store, { name: 'Test', baseCurrency: 'EUR', locale: 'en-IE', startMonth: '2026-01' })
  const dollars = await addAccount(store, { name: 'Dollar savings', type: 'savings', currency: 'USD', openingMonth: '2026-01', openingBalance: 1100_00 })
  const pounds = await addAccount(store, { name: 'Pound savings', type: 'savings', currency: 'GBP', openingMonth: '2026-01', openingBalance: 800_00 })
  return { store, dollars, pounds }
}
const of = (rows: Row[], name: string) => rows.find((r) => r.name === name)!

describe('the other currency of a conversion', () => {
  it('is there wherever money is changed on its way, and nowhere else', async () => {
    const { store, dollars, pounds } = await fresh()
    await addRow(store, { name: 'Dollar pay', section: 'income', categoryId: null, currency: 'USD' })
    await addRow(store, { name: 'Dollar bill', section: 'expense', categoryId: null, currency: 'USD' })
    await addRow(store, { name: 'Dollar bill from dollars', section: 'expense', categoryId: null, currency: 'USD', defaultFundedBy: accountRef(dollars.id) })
    await addRow(store, { name: 'Euro bill from dollars', section: 'expense', categoryId: null, defaultFundedBy: accountRef(dollars.id) })
    await addRow(store, { name: 'Euro bill', section: 'expense', categoryId: null })
    await addRowOfKind(store, { section: 'transfer', name: 'To dollars', categoryId: null, kind: 'plain', accountId: dollars.id })
    const t = await loadTables(store)
    // stored before rule X15: three currencies, so nothing to record
    const old = RowSchema.parse({ ...of(t.rows, 'Dollar bill'), id: newId(), name: 'Old', defaultFundedBy: accountRef(pounds.id) })
    const tables = { ...t, rows: [...t.rows, old] }
    const say = (name: string) => conversionCurrency(tables, of(tables.rows, name))
    expect(say('Dollar pay')).toBe('USD')
    expect(say('Dollar bill')).toBe('USD')
    expect(say('Euro bill from dollars')).toBe('USD')
    expect(say('To dollars')).toBe('USD')
    expect(say('Dollar bill from dollars')).toBeNull()
    expect(say('Euro bill')).toBeNull()
    expect(say('Old')).toBeNull()
    // an item paid otherwise than the row: its own source counts
    expect(conversionCurrency(tables, of(tables.rows, 'Euro bill'), accountRef(dollars.id))).toBe('USD')
    expect(conversionCurrency(tables, of(tables.rows, 'Dollar bill from dollars'), 'cash')).toBe('USD')
  })
})

describe('a row with a recorded conversion keeps its currency', () => {
  const PAY: Conversion = { foreign: 'USD', foreignAmount: 3300_00, homeAmount: 3000_00, rate: 1.1, date: null }
  const item = (over: Partial<CellItem> = {}): CellItem =>
    ({ id: newId(), label: '', amount: 3300_00, status: 'done', fundedBy: 'cash', date: null, note: null, recurringItemId: null, kind: 'normal', skipped: false, conversion: PAY, ...over })

  it('from the row menu and from the dialog, with the month named; without one it changes as before', async () => {
    const { store } = await fresh()
    const pay = await addRow(store, { name: 'Dollar pay', section: 'income', categoryId: null, currency: 'USD' })
    await setCellItems(store, pay.id, '2026-03', [item()], 'this-month')
    const said = '"Dollar pay" has a conversion recorded in Mar 2026, so its currency stays USD. Remove the conversion there first.'
    expect(currencyHeldReason(await loadTables(store), pay.id, 'GBP')).toBe(said)
    expect(currencyHeldReason(await loadTables(store), pay.id, 'USD')).toBeNull()
    await expect(updateRow(store, pay.id, { currency: null })).rejects.toThrow(said)
    await expect(setCellValue(store, pay.id, '2026-04', 100_00, 'from-now-on', { currency: 'GBP' })).rejects.toThrow(said)
    // removed, the currency can change again
    await setCellItems(store, pay.id, '2026-03', [item({ conversion: undefined })], 'this-month')
    await updateRow(store, pay.id, { currency: 'GBP' })
  })

  it('names how many months hold one, and the first', async () => {
    const { store } = await fresh()
    const pay = await addRow(store, { name: 'Dollar pay', section: 'income', categoryId: null, currency: 'USD' })
    await setCellItems(store, pay.id, '2026-05', [item()], 'this-month')
    await setCellItems(store, pay.id, '2026-02', [item()], 'this-month')
    expect(currencyHeldReason(await loadTables(store), pay.id, null)).toBe('"Dollar pay" has a conversion recorded in 2 months, the first Feb 2026, so its currency stays USD. Remove the conversion there first.')
  })
})
