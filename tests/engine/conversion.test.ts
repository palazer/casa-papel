import { describe, expect, it } from 'vitest'
import { cellKey, computeEngine } from '@/engine'
import { FxRateSchema, accountRef, newId, type Conversion } from '@/model'
import {
  CasaDb, Store, addRow, addRowOfKind, archiveRow, followRow, loadTables, quickCreateHousehold, setCellItems, setRule,
} from '@/store'
import { account, cellItems, household, row, tables, T0 } from './helpers'

/**
 * Rule X10 in the calculation: a part of a month's amount whose conversion was recorded counts as recorded, in the
 * household's currency and in every account it moves; only the rest is converted at the month's rate, as one amount,
 * as before. Each leg the calculation has is checked in both directions: an amount in another currency, and an
 * amount in the household's that moves an account in another.
 */
const months = ['2026-01', '2026-02']
const rate = (month: string, value: number) => FxRateSchema.parse({ pair: 'EUR/USD', month, rate: value, source: 'manual', updatedAt: T0 })
const RATES = [rate('2026-01', 1.1), rate('2026-02', 1.25)]
/** 3,300.00 dollars that came to 3,000.00 euros: 1.1000. */
const PAY: Conversion = { foreign: 'USD', foreignAmount: 3300_00, homeAmount: 3000_00, rate: 1.1, date: null }
/** 1,000.00 euros that bought 1,105.00 dollars. */
const DEPOSIT: Conversion = { foreign: 'USD', foreignAmount: 1105_00, homeAmount: 1000_00, rate: 1.105, date: null }

describe('an amount in another currency', () => {
  it('counts as recorded; the month\'s rate does not touch it', () => {
    const h = household()
    const pay = row({ name: 'Pay', section: 'income', currency: 'USD' })
    const at = (r: number) => computeEngine({ tables: tables({ household: [h], rows: [pay], cells: [cellItems(pay.id, '2026-01', [{ amount: 3300_00, status: 'done', conversion: PAY }])], fxRates: [rate('2026-01', r)] }), months })
    for (const r of [1.1, 1.2, 0.9]) {
      const c = at(r).cells[cellKey(pay.id, '2026-01')]
      expect(c.valueBase).toBe(3000_00)
      expect(c.missingRate).toBe(false)
    }
  })

  it('needs no rate for the month when all of it is recorded', () => {
    const h = household()
    const pay = row({ name: 'Pay', section: 'income', currency: 'USD' })
    const out = computeEngine({ tables: tables({ household: [h], rows: [pay], cells: [cellItems(pay.id, '2026-01', [{ amount: 3300_00, status: 'done', conversion: PAY }])] }), months: ['2026-01'] })
    expect(out.cells[cellKey(pay.id, '2026-01')]).toMatchObject({ valueBase: 3000_00, missingRate: false })
    expect(out.warnings).toEqual([])
  })

  it('the rest of the month is converted at the month\'s rate, as one amount', () => {
    const h = household()
    const pay = row({ name: 'Pay', section: 'income', currency: 'USD' })
    const cells = [cellItems(pay.id, '2026-01', [{ amount: 3300_00, status: 'done', conversion: PAY }, { amount: 110_00 }, { amount: 220_00 }])]
    const c = computeEngine({ tables: tables({ household: [h], rows: [pay], cells, fxRates: RATES }), months }).cells[cellKey(pay.id, '2026-01')]
    expect(c.valueBase).toBe(3000_00 + 300_00)
    expect(c.recorded?.map((p) => p.amount)).toEqual([3300_00])
  })

  it('counts at the month\'s rate while it is not done, and when it is left out it counts not at all', () => {
    const h = household()
    const pay = row({ name: 'Pay', section: 'income', currency: 'USD' })
    const of = (over: object) => computeEngine({ tables: tables({ household: [h], rows: [pay], cells: [cellItems(pay.id, '2026-01', [{ amount: 3300_00, conversion: PAY, ...over }])], fxRates: RATES }), months }).cells[cellKey(pay.id, '2026-01')]
    expect(of({ status: 'committed' })).toMatchObject({ valueBase: 3000_00 })
    expect(of({ status: 'committed' }).recorded).toBeUndefined()
    expect(of({ status: 'done', skipped: true })).toMatchObject({ value: 0, valueBase: 0 })
  })

  it('without a recorded conversion the cents are those of before', () => {
    const h = household()
    const pay = row({ name: 'Pay', section: 'income', currency: 'USD' })
    const cells = [cellItems(pay.id, '2026-01', [{ amount: 3333_33, status: 'done' }, { amount: 1_01 }])]
    const c = computeEngine({ tables: tables({ household: [h], rows: [pay], cells, fxRates: [rate('2026-01', 1.0873)] }), months }).cells[cellKey(pay.id, '2026-01')]
    expect(c.recorded).toBeUndefined()
    expect(c.valueBase).toBe(Math.round((3334_34 / 100 / 1.0873) * 100))
  })
})

describe('an amount that moves an account in another currency', () => {
  it('money moved into it arrives as recorded; the next month at its rate', () => {
    const h = household()
    const dollars = account({ name: 'Dollar savings', type: 'savings', currency: 'USD' })
    const move = row({ name: 'To dollars', section: 'transfer', kind: 'plain', accountId: dollars.id })
    const cells = [cellItems(move.id, '2026-01', [{ amount: 1000_00, status: 'done', conversion: DEPOSIT }]), cellItems(move.id, '2026-02', [{ amount: 1000_00 }])]
    const out = computeEngine({ tables: tables({ household: [h], rows: [move], accounts: [dollars], cells, fxRates: RATES }), months })
    expect(out.cells[cellKey(move.id, '2026-01')].valueBase).toBe(1000_00)
    expect(out.accounts[dollars.id].months['2026-01'].balance).toBe(1105_00)
    expect(out.accounts[dollars.id].months['2026-02'].balance).toBe(1105_00 + 1250_00)
  })

  it('an expense out of it takes what was recorded, from that source only', () => {
    const h = household()
    const dollars = account({ name: 'Dollar savings', type: 'savings', currency: 'USD', openingBalance: 1100_00 })
    const hosting = row({ name: 'Hosting', section: 'expense', defaultFundedBy: accountRef(dollars.id) })
    const cells = [cellItems(hosting.id, '2026-01', [
      { amount: 100_00, status: 'done', fundedBy: accountRef(dollars.id), conversion: { foreign: 'USD', foreignAmount: 112_00, homeAmount: 100_00, rate: 1.12, date: null } },
      { amount: 50_00, fundedBy: accountRef(dollars.id) },
      // from the month's income: the dollar account does not see it
      { amount: 30_00, status: 'done', conversion: { foreign: 'USD', foreignAmount: 40_00, homeAmount: 30_00, rate: 4 / 3, date: null } },
    ])]
    const out = computeEngine({ tables: tables({ household: [h], rows: [hosting], accounts: [dollars], cells, fxRates: RATES }), months })
    const c = out.cells[cellKey(hosting.id, '2026-01')]
    expect(c.valueBase).toBe(180_00)
    expect(c.funding.accounts[dollars.id]).toBe(150_00)
    expect(c.funding.cash).toBe(30_00)
    expect(out.accounts[dollars.id].months['2026-01'].balance).toBe(1100_00 - 112_00 - 55_00)
  })

  it('a deposit into an investment account with a fixed rate arrives as recorded; the rest at the fixed rate', () => {
    const h = household()
    const broker = account({ name: 'Broker', type: 'investment', currency: 'USD', investment: { projectionMode: 'fixed-rate', annualRate: 0, depositTiming: 'start', depositFxMode: 'fixed', fixedRate: 1.2 } })
    const deposit = row({ name: 'To broker', section: 'transfer', kind: 'to-investment', accountId: broker.id })
    const cells = [cellItems(deposit.id, '2026-01', [{ amount: 1000_00, status: 'done', conversion: DEPOSIT }, { amount: 100_00 }])]
    const out = computeEngine({ tables: tables({ household: [h], rows: [deposit], accounts: [broker], cells, fxRates: RATES }), months })
    expect(out.accounts[broker.id].months['2026-01'].balance).toBe(1105_00 + 120_00)
  })

  it('a payment cut to what is still owed keeps its recorded rate for what counts', () => {
    const h = household()
    const loan = account({ name: 'Dollar loan', type: 'loan', currency: 'USD', openingBalance: 105_00 })
    const payment = row({ name: 'Dollar loan – Payment', section: 'expense', kind: 'debt-payment', accountId: loan.id })
    const cells = [cellItems(payment.id, '2026-01', [{ amount: 200_00, status: 'done', conversion: { foreign: 'USD', foreignAmount: 210_00, homeAmount: 200_00, rate: 1.05, date: null } }])]
    const out = computeEngine({ tables: tables({ household: [h], rows: [payment], accounts: [loan], cells, fxRates: RATES }), months })
    const c = out.cells[cellKey(payment.id, '2026-01')]
    // half of it was still owed: half counts, at the recorded rate
    expect(c).toMatchObject({ value: 100_00, valueBase: 100_00, asked: 200_00 })
    expect(c.recorded?.[0].conversion).toMatchObject({ foreignAmount: 105_00, homeAmount: 100_00, rate: 1.05 })
    expect(out.accounts[loan.id].months['2026-01'].balance).toBe(0)
  })

  it('a payment to a card in another currency brings it down by what was recorded', () => {
    const h = household()
    const card = account({ name: 'Dollar card', type: 'credit-card', currency: 'USD', openingBalance: 330_00 })
    const payment = row({ name: 'Dollar card – Payment', section: 'expense', kind: 'card-payment', accountId: card.id })
    const cells = [cellItems(payment.id, '2026-01', [{ amount: 200_00, status: 'done', conversion: { foreign: 'USD', foreignAmount: 210_00, homeAmount: 200_00, rate: 1.05, date: null } }])]
    const out = computeEngine({ tables: tables({ household: [h], rows: [payment], accounts: [card], cells, fxRates: RATES }), months })
    expect(out.accounts[card.id].months['2026-01'].balance).toBe(120_00)
  })
})

describe('a row that follows a recorded amount', () => {
  it('takes the same share of it, as recorded', () => {
    const h = household()
    const pay = row({ name: 'Pay', section: 'income', currency: 'USD' })
    const tax = row({ name: 'Tax', section: 'expense', followsRowId: pay.id, followShare: 0.25 })
    const out = computeEngine({ tables: tables({ household: [h], rows: [pay, tax], cells: [cellItems(pay.id, '2026-01', [{ amount: 3300_00, status: 'done', conversion: PAY }])], fxRates: [rate('2026-01', 1.2)] }), months })
    const c = out.cells[cellKey(tax.id, '2026-01')]
    expect(c).toMatchObject({ value: 825_00, currency: 'USD', valueBase: 750_00 })
  })

  /** "Pay" recorded in January at 1.1000 while the month's rate is 1.2000; "Tax" follows a quarter of it. */
  async function followed() {
    const store = new Store(new CasaDb(`test-${newId()}`))
    await quickCreateHousehold(store, { name: 'Test', baseCurrency: 'EUR', locale: 'en-IE', startMonth: '2026-01' })
    await store.commit([{ op: 'put', table: 'fxRates', record: rate('2026-01', 1.2) }, { op: 'put', table: 'fxRates', record: rate('2026-02', 1.2) }, { op: 'put', table: 'fxRates', record: rate('2026-03', 1.2) }])
    const pay = await addRow(store, { name: 'Pay', section: 'income', categoryId: null, currency: 'USD' })
    const tax = await addRow(store, { name: 'Tax', section: 'expense', categoryId: null })
    await setCellItems(store, pay.id, '2026-01', [{ id: newId(), label: '', amount: 3300_00, status: 'done', fundedBy: 'cash', date: null, note: null, recurringItemId: null, kind: 'normal', skipped: false, conversion: PAY }], 'this-month')
    await followRow(store, tax.id, pay.id, 0.25)
    return { store, pay, tax }
  }
  const taxIn = async (store: Store, taxId: string) => computeEngine({ tables: await loadTables(store), months: ['2026-01'] }).cells[cellKey(taxId, '2026-01')]

  it('keeps it when the followed row is archived and the months are written down', async () => {
    const { store, pay, tax } = await followed()
    expect((await taxIn(store, tax.id)).valueBase).toBe(750_00)
    await archiveRow(store, pay.id, '2026-03')
    const c = await taxIn(store, tax.id)
    expect(c.valueBase).toBe(750_00)
    expect(c.recorded?.[0].conversion).toMatchObject({ foreignAmount: 825_00, homeAmount: 750_00, rate: 1.1 })
  })

  it('keeps it when a rule takes the row over from a later month', async () => {
    const { store, pay } = await followed()
    // a quarter of the pay goes to savings, until a fixed amount does from March
    const savings = (await loadTables(store)).accounts.find((a) => a.type === 'savings')!
    const put = await addRowOfKind(store, { section: 'transfer', name: 'Put aside', categoryId: null, kind: 'to-savings', accountId: savings.id })
    await followRow(store, put.id, pay.id, 0.25)
    expect((await taxIn(store, put.id)).valueBase).toBe(750_00)
    await setRule(store, { rowId: put.id }, { kind: 'fixed', amount: 500_00 }, '2026-03')
    const c = await taxIn(store, put.id)
    expect(c.valueBase).toBe(750_00)
    expect(c.recorded?.[0].conversion).toMatchObject({ foreignAmount: 825_00, homeAmount: 750_00, rate: 1.1 })
  })
})

describe('a category\'s estimate', () => {
  it('counts what its rows leave at the month\'s rate: nothing of that was recorded', () => {
    const h = household()
    const estimate = row({ name: 'Travel', section: 'expense', kind: 'category-estimate', currency: 'USD' })
    const out = computeEngine({ tables: tables({ household: [h], rows: [estimate], cells: [cellItems(estimate.id, '2026-01', [{ amount: 3300_00, status: 'done', conversion: PAY }])], fxRates: RATES }), months })
    expect(out.cells[cellKey(estimate.id, '2026-01')].recorded).toBeUndefined()
  })
})
