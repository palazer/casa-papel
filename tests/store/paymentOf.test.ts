import { describe, expect, it } from 'vitest'
import { buildPayments, computeEngine } from '@/engine'
import { addMonths, dateOn, methodOf, monthOfDate, monthRange, newId, payContext, payDayOf, type CellItem, type Tables } from '@/model'
import {
  CasaDb, Store, addAccount, addPaymentMethod, addRecurringItem, addRow, loadTables, quickCreateHousehold, setCellItems, setCellValue, setItemStatus,
  setPaymentOf, updatePaymentMethod,
} from '@/store'

/**
 * The "Payment" dialog's save (`setPaymentOf`): one amount's day and method, written for the row, for one item of a
 * month, or for a schedule from a month on. It writes a day and a method and nothing else.
 */

const START = '2026-01'
const month = monthOfDate()
const before = addMonths(month, -1)
const next = addMonths(month, 1)

async function fresh() {
  const store = new Store(new CasaDb(`test-${newId()}`))
  await quickCreateHousehold(store, { name: 'T', baseCurrency: 'EUR', locale: 'en-IE', startMonth: START })
  await addAccount(store, { name: 'Main', type: 'checking', currency: 'EUR', openingMonth: START })
  const sepa = await addPaymentMethod(store, { name: 'SEPA', kind: 'direct-debit' })
  const paypal = await addPaymentMethod(store, { name: 'PayPal', kind: 'wallet' })
  return { store, sepa, paypal }
}
const item = (over: Partial<CellItem> & { amount: number }): CellItem => ({
  id: newId(), label: '', status: 'committed', fundedBy: 'cash', date: null, note: null, recurringItemId: null, kind: 'normal', skipped: false, ...over,
})
/** Every figure the engine works out: what a day and a method must leave as it is. */
const figures = (t: Tables) => {
  const e = computeEngine({ tables: t, months: monthRange(START, addMonths(month, 3)) })
  return { totals: e.totals, accounts: e.accounts, main: e.main, pools: e.pools }
}
const itemsOf = (t: Tables, rowId: string, m: string) => t.cells.find((c) => c.rowId === rowId && c.month === m)?.items ?? []
/** The day and the method's name that count for the first item of a row's month, or for the row's own amount. */
function counts(t: Tables, rowId: string, m: string, n = 0): [number | null, string | null] {
  const row = t.rows.find((r) => r.id === rowId)!
  const it = itemsOf(t, rowId, m)[n] ?? null
  return [payDayOf(it, row, m, payContext(t)), methodOf(it, row, payContext(t))?.name ?? null]
}
/** The month's payments as the page lists them. */
const page = (t: Tables, m = month) => buildPayments(t, computeEngine({ tables: t, months: monthRange(START, addMonths(month, 3)) }), m, `${month}-15`)!

describe('"Payment" for a row: its usual day and method, in every month', () => {
  it('a day and a method are written to the row and nothing else: no figure moves, and one undo takes them back', async () => {
    const { store, sepa } = await fresh()
    const rent = await addRow(store, { name: 'Rent', section: 'expense' })
    await setCellValue(store, rent.id, before, 1200_00, 'from-now-on')
    const was = await loadTables(store)
    expect(page(was).payments.find((p) => p.rowId === rent.id)).toMatchObject({ state: 'untracked' })

    await setPaymentOf(store, { level: 'row', rowId: rent.id }, { day: 3, methodId: sepa.id })
    const t = await loadTables(store)
    expect(counts(t, rent.id, before)).toEqual([3, 'SEPA'])
    expect(counts(t, rent.id, next)).toEqual([3, 'SEPA'])
    expect(figures(t)).toEqual(figures(was))
    expect(t.cells).toEqual(was.cells)
    expect(page(t).payments.find((p) => p.rowId === rent.id)).toMatchObject({ tracked: true, day: 3, dayFrom: 'row', methodFrom: 'row' })

    await store.undo()
    expect(counts(await loadTables(store), rent.id, month)).toEqual([null, null])
  })

  it('a method alone tracks it without a day; no day and no method take it back to untracked', async () => {
    const { store, paypal } = await fresh()
    const rent = await addRow(store, { name: 'Rent', section: 'expense' })
    await setCellValue(store, rent.id, before, 1200_00, 'from-now-on')
    await setPaymentOf(store, { level: 'row', rowId: rent.id }, { day: null, methodId: paypal.id })
    expect(page(await loadTables(store)).payments.find((p) => p.rowId === rent.id)).toMatchObject({ state: 'no-day', methodId: paypal.id })
    await setPaymentOf(store, { level: 'row', rowId: rent.id }, { day: null, methodId: null })
    const t = await loadTables(store)
    expect(page(t).payments.find((p) => p.rowId === rent.id)).toMatchObject({ state: 'untracked', tracked: false })
    expect(page(t).untracked.total).toBe(1200_00)
  })

  it('saved as it already is, nothing is written', async () => {
    const { store, sepa } = await fresh()
    const rent = await addRow(store, { name: 'Rent', section: 'expense' })
    await setCellValue(store, rent.id, month, 1200_00, 'from-now-on')
    await setPaymentOf(store, { level: 'row', rowId: rent.id }, { day: 3, methodId: sepa.id })
    const was = await loadTables(store)
    await setPaymentOf(store, { level: 'row', rowId: rent.id }, { day: 3, methodId: sepa.id })
    expect(await loadTables(store)).toEqual(was)
  })

  it('where the month is one item with a day of its own, that item follows its row again, also when it is ticked', async () => {
    const { store, sepa, paypal } = await fresh()
    const repairs = await addRow(store, { name: 'Repairs', section: 'expense' })
    const one = item({ label: 'Roof', amount: 300_00, status: 'done', date: dateOn(month, 9), methodId: sepa.id })
    await setCellItems(store, repairs.id, month, [one], 'only-this-month')
    const was = await loadTables(store)
    const line = page(was).payments.find((p) => p.rowId === repairs.id)!
    expect(line).toMatchObject({ soleItemId: one.id, day: 9, dayFrom: 'item', methodFrom: 'item' })

    await setPaymentOf(store, { level: 'row', rowId: repairs.id, month, itemId: one.id }, { day: 3, methodId: paypal.id })
    const t = await loadTables(store)
    // what was saved is what the month shows
    expect(counts(t, repairs.id, month)).toEqual([3, 'PayPal'])
    expect(itemsOf(t, repairs.id, month)[0]).toMatchObject({ id: one.id, amount: 300_00, status: 'done', label: 'Roof', date: null })
    expect(itemsOf(t, repairs.id, month)[0].methodId ?? null).toBeNull()
    expect(figures(t)).toEqual(figures(was))
  })

  it('money that comes in has no payment day', async () => {
    const { store } = await fresh()
    const salary = await addRow(store, { name: 'Salary', section: 'income' })
    await expect(setPaymentOf(store, { level: 'row', rowId: salary.id }, { day: 3, methodId: null })).rejects.toThrow(/money that comes in/)
  })
})

describe('"Payment" for one item: this month alone', () => {
  it('the item gets a day and a method of its own; the other item, the row and the other months stay as they are', async () => {
    const { store, sepa, paypal } = await fresh()
    const subs = await addRow(store, { name: 'Subscriptions', section: 'expense' })
    const films = item({ label: 'Films', amount: 14_00 })
    const music = item({ label: 'Music', amount: 11_00, status: 'done' })
    await setCellItems(store, subs.id, month, [films, music], 'only-this-month')
    await setPaymentOf(store, { level: 'row', rowId: subs.id }, { day: 1, methodId: sepa.id })
    const was = await loadTables(store)

    await setPaymentOf(store, { level: 'item', rowId: subs.id, month, itemId: music.id }, { day: 20, methodId: paypal.id })
    const t = await loadTables(store)
    expect(counts(t, subs.id, month, 0)).toEqual([1, 'SEPA'])
    expect(counts(t, subs.id, month, 1)).toEqual([20, 'PayPal'])
    // a ticked item keeps its tick and its amount
    expect(itemsOf(t, subs.id, month)[1]).toMatchObject({ status: 'done', amount: 11_00, date: dateOn(month, 20), methodId: paypal.id })
    expect(itemsOf(t, subs.id, month)[0]).toEqual(itemsOf(was, subs.id, month)[0])
    expect(t.rows).toEqual(was.rows)
    expect(figures(t)).toEqual(figures(was))

    // "No day" and "No method" on the item: it follows its row again
    await setPaymentOf(store, { level: 'item', rowId: subs.id, month, itemId: music.id }, { day: null, methodId: null })
    expect(counts(await loadTables(store), subs.id, month, 1)).toEqual([1, 'SEPA'])
  })

  it('a day past the end of the month is the month\'s last day', async () => {
    const { store } = await fresh()
    const subs = await addRow(store, { name: 'Subscriptions', section: 'expense' })
    const films = item({ label: 'Films', amount: 14_00 })
    await setCellItems(store, subs.id, '2026-02', [films, item({ label: 'Music', amount: 11_00 })], 'only-this-month')
    await setPaymentOf(store, { level: 'item', rowId: subs.id, month: '2026-02', itemId: films.id }, { day: 31, methodId: null })
    expect(itemsOf(await loadTables(store), subs.id, '2026-02')[0].date).toBe('2026-02-28')
  })

  it('an item that is gone, and a method that is archived, are refused in words', async () => {
    const { store, sepa } = await fresh()
    const subs = await addRow(store, { name: 'Subscriptions', section: 'expense' })
    const films = item({ label: 'Films', amount: 14_00 })
    await setCellItems(store, subs.id, month, [films], 'only-this-month')
    await expect(setPaymentOf(store, { level: 'item', rowId: subs.id, month, itemId: newId() }, { day: 3, methodId: null })).rejects.toThrow('That item is gone.')
    await updatePaymentMethod(store, sepa.id, { archived: true })
    await expect(setPaymentOf(store, { level: 'item', rowId: subs.id, month, itemId: films.id }, { day: 3, methodId: sepa.id })).rejects.toThrow(/archived/)
  })
})

describe('"Payment" for something that repeats: this and following months', () => {
  async function repeating() {
    const made = await fresh()
    const subs = await addRow(made.store, { name: 'Subscriptions', section: 'expense' })
    const films = await addRecurringItem(made.store, { name: 'Films', rowId: subs.id, amount: 14_00, startMonth: before, payDay: 5, methodId: made.sepa.id })
    const t = await loadTables(made.store)
    return { ...made, subs, films, posted: itemsOf(t, subs.id, month)[0] }
  }

  it('the months before keep how they were paid; this month and the following ones follow what was saved; no figure moves', async () => {
    const { store, subs, films, posted, paypal } = await repeating()
    const was = await loadTables(store)
    expect(page(was).payments.find((p) => p.rowId === subs.id)).toMatchObject({ scheduleId: films.id, soleItemId: posted.id, day: 5, dayFrom: 'schedule' })

    await setPaymentOf(store, { level: 'schedule', rowId: subs.id, month, itemId: posted.id, scheduleId: films.id }, { day: 20, methodId: paypal.id })
    const t = await loadTables(store)
    expect(counts(t, subs.id, before)).toEqual([5, 'SEPA'])
    expect(counts(t, subs.id, month)).toEqual([20, 'PayPal'])
    expect(counts(t, subs.id, next)).toEqual([20, 'PayPal'])
    // the amount and where it comes out of are the schedule's, as before
    expect(itemsOf(t, subs.id, month)[0]).toMatchObject({ amount: 14_00, fundedBy: posted.fundedBy, status: posted.status, date: null })
    expect(figures(t)).toEqual(figures(was))
    // one step, one undo
    await store.undo()
    expect(counts(await loadTables(store), subs.id, month)).toEqual([5, 'SEPA'])
  })

  it('this month\'s item gives up a day of its own, and a ticked one shows what was saved, not how it was paid before', async () => {
    const { store, subs, films, posted, sepa, paypal } = await repeating()
    await setPaymentOf(store, { level: 'item', rowId: subs.id, month, itemId: posted.id }, { day: 9, methodId: null })
    await setItemStatus(store, subs.id, month, posted.id, 'done')
    expect(counts(await loadTables(store), subs.id, month)).toEqual([9, 'SEPA'])
    expect(sepa.id).not.toBe(paypal.id)

    await setPaymentOf(store, { level: 'schedule', rowId: subs.id, month, itemId: posted.id, scheduleId: films.id }, { day: 20, methodId: paypal.id })
    const t = await loadTables(store)
    expect(counts(t, subs.id, month)).toEqual([20, 'PayPal'])
    expect(itemsOf(t, subs.id, month)[0]).toMatchObject({ status: 'done', date: null })
    expect(itemsOf(t, subs.id, month)[0].methodId ?? null).toBeNull()
    expect(counts(t, subs.id, before)).toEqual([5, 'SEPA'])
  })

  it('saved as the schedule already says, the schedule is not cut in two; an own day of the month still gives way', async () => {
    const { store, subs, films, posted, sepa } = await repeating()
    await setPaymentOf(store, { level: 'item', rowId: subs.id, month, itemId: posted.id }, { day: 9, methodId: null })
    const was = await loadTables(store)
    await setPaymentOf(store, { level: 'schedule', rowId: subs.id, month, itemId: posted.id, scheduleId: films.id }, { day: 5, methodId: sepa.id })
    const t = await loadTables(store)
    expect(t.recurringItems).toEqual(was.recurringItems)
    expect(counts(t, subs.id, month)).toEqual([5, 'SEPA'])
    // and once more: now nothing at all is written
    await setPaymentOf(store, { level: 'schedule', rowId: subs.id, month, itemId: posted.id, scheduleId: films.id }, { day: 5, methodId: sepa.id })
    expect(await loadTables(store)).toEqual(t)
  })

  it('no day and no method from this month on: untracked from here, tracked before', async () => {
    const { store, subs, films, posted } = await repeating()
    await setPaymentOf(store, { level: 'schedule', rowId: subs.id, month, itemId: posted.id, scheduleId: films.id }, { day: null, methodId: null })
    const t = await loadTables(store)
    expect(page(t).payments.find((p) => p.rowId === subs.id)).toMatchObject({ state: 'untracked' })
    expect(page(t, before).payments.find((p) => p.rowId === subs.id)).toMatchObject({ tracked: true, day: 5 })
  })

  it('"Only this month" on what repeats leaves the schedule and the other months alone', async () => {
    const { store, subs, posted, paypal } = await repeating()
    const was = await loadTables(store)
    await setPaymentOf(store, { level: 'item', rowId: subs.id, month, itemId: posted.id }, { day: 9, methodId: paypal.id })
    const t = await loadTables(store)
    expect(t.recurringItems).toEqual(was.recurringItems)
    expect([counts(t, subs.id, before), counts(t, subs.id, month), counts(t, subs.id, next)]).toEqual([[5, 'SEPA'], [9, 'PayPal'], [5, 'SEPA']])
  })

  it('a schedule that is gone is refused', async () => {
    const { store, subs, posted } = await repeating()
    await expect(setPaymentOf(store, { level: 'schedule', rowId: subs.id, month, itemId: posted.id, scheduleId: newId() }, { day: 3, methodId: null })).rejects.toThrow('That schedule is gone.')
  })
})
