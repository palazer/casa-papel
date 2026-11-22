import { describe, expect, it } from 'vitest'
import {
  accountRef, cardOf, dateOn, dayIn, dayOfDate, methodOf, payContext, payDayOf, sourceForMethod, usualMethod,
  EntitySchema, monthOfDate, addMonths, newId, type CellItem, type Tables,
} from '@/model'
import {
  CasaDb, Store, addAccount, addPaymentMethod, addPaymentMethods, addRecurringItem, addRow, changeRecurringFrom, describeRemoval, loadTables, methodInUse,
  quickCreateHousehold, removeAccount, removeEntity, removePaymentMethod, saveRowMonth, setCellValue, updateRecurringItem, setCellItems, setItemStatus, setPaymentsOn, setRowAccount, setUsualPayment, starterMethods, updatePaymentMethod,
} from '@/store'

const START = '2026-01'

async function fresh() {
  const store = new Store(new CasaDb(`test-${newId()}`))
  await quickCreateHousehold(store, { name: 'T', baseCurrency: 'EUR', locale: 'en-IE', startMonth: START })
  const main = await addAccount(store, { name: 'Main', type: 'checking', currency: 'EUR', openingMonth: START })
  const own = await addAccount(store, { name: "Sam's account", type: 'joint', currency: 'EUR', openingMonth: START, openingBalance: 500_00 })
  const card = await addAccount(store, { name: 'Card', type: 'credit-card', currency: 'EUR', openingMonth: START })
  return { store, main, own, card }
}

const item = (over: Partial<CellItem> & { amount: number }): CellItem => ({
  id: newId(), label: '', status: 'committed', fundedBy: 'cash', date: null, note: null, recurringItemId: null, kind: 'normal', skipped: false, ...over,
})
const rowNamed = (t: Tables, name: string) => t.rows.find((r) => r.name === name && !r.deletedAt)!

describe('the day of a payment', () => {
  it('a day the month does not have is its last day', () => {
    expect(dayIn('2026-02', 31)).toBe(28)
    expect(dayIn('2028-02', 30)).toBe(29)
    expect(dayIn('2026-04', 31)).toBe(30)
    expect(dayIn('2026-05', 15)).toBe(15)
    expect(dateOn('2026-02', 31)).toBe('2026-02-28')
    expect(dateOn('2026-03', 5)).toBe('2026-03-05')
  })
  it('a date counts only in its own month', () => {
    expect(dayOfDate('2026-03-05', '2026-03')).toBe(5)
    expect(dayOfDate('2026-03-05', '2026-04')).toBeNull()
    expect(dayOfDate(null, '2026-03')).toBeNull()
  })
})

describe('the switch and the list of payment methods', () => {
  it('the switch is off until it is turned on, and turning it off loses nothing', async () => {
    const { store, main } = await fresh()
    expect((await loadTables(store)).household[0].payments).toBeUndefined()
    await setPaymentsOn(store, true)
    const sepa = await addPaymentMethod(store, { name: 'SEPA', kind: 'direct-debit', accountId: main.id })
    await setPaymentsOn(store, false)
    const t = await loadTables(store)
    expect(t.household[0].payments).toBe(false)
    expect(t.paymentMethods.map((m) => m.id)).toEqual([sepa.id])
  })

  it('a method needs a name and an account it can draw on; a credit card method is a card', async () => {
    const { store, main, card } = await fresh()
    const t = await loadTables(store)
    const savings = t.accounts.find((a) => a.type === 'savings')!
    const loan = await addAccount(store, { name: 'Loan', type: 'loan', currency: 'EUR', openingMonth: START, openingBalance: 1000_00 })
    await expect(addPaymentMethod(store, { name: ' ', kind: 'transfer', accountId: main.id })).rejects.toThrow(/name/)
    await expect(addPaymentMethod(store, { name: 'x', kind: 'transfer', accountId: newId() })).rejects.toThrow(/account or card/)
    await expect(addPaymentMethod(store, { name: 'x', kind: 'transfer', accountId: loan.id })).rejects.toThrow(/cannot draw on/)
    await expect(addPaymentMethod(store, { name: 'x', kind: 'credit-card', accountId: main.id })).rejects.toThrow(/not one/)
    await expect(addPaymentMethod(store, { name: 'x', kind: 'direct-debit', accountId: card.id })).rejects.toThrow(/is a credit card/)
    const paypal = await addPaymentMethod(store, { name: 'PayPal', kind: 'wallet', accountId: card.id })
    const order = await addPaymentMethod(store, { name: 'Standing order', kind: 'standing-order', accountId: savings.id })
    expect(order.order > paypal.order).toBe(true)
    expect(paypal).toMatchObject({ ownerEntityId: null, archived: false })
  })

  it('a method that nothing uses is deleted; one in use is archived and keeps its account', async () => {
    const { store, main, card } = await fresh()
    const sepa = await addPaymentMethod(store, { name: 'SEPA', kind: 'direct-debit', accountId: main.id })
    const spare = await addPaymentMethod(store, { name: 'Spare', kind: 'transfer', accountId: main.id })
    const rent = rowNamed(await loadTables(store), 'Rent')
    await setUsualPayment(store, rent.id, { payDay: 1, payMethodId: sepa.id })
    expect(methodInUse(await loadTables(store), sepa.id)).toBe(true)
    expect(await removePaymentMethod(store, spare.id)).toBe('deleted')
    await expect(updatePaymentMethod(store, sepa.id, { accountId: card.id, kind: 'wallet' })).rejects.toThrow(/in use/)
    await updatePaymentMethod(store, sepa.id, { name: 'SEPA direct debit' })
    expect(await removePaymentMethod(store, sepa.id)).toBe('archived')
    const t = await loadTables(store)
    expect(t.paymentMethods.find((m) => m.id === sepa.id)).toMatchObject({ name: 'SEPA direct debit', archived: true, deletedAt: null, accountId: main.id })
    expect(t.paymentMethods.find((m) => m.id === spare.id)?.deletedAt).not.toBeNull()
    // archived: what uses it still shows it, and nothing new can take it
    expect(methodOf(null, rowNamed(t, 'Rent'), payContext(t))?.id).toBe(sepa.id)
    await expect(setUsualPayment(store, rowNamed(t, 'Groceries').id, { payDay: null, payMethodId: sepa.id })).rejects.toThrow(/archived/)
  })

  it('the starter list comes from the accounts, without what is there already', async () => {
    const { store, main, own, card } = await fresh()
    const cash = await addAccount(store, { name: 'Wallet cash', type: 'cash', currency: 'EUR', openingMonth: START })
    let t = await loadTables(store)
    const offered = starterMethods(t)
    expect(offered.map((m) => [m.kind, m.name, m.accountId])).toEqual([
      ['direct-debit', 'Direct debit · Main', main.id], ['standing-order', 'Standing order · Main', main.id], ['transfer', 'Transfer by hand · Main', main.id],
      ['direct-debit', "Direct debit · Sam's account", own.id], ['standing-order', "Standing order · Sam's account", own.id], ['transfer', "Transfer by hand · Sam's account", own.id],
      ['credit-card', 'Card', card.id], ['cash', 'Wallet cash', cash.id],
    ])
    await addPaymentMethods(store, offered.slice(0, 3))
    t = await loadTables(store)
    expect(t.paymentMethods).toHaveLength(3)
    expect(starterMethods(t)).toHaveLength(5)
    await store.undo()
    expect((await loadTables(store)).paymentMethods.filter((m) => !m.deletedAt)).toHaveLength(0)
  })
})

describe('what goes with an account or a person', () => {
  it('a method goes with the account it draws on, and what named it names none; a person\'s method becomes the household\'s', async () => {
    const { store, main } = await fresh()
    const cash = await addAccount(store, { name: 'Notes', type: 'cash', currency: 'EUR', openingMonth: START })
    const t0 = await loadTables(store)
    const sam = EntitySchema.parse({ id: newId(), createdAt: 1, updatedAt: 1, kind: 'adult', name: 'Sam' })
    await store.commit([{ op: 'put', table: 'entities', record: sam }])
    const notes = await addPaymentMethod(store, { name: 'Notes', kind: 'cash', accountId: cash.id, ownerEntityId: sam.id })
    const sepa = await addPaymentMethod(store, { name: 'SEPA', kind: 'direct-debit', accountId: main.id, ownerEntityId: sam.id })
    const groceries = rowNamed(t0, 'Groceries')
    await setUsualPayment(store, groceries.id, { payDay: null, payMethodId: notes.id })
    expect(describeRemoval(await loadTables(store), { kind: 'account', id: cash.id }).changes.join(' ')).toMatch(/payment method "Notes" goes with it/)
    await removeAccount(store, cash.id)
    await removeEntity(store, sam.id)
    const t = await loadTables(store)
    expect(t.paymentMethods.find((m) => m.id === notes.id)?.deletedAt).not.toBeNull()
    expect(t.paymentMethods.find((m) => m.id === sepa.id)).toMatchObject({ deletedAt: null, ownerEntityId: null })
    const row = rowNamed(t, 'Groceries')
    expect(methodOf(null, row, payContext(t))).toBeNull()
    expect(row.defaultFundedBy).toBe('cash')
  })
})

describe('"Usually paid…": a row\'s day and method', () => {
  it('a method on the main account leaves "Comes out of" and the row\'s account alone', async () => {
    const { store, main } = await fresh()
    const sepa = await addPaymentMethod(store, { name: 'SEPA', kind: 'direct-debit', accountId: main.id })
    const rent = rowNamed(await loadTables(store), 'Rent')
    await setUsualPayment(store, rent.id, { payDay: 31, payMethodId: sepa.id })
    const t = await loadTables(store)
    const row = rowNamed(t, 'Rent')
    expect(row).toMatchObject({ payDay: 31, payMethodId: sepa.id, defaultFundedBy: 'cash', accountId: main.id })
    const ctx = payContext(t)
    expect(payDayOf(null, row, '2026-02', ctx)).toBe(28)
    expect(cardOf(null, row, ctx)).toBeNull()
    expect(sourceForMethod(sepa, ctx.accounts)).toBeNull()
  })

  it('a method on another account of yours sets "Comes out of" to it: for the row, its schedules and the items that follow the row', async () => {
    const { store, main, own } = await fresh()
    const samSepa = await addPaymentMethod(store, { name: "Sam's SEPA", kind: 'direct-debit', accountId: own.id })
    const paypal = await addPaymentMethod(store, { name: 'PayPal', kind: 'wallet', accountId: main.id })
    const subs = await addRow(store, { name: 'Subscriptions', section: 'expense' })
    const month = monthOfDate()
    const films = await addRecurringItem(store, { name: 'Films', rowId: subs.id, amount: 14_00, startMonth: month })
    const music = await addRecurringItem(store, { name: 'Music', rowId: subs.id, amount: 11_00, startMonth: month, methodId: paypal.id })
    await setUsualPayment(store, subs.id, { payDay: 5, payMethodId: samSepa.id })
    const t = await loadTables(store)
    const row = rowNamed(t, 'Subscriptions')
    expect(row).toMatchObject({ defaultFundedBy: accountRef(own.id), accountId: own.id })
    // the schedule without a method of its own follows the row; the one paid by PayPal from the main account does not
    expect(t.recurringItems.find((r) => r.id === films.id)?.fundedBy).toBe(accountRef(own.id))
    expect(t.recurringItems.find((r) => r.id === music.id)?.fundedBy).toBe('cash')
    const posted = t.cells.find((c) => c.rowId === subs.id && c.month === month)!.items
    expect(posted.find((i) => i.recurringItemId === films.id)?.fundedBy).toBe(accountRef(own.id))
    expect(posted.find((i) => i.recurringItemId === music.id)?.fundedBy).toBe('cash')
    const ctx = payContext(t)
    expect(methodOf(posted.find((i) => i.recurringItemId === films.id)!, row, ctx)?.id).toBe(samSepa.id)
    expect(methodOf(posted.find((i) => i.recurringItemId === music.id)!, row, ctx)?.id).toBe(paypal.id)
    expect(payDayOf(posted.find((i) => i.recurringItemId === music.id)!, row, month, ctx)).toBe(5)
  })

  it('a method on a card puts the row on that card, and another method takes it off', async () => {
    const { store, main, card } = await fresh()
    const visa = await addPaymentMethod(store, { name: 'Visa', kind: 'credit-card', accountId: card.id })
    const sepa = await addPaymentMethod(store, { name: 'SEPA', kind: 'direct-debit', accountId: main.id })
    const groceries = rowNamed(await loadTables(store), 'Groceries')
    await setUsualPayment(store, groceries.id, { payDay: null, payMethodId: visa.id })
    let t = await loadTables(store)
    expect(rowNamed(t, 'Groceries')).toMatchObject({ accountId: card.id, payMethodId: visa.id, defaultFundedBy: 'cash' })
    expect(cardOf(null, rowNamed(t, 'Groceries'), payContext(t))).toBe(card.id)
    await setUsualPayment(store, groceries.id, { payDay: 12, payMethodId: sepa.id })
    t = await loadTables(store)
    expect(rowNamed(t, 'Groceries')).toMatchObject({ accountId: main.id, payMethodId: sepa.id, payDay: 12 })
    expect(cardOf(null, rowNamed(t, 'Groceries'), payContext(t))).toBeNull()
    // no method at all: off the card as well
    await setUsualPayment(store, groceries.id, { payDay: 12, payMethodId: visa.id })
    await setUsualPayment(store, groceries.id, { payDay: 12, payMethodId: null })
    t = await loadTables(store)
    expect(rowNamed(t, 'Groceries')).toMatchObject({ accountId: null, payMethodId: null, payDay: 12 })
  })

  it('a row put on a card before methods existed reads as the card\'s first method, and keeps its card when only a day is set', async () => {
    const { store, card } = await fresh()
    const groceries = rowNamed(await loadTables(store), 'Groceries')
    await setRowAccount(store, groceries.id, card.id)
    // no method draws on the card yet: only a day is set, and the card stays
    await setUsualPayment(store, groceries.id, { payDay: 3, payMethodId: null })
    let t = await loadTables(store)
    expect(rowNamed(t, 'Groceries')).toMatchObject({ accountId: card.id, payDay: 3 })
    expect(usualMethod(rowNamed(t, 'Groceries'), payContext(t))).toBeNull()
    const visa = await addPaymentMethod(store, { name: 'Visa', kind: 'credit-card', accountId: card.id })
    t = await loadTables(store)
    expect(usualMethod(rowNamed(t, 'Groceries'), payContext(t))?.id).toBe(visa.id)
    expect(methodInUse(t, visa.id)).toBe(false)
  })

  it('"Paid by card…" drops a usual method that draws on another account', async () => {
    const { store, main, card } = await fresh()
    const sepa = await addPaymentMethod(store, { name: 'SEPA', kind: 'direct-debit', accountId: main.id })
    const groceries = rowNamed(await loadTables(store), 'Groceries')
    await setUsualPayment(store, groceries.id, { payDay: 9, payMethodId: sepa.id })
    await setRowAccount(store, groceries.id, card.id)
    const row = rowNamed(await loadTables(store), 'Groceries')
    expect(row).toMatchObject({ accountId: card.id, payMethodId: null, payDay: 9 })
  })

  it('money that comes in has no payment day', async () => {
    const { store } = await fresh()
    const salary = rowNamed(await loadTables(store), 'Salary')
    await expect(setUsualPayment(store, salary.id, { payDay: 28, payMethodId: null })).rejects.toThrow(/comes in/)
    const rent = rowNamed(await loadTables(store), 'Rent')
    await expect(setUsualPayment(store, rent.id, { payDay: 32, payMethodId: null })).rejects.toThrow(/1 to 31/)
  })
})

describe('an item\'s own day and method, and its schedule\'s', () => {
  it('the nearest one counts: the item, else its schedule, else the row', async () => {
    const { store, main, card } = await fresh()
    const sepa = await addPaymentMethod(store, { name: 'SEPA', kind: 'direct-debit', accountId: main.id })
    const visa = await addPaymentMethod(store, { name: 'Visa', kind: 'credit-card', accountId: card.id })
    const subs = await addRow(store, { name: 'Subscriptions', section: 'expense' })
    const month = monthOfDate()
    await setUsualPayment(store, subs.id, { payDay: 1, payMethodId: sepa.id })
    const films = await addRecurringItem(store, { name: 'Films', rowId: subs.id, amount: 14_00, startMonth: month, payDay: 5, methodId: visa.id })
    let t = await loadTables(store)
    const cell = t.cells.find((c) => c.rowId === subs.id && c.month === month)!
    const own = item({ label: 'Cloud', amount: 17_00, date: dateOn(month, 28) })
    const plain = item({ label: 'News', amount: 9_00 })
    await setCellItems(store, subs.id, month, [...cell.items, own, plain], 'only-this-month')
    t = await loadTables(store)
    const row = rowNamed(t, 'Subscriptions')
    const ctx = payContext(t)
    const items = t.cells.find((c) => c.rowId === subs.id && c.month === month)!.items
    const posted = items.find((i) => i.recurringItemId === films.id)!
    expect([payDayOf(posted, row, month, ctx), methodOf(posted, row, ctx)?.name, cardOf(posted, row, ctx)]).toEqual([5, 'Visa', card.id])
    const cloud = items.find((i) => i.label === 'Cloud')!
    expect([payDayOf(cloud, row, month, ctx), methodOf(cloud, row, ctx)?.name, cardOf(cloud, row, ctx)]).toEqual([28, 'SEPA', null])
    const news = items.find((i) => i.label === 'News')!
    expect([payDayOf(news, row, month, ctx), methodOf(news, row, ctx)?.name, cardOf(news, row, ctx)]).toEqual([1, 'SEPA', null])
  })

  it('a schedule\'s day or method changed from a month on leaves the months before, and what was paid, as they were', async () => {
    const { store, main, card } = await fresh()
    const sepa = await addPaymentMethod(store, { name: 'SEPA', kind: 'direct-debit', accountId: main.id })
    const visa = await addPaymentMethod(store, { name: 'Visa', kind: 'credit-card', accountId: card.id })
    const subs = await addRow(store, { name: 'Subscriptions', section: 'expense' })
    const month = monthOfDate()
    const next = addMonths(month, 1)
    const films = await addRecurringItem(store, { name: 'Films', rowId: subs.id, amount: 14_00, startMonth: addMonths(month, -1), payDay: 5, methodId: sepa.id })
    let t = await loadTables(store)
    const paid = t.cells.find((c) => c.rowId === subs.id && c.month === month)!.items[0]
    await setItemStatus(store, subs.id, month, paid.id, 'done')
    const targetId = await changeRecurringFrom(store, films.id, month, { payDay: 20, methodId: visa.id })
    expect(targetId).not.toBe(films.id)
    t = await loadTables(store)
    const row = rowNamed(t, 'Subscriptions')
    const ctx = payContext(t)
    const of = (m: string) => t.cells.find((c) => c.rowId === subs.id && c.month === m)!.items[0]
    // the month before: still the old schedule
    expect([payDayOf(of(addMonths(month, -1)), row, addMonths(month, -1), ctx), methodOf(of(addMonths(month, -1)), row, ctx)?.name]).toEqual([5, 'SEPA'])
    // this month was paid: it keeps how it was paid, written into the item
    expect(of(month)).toMatchObject({ status: 'done', recurringItemId: targetId, date: dateOn(month, 5), methodId: sepa.id })
    expect(cardOf(of(month), row, ctx)).toBeNull()
    // the months after follow the new ones
    expect([payDayOf(of(next), row, next, ctx), methodOf(of(next), row, ctx)?.name, cardOf(of(next), row, ctx)]).toEqual([20, 'Visa', card.id])
    expect(of(next).methodId ?? null).toBeNull()
  })
})

describe('saved from the amount\'s dialog', () => {
  it('an amount and its row\'s usual day and method are one step: one undo takes both back', async () => {
    const { store, main, own } = await fresh()
    const sepa = await addPaymentMethod(store, { name: 'SEPA', kind: 'direct-debit', accountId: main.id })
    const samSepa = await addPaymentMethod(store, { name: "Sam's SEPA", kind: 'direct-debit', accountId: own.id })
    const rent = rowNamed(await loadTables(store), 'Rent')
    const month = monthOfDate()
    await setCellValue(store, rent.id, month, 1200_00, 'from-now-on', { pay: { payDay: 1, payMethodId: sepa.id } })
    let t = await loadTables(store)
    expect(rowNamed(t, 'Rent')).toMatchObject({ payDay: 1, payMethodId: sepa.id, defaultFundedBy: 'cash' })
    expect(t.cells.find((c) => c.rowId === rent.id && c.month === month)).toMatchObject({ mode: 'value', value: 1200_00 })
    await store.undo()
    t = await loadTables(store)
    expect(rowNamed(t, 'Rent').payDay ?? null).toBeNull()
    expect(t.cells.find((c) => c.rowId === rent.id && c.month === month)?.value ?? null).toBeNull()
    // a method on another account: the month just saved comes out of that account with the rest of the row
    await setCellValue(store, rent.id, month, 1200_00, 'from-now-on', { pay: { payDay: 3, payMethodId: samSepa.id } })
    t = await loadTables(store)
    expect(rowNamed(t, 'Rent')).toMatchObject({ payDay: 3, payMethodId: samSepa.id, defaultFundedBy: accountRef(own.id), accountId: own.id })
    // the same day and method again write nothing more about the row
    const before = rowNamed(t, 'Rent').updatedAt
    await setCellValue(store, rent.id, month, 1250_00, 'from-now-on', { pay: { payDay: 3, payMethodId: samSepa.id } })
    expect(rowNamed(await loadTables(store), 'Rent').updatedAt).toBe(before)
  })

  it('an item that is set to repeat hands its day and method to its schedule, and follows it', async () => {
    const { store, card } = await fresh()
    const visa = await addPaymentMethod(store, { name: 'Visa', kind: 'credit-card', accountId: card.id })
    const subs = await addRow(store, { name: 'Subscriptions', section: 'expense' })
    const month = monthOfDate()
    const films = item({ label: 'Films', amount: 14_00, date: dateOn(month, 5), methodId: visa.id })
    const once = item({ label: 'Gift', amount: 30_00, date: dateOn(month, 20), methodId: visa.id })
    await saveRowMonth(store, subs.id, month, { items: [films, once], repeats: { [films.id]: { kind: 'every', interval: 1, anchor: 1 } }, scope: 'this-month' })
    const t = await loadTables(store)
    const schedule = t.recurringItems.find((r) => r.rowId === subs.id && !r.deletedAt)!
    expect(schedule).toMatchObject({ name: 'Films', payDay: 5, methodId: visa.id })
    const items = t.cells.find((c) => c.rowId === subs.id && c.month === month)!.items
    expect(items.find((i) => i.label === 'Films')).toMatchObject({ recurringItemId: schedule.id, date: null, methodId: null })
    // the one that does not repeat keeps what it names
    expect(items.find((i) => i.label === 'Gift')).toMatchObject({ recurringItemId: null, date: dateOn(month, 20), methodId: visa.id })
    const next = addMonths(month, 1)
    const posted = t.cells.find((c) => c.rowId === subs.id && c.month === next)!.items[0]
    const ctx = payContext(t)
    expect([payDayOf(posted, rowNamed(t, 'Subscriptions'), next, ctx), cardOf(posted, rowNamed(t, 'Subscriptions'), ctx)]).toEqual([5, card.id])
  })

  it('a scheduled item\'s day or method changed in a month is that month\'s alone, or its schedule\'s from that month on', async () => {
    const { store, main, card } = await fresh()
    const sepa = await addPaymentMethod(store, { name: 'SEPA', kind: 'direct-debit', accountId: main.id })
    const visa = await addPaymentMethod(store, { name: 'Visa', kind: 'credit-card', accountId: card.id })
    const subs = await addRow(store, { name: 'Subscriptions', section: 'expense' })
    const month = monthOfDate()
    const next = addMonths(month, 1)
    const films = await addRecurringItem(store, { name: 'Films', rowId: subs.id, amount: 14_00, startMonth: month, payDay: 5, methodId: sepa.id })
    let t = await loadTables(store)
    const now = t.cells.find((c) => c.rowId === subs.id && c.month === month)!.items
    // only this month: the item names its own, the schedule keeps its day
    await saveRowMonth(store, subs.id, month, { items: [{ ...now[0], date: dateOn(month, 9) }], applyTo: { [now[0].id]: 'this-month' }, scope: 'this-month' })
    t = await loadTables(store)
    expect(t.recurringItems.filter((r) => r.rowId === subs.id && !r.deletedAt)).toHaveLength(1)
    expect(t.recurringItems.find((r) => r.id === films.id)).toMatchObject({ payDay: 5, methodId: sepa.id })
    const ctx = payContext(t)
    const row = rowNamed(t, 'Subscriptions')
    expect(payDayOf(t.cells.find((c) => c.rowId === subs.id && c.month === month)!.items[0], row, month, ctx)).toBe(9)
    expect(payDayOf(t.cells.find((c) => c.rowId === subs.id && c.month === next)!.items[0], row, next, ctx)).toBe(5)
    // this and following months, from the next month: the schedule is split there and the item follows it again
    const later = t.cells.find((c) => c.rowId === subs.id && c.month === next)!.items
    await saveRowMonth(store, subs.id, next, { items: [{ ...later[0], date: dateOn(next, 20), methodId: visa.id }], applyTo: { [later[0].id]: 'from-now-on' }, scope: 'this-month' })
    t = await loadTables(store)
    const pieces = t.recurringItems.filter((r) => r.rowId === subs.id && !r.deletedAt).sort((a, b) => (a.startMonth < b.startMonth ? -1 : 1))
    expect(pieces.map((p) => [p.startMonth, p.endMonth, p.payDay, p.methodId])).toEqual([[month, month, 5, sepa.id], [next, null, 20, visa.id]])
    const after = addMonths(next, 1)
    const ctx2 = payContext(t)
    for (const m of [next, after]) {
      const it = t.cells.find((c) => c.rowId === subs.id && c.month === m)!.items[0]
      expect(it).toMatchObject({ date: null })
      expect([payDayOf(it, row, m, ctx2), cardOf(it, row, ctx2)]).toEqual([20, card.id])
    }
  })

  it('a schedule\'s day or method changed in the list of schedules counts from the current month', async () => {
    const { store, main } = await fresh()
    const sepa = await addPaymentMethod(store, { name: 'SEPA', kind: 'direct-debit', accountId: main.id })
    const subs = await addRow(store, { name: 'Subscriptions', section: 'expense' })
    const month = monthOfDate()
    const films = await addRecurringItem(store, { name: 'Films', rowId: subs.id, amount: 14_00, startMonth: addMonths(month, -2), payDay: 5 })
    await updateRecurringItem(store, films.id, { payDay: 12, methodId: sepa.id })
    const t = await loadTables(store)
    const pieces = t.recurringItems.filter((r) => r.rowId === subs.id && !r.deletedAt).sort((a, b) => (a.startMonth < b.startMonth ? -1 : 1))
    expect(pieces.map((p) => [p.startMonth, p.endMonth, p.payDay ?? null, p.methodId ?? null])).toEqual([
      [addMonths(month, -2), addMonths(month, -1), 5, null], [month, null, 12, sepa.id],
    ])
    // a new name alone is the schedule's own in every month, and splits nothing
    await updateRecurringItem(store, pieces[1].id, { name: 'Movies' })
    expect((await loadTables(store)).recurringItems.filter((r) => r.rowId === subs.id && !r.deletedAt)).toHaveLength(2)
  })
})
