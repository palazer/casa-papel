import { describe, expect, it } from 'vitest'
import { computeEngine } from '@/engine'
import {
  dateOn, dayIn, dayOfDate, methodNote, methodOf, monthRange, payContext, payDayOf, usualMethod,
  EntitySchema, PaymentMethodSchema, monthOfDate, addMonths, newId, type CellItem, type Tables,
} from '@/model'
import {
  CasaDb, Store, addAccount, addPaymentMethod, addPaymentMethods, addRecurringItem, addRow, changeRecurringFrom, describeRemoval, exportSnapshot, importMerge, loadTables, methodInUse,
  quickCreateHousehold, removeAccount, removeEntity, removePaymentMethod, saveRowMonth, setCellValue, updateRecurringItem, setCellItems, setItemStatus, setPaymentsOn, setRowAccount, setUsualPayment, starterMethods, updatePaymentMethod, updateRow,
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
/** Every figure the engine works out: what a day and a method must leave as it is. */
const figures = (t: Tables) => {
  const e = computeEngine({ tables: t, months: monthRange(START, addMonths(monthOfDate(), 3)) })
  return { totals: e.totals, accounts: e.accounts, main: e.main, pools: e.pools }
}

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
    const { store } = await fresh()
    expect((await loadTables(store)).household[0].payments).toBeUndefined()
    await setPaymentsOn(store, true)
    const sepa = await addPaymentMethod(store, { name: 'SEPA', kind: 'direct-debit' })
    await setPaymentsOn(store, false)
    const t = await loadTables(store)
    expect(t.household[0].payments).toBe(false)
    expect(t.paymentMethods.map((m) => m.id)).toEqual([sepa.id])
  })

  it('a method needs a name and nothing else; its note is words of one\'s own', async () => {
    const { store } = await fresh()
    await expect(addPaymentMethod(store, { name: ' ', kind: 'transfer' })).rejects.toThrow(/name/)
    await expect(addPaymentMethod(store, { name: 'x', kind: 'transfer', ownerEntityId: newId() })).rejects.toThrow(/no longer exists/)
    const paypal = await addPaymentMethod(store, { name: ' PayPal ', kind: 'wallet', note: ' main account ' })
    const order = await addPaymentMethod(store, { name: 'Standing order', kind: 'standing-order' })
    expect(order.order > paypal.order).toBe(true)
    expect(paypal).toMatchObject({ name: 'PayPal', note: 'main account', ownerEntityId: null, archived: false })
    expect(order.note).toBe('')
    expect(order.accountId ?? null).toBeNull()
    // a credit card method is a label like any other: no card has to exist for it
    await expect(addPaymentMethod(store, { name: 'Visa', kind: 'credit-card' })).resolves.toMatchObject({ kind: 'credit-card' })
  })

  it('a method that nothing uses is deleted; one in use is archived, and both can be changed at any time', async () => {
    const { store } = await fresh()
    const sepa = await addPaymentMethod(store, { name: 'SEPA', kind: 'direct-debit', note: 'Main' })
    const spare = await addPaymentMethod(store, { name: 'Spare', kind: 'transfer' })
    const rent = rowNamed(await loadTables(store), 'Rent')
    await setUsualPayment(store, rent.id, { payDay: 1, payMethodId: sepa.id })
    expect(methodInUse(await loadTables(store), sepa.id)).toBe(true)
    expect(await removePaymentMethod(store, spare.id)).toBe('deleted')
    // in use, and still free to become something else: nothing hangs on what it is
    await updatePaymentMethod(store, sepa.id, { name: 'SEPA direct debit', kind: 'wallet', note: 'Bills pot' })
    expect(await removePaymentMethod(store, sepa.id)).toBe('archived')
    const t = await loadTables(store)
    expect(t.paymentMethods.find((m) => m.id === sepa.id)).toMatchObject({ name: 'SEPA direct debit', kind: 'wallet', note: 'Bills pot', archived: true, deletedAt: null })
    expect(t.paymentMethods.find((m) => m.id === spare.id)?.deletedAt).not.toBeNull()
    // archived: what uses it still shows it, and nothing new can take it
    expect(methodOf(null, rowNamed(t, 'Rent'), payContext(t))?.id).toBe(sepa.id)
    await expect(setUsualPayment(store, rowNamed(t, 'Groceries').id, { payDay: null, payMethodId: sepa.id })).rejects.toThrow(/archived/)
  })

  it('the starter list: three for the main account, one per credit card, cash; without what is there already', async () => {
    const { store } = await fresh()
    let t = await loadTables(store)
    const offered = starterMethods(t)
    expect(offered.map((m) => [m.kind, m.name, m.note])).toEqual([
      ['direct-debit', 'Direct debit', 'Main'], ['standing-order', 'Standing order', 'Main'], ['transfer', 'Transfer by hand', 'Main'],
      ['credit-card', 'Card', ''], ['cash', 'Cash', ''],
    ])
    await addPaymentMethods(store, offered.slice(0, 3))
    t = await loadTables(store)
    expect(t.paymentMethods).toHaveLength(3)
    expect(starterMethods(t).map((m) => m.name)).toEqual(['Card', 'Cash'])
    await store.undo()
    expect((await loadTables(store)).paymentMethods.filter((m) => !m.deletedAt)).toHaveLength(0)
  })

  it('a method from before the note shows the name of its old account, until it is edited; a merge with its own copy keeps it', async () => {
    const { store, main } = await fresh()
    // as schema 21 stored it: an account, and no note
    const old = PaymentMethodSchema.parse({ id: newId(), createdAt: 1, updatedAt: 1, name: 'SEPA', kind: 'direct-debit', accountId: main.id })
    expect('note' in old).toBe(false)
    await store.commit([{ op: 'put', table: 'paymentMethods', record: old }])
    let t = await loadTables(store)
    expect(methodNote(t.paymentMethods[0], t.accounts)).toBe('Main')
    // the same record coming back from a file or from the cloud is the same record: it does not win over the stored one
    const result = await importMerge(store, await exportSnapshot(store))
    expect(result.applied).toBe(0)
    t = await loadTables(store)
    expect(t.paymentMethods[0]).toMatchObject({ accountId: main.id })
    expect(methodNote(t.paymentMethods[0], t.accounts)).toBe('Main')
    // the account is deleted: its name is still what the method meant
    await removeAccount(store, main.id)
    t = await loadTables(store)
    expect(t.paymentMethods[0].deletedAt ?? null).toBeNull()
    expect(methodNote(t.paymentMethods[0], t.accounts)).toBe('Main')
    // edited: the note is written, and the old link is let go; an emptied note stays empty
    await updatePaymentMethod(store, old.id, { name: 'SEPA debit' })
    t = await loadTables(store)
    expect(t.paymentMethods[0]).toMatchObject({ name: 'SEPA debit', note: 'Main', accountId: null })
    await updatePaymentMethod(store, old.id, { note: '' })
    t = await loadTables(store)
    expect(methodNote(t.paymentMethods[0], t.accounts)).toBe('')
  })
})

describe('what goes with an account or a person', () => {
  it('deleting an account leaves the methods alone; a person\'s method becomes the household\'s', async () => {
    const { store } = await fresh()
    const cash = await addAccount(store, { name: 'Notes', type: 'cash', currency: 'EUR', openingMonth: START })
    const t0 = await loadTables(store)
    const sam = EntitySchema.parse({ id: newId(), createdAt: 1, updatedAt: 1, kind: 'adult', name: 'Sam' })
    await store.commit([{ op: 'put', table: 'entities', record: sam }])
    const notes = await addPaymentMethod(store, { name: 'Notes', kind: 'cash', note: 'Notes', ownerEntityId: sam.id })
    const groceries = rowNamed(t0, 'Groceries')
    await setUsualPayment(store, groceries.id, { payDay: null, payMethodId: notes.id })
    expect(describeRemoval(await loadTables(store), { kind: 'account', id: cash.id }).changes.join(' ')).not.toMatch(/payment method/)
    await removeAccount(store, cash.id)
    await removeEntity(store, sam.id)
    const t = await loadTables(store)
    expect(t.paymentMethods.find((m) => m.id === notes.id)).toMatchObject({ deletedAt: null, ownerEntityId: null, note: 'Notes' })
    expect(methodOf(null, rowNamed(t, 'Groceries'), payContext(t))?.id).toBe(notes.id)
  })
})

describe('"Usually paid…": a row\'s day and method', () => {
  it('a day and a method write the row and nothing else, and move no figure, whatever the method is named for', async () => {
    const { store } = await fresh()
    const visa = await addPaymentMethod(store, { name: 'Visa', kind: 'credit-card', note: 'Card' })
    const samSepa = await addPaymentMethod(store, { name: "Sam's SEPA", kind: 'direct-debit', note: "Sam's account" })
    const subs = await addRow(store, { name: 'Subscriptions', section: 'expense' })
    const month = monthOfDate()
    const films = await addRecurringItem(store, { name: 'Films', rowId: subs.id, amount: 14_00, startMonth: month })
    const before = await loadTables(store)
    const was = figures(before)
    const groceries = rowNamed(before, 'Groceries')
    await setUsualPayment(store, groceries.id, { payDay: 31, payMethodId: visa.id })
    await setUsualPayment(store, subs.id, { payDay: 5, payMethodId: samSepa.id })
    const t = await loadTables(store)
    expect(rowNamed(t, 'Groceries')).toMatchObject({ payDay: 31, payMethodId: visa.id, defaultFundedBy: groceries.defaultFundedBy, accountId: groceries.accountId })
    expect(rowNamed(t, 'Subscriptions')).toMatchObject({ payDay: 5, payMethodId: samSepa.id, defaultFundedBy: 'cash', accountId: null })
    expect(t.recurringItems.find((r) => r.id === films.id)?.fundedBy).toBe('cash')
    expect(t.cells.find((c) => c.rowId === subs.id && c.month === month)!.items[0].fundedBy).toBe('cash')
    expect(payDayOf(null, rowNamed(t, 'Groceries'), '2026-02', payContext(t))).toBe(28)
    // nothing is owed on the card, and Sam's account holds what it held
    expect(figures(t)).toEqual(was)
  })

  it('an expense cannot be put on a card; one that still names a card from before schema 23 keeps its usual method when the card is taken off', async () => {
    const { store, card } = await fresh()
    const sepa = await addPaymentMethod(store, { name: 'SEPA', kind: 'direct-debit' })
    const groceries = rowNamed(await loadTables(store), 'Groceries')
    await expect(setRowAccount(store, groceries.id, card.id)).rejects.toThrow(/an expense names no account/)
    await updateRow(store, groceries.id, { accountId: card.id })
    // a row that names a card names no method by itself
    let t = await loadTables(store)
    expect(usualMethod(rowNamed(t, 'Groceries'), payContext(t))).toBeNull()
    const onCard = figures(t)
    await setUsualPayment(store, groceries.id, { payDay: 9, payMethodId: sepa.id })
    t = await loadTables(store)
    expect(rowNamed(t, 'Groceries')).toMatchObject({ accountId: card.id, payMethodId: sepa.id, payDay: 9 })
    expect(figures(t)).toEqual(onCard)
    // taken off the card again: the method and the day stay
    await setRowAccount(store, groceries.id, null)
    expect(rowNamed(await loadTables(store), 'Groceries')).toMatchObject({ accountId: null, payMethodId: sepa.id, payDay: 9 })
    await setUsualPayment(store, groceries.id, { payDay: 9, payMethodId: null })
    expect(rowNamed(await loadTables(store), 'Groceries')).toMatchObject({ payMethodId: null, payDay: 9 })
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
    const { store } = await fresh()
    const sepa = await addPaymentMethod(store, { name: 'SEPA', kind: 'direct-debit' })
    const visa = await addPaymentMethod(store, { name: 'Visa', kind: 'credit-card' })
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
    expect([payDayOf(posted, row, month, ctx), methodOf(posted, row, ctx)?.name]).toEqual([5, 'Visa'])
    const cloud = items.find((i) => i.label === 'Cloud')!
    expect([payDayOf(cloud, row, month, ctx), methodOf(cloud, row, ctx)?.name]).toEqual([28, 'SEPA'])
    const news = items.find((i) => i.label === 'News')!
    expect([payDayOf(news, row, month, ctx), methodOf(news, row, ctx)?.name]).toEqual([1, 'SEPA'])
  })

  it('a schedule\'s day or method changed from a month on leaves the months before, and what was paid, as they were', async () => {
    const { store } = await fresh()
    const sepa = await addPaymentMethod(store, { name: 'SEPA', kind: 'direct-debit' })
    const visa = await addPaymentMethod(store, { name: 'Visa', kind: 'credit-card' })
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
    // the months after follow the new ones
    expect([payDayOf(of(next), row, next, ctx), methodOf(of(next), row, ctx)?.name]).toEqual([20, 'Visa'])
    expect(of(next).methodId ?? null).toBeNull()
  })
})

describe('saved from the amount\'s dialog', () => {
  it('an amount and its row\'s usual day and method are one step: one undo takes both back', async () => {
    const { store } = await fresh()
    const sepa = await addPaymentMethod(store, { name: 'SEPA', kind: 'direct-debit' })
    const samSepa = await addPaymentMethod(store, { name: "Sam's SEPA", kind: 'direct-debit' })
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
    // another method: the row's own fields change with the amount, and where it comes out of stays
    await setCellValue(store, rent.id, month, 1200_00, 'from-now-on', { pay: { payDay: 3, payMethodId: samSepa.id } })
    t = await loadTables(store)
    expect(rowNamed(t, 'Rent')).toMatchObject({ payDay: 3, payMethodId: samSepa.id, defaultFundedBy: 'cash' })
    // the same day and method again write nothing more about the row
    const before = rowNamed(t, 'Rent').updatedAt
    await setCellValue(store, rent.id, month, 1250_00, 'from-now-on', { pay: { payDay: 3, payMethodId: samSepa.id } })
    expect(rowNamed(await loadTables(store), 'Rent').updatedAt).toBe(before)
  })

  it('an item that is set to repeat hands its day and method to its schedule, and follows it', async () => {
    const { store } = await fresh()
    const visa = await addPaymentMethod(store, { name: 'Visa', kind: 'credit-card' })
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
    expect([payDayOf(posted, rowNamed(t, 'Subscriptions'), next, ctx), methodOf(posted, rowNamed(t, 'Subscriptions'), ctx)?.id]).toEqual([5, visa.id])
  })

  it('a scheduled item\'s day or method changed in a month is that month\'s alone, or its schedule\'s from that month on', async () => {
    const { store } = await fresh()
    const sepa = await addPaymentMethod(store, { name: 'SEPA', kind: 'direct-debit' })
    const visa = await addPaymentMethod(store, { name: 'Visa', kind: 'credit-card' })
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
      expect([payDayOf(it, row, m, ctx2), methodOf(it, row, ctx2)?.id]).toEqual([20, visa.id])
    }
  })

  it('a schedule\'s day or method changed in the list of schedules counts from the current month', async () => {
    const { store } = await fresh()
    const sepa = await addPaymentMethod(store, { name: 'SEPA', kind: 'direct-debit' })
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
