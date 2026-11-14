import { describe, expect, it } from 'vitest'
import { FxRateSchema, poolRef, type Account, type Row } from '@/model'
import { cellKey, computeEngine } from '@/engine'
import { T0, account, actual, cellItems, cellValue, household, pool, row, tables } from './helpers'

const fx = (pair: string, month: string, rate: number) => FxRateSchema.parse({ pair, month, rate, source: 'manual', updatedAt: T0 })
const JAN = '2026-01'
/** 1 USD = 0.90 EUR: 90 euros are 100 dollars. */
const RATE = [fx('USD/EUR', JAN, 0.9)]

/** A household in euros whose savings account is kept in `currency` and holds 1,000 of it. */
function world(currency: string, closingRule: 'savings-plug' | 'leftover-plug' = 'leftover-plug') {
  const savings = account({ name: 'Dollar savings', type: 'savings', currency, openingBalance: 1000_00 })
  const salary = row({ name: 'Salary', section: 'income', order: 'a0' })
  const rent = row({ name: 'Rent', section: 'expense', order: 'b0' })
  const toSavings = row({ name: 'To savings', section: 'transfer', kind: 'to-savings', accountId: savings.id, order: 'c0' })
  return { h: household({ closingRule }), savings, salary, rent, toSavings }
}
const run = (w: ReturnType<typeof world>, over: { rows?: Row[]; accounts?: Account[]; cells?: ReturnType<typeof cellValue>[]; pools?: ReturnType<typeof pool>[]; fxRates?: ReturnType<typeof fx>[]; accountMonths?: ReturnType<typeof actual>[] }, months = [JAN]) =>
  computeEngine({
    tables: tables({
      household: [w.h], accounts: [w.savings, ...(over.accounts ?? [])], rows: [w.salary, w.rent, w.toSavings, ...(over.rows ?? [])],
      cells: [cellValue(w.salary.id, JAN, 3000_00), cellValue(w.rent.id, JAN, 1200_00), ...(over.cells ?? [])],
      pools: over.pools ?? [], fxRates: over.fxRates ?? RATE, accountMonths: over.accountMonths ?? [],
    }),
    months,
  })

describe('engine: a savings account kept in another currency', () => {
  it('receives a euro amount converted at the month\'s rate', () => {
    const w = world('USD')
    const out = run(w, { cells: [cellValue(w.toSavings.id, JAN, 90_00)] })
    // 90 euros left the month and 100 dollars arrived: the same money on both sides
    expect(out.totals[JAN].toSavings).toBe(90_00)
    expect(out.accounts[w.savings.id].months[JAN]).toMatchObject({ inflow: 100_00, balance: 1100_00, balanceBase: 990_00 })
    expect(out.warnings).toEqual([])
  })

  it('receives an amount typed in its own currency exactly as typed', () => {
    const w = world('USD')
    const dollars = { ...w.toSavings, currency: 'USD' }
    // 444.44 USD are 406.08 EUR at this rate, and 406.08 EUR would come back as 444.43 USD
    const out = computeEngine({
      tables: tables({ household: [w.h], accounts: [w.savings], rows: [w.salary, dollars], cells: [cellValue(w.salary.id, JAN, 3000_00), cellValue(dollars.id, JAN, 444_44)], fxRates: [fx('USD/EUR', JAN, 0.9137)] }),
      months: [JAN],
    })
    expect(out.cells[cellKey(dollars.id, JAN)].valueBase).toBe(406_08)
    expect(out.accounts[w.savings.id].months[JAN]).toMatchObject({ inflow: 444_44, balance: 1444_44 })
  })

  it('receives the rest of the month, and gives it back in a month that overran', () => {
    const w = world('USD', 'savings-plug')
    const out = run(w, {})
    // 3,000 − 1,200 = 1,800 euros are 2,000 dollars
    expect(out.totals[JAN].toSavings).toBe(1800_00)
    expect(out.accounts[w.savings.id].months[JAN]).toMatchObject({ inflow: 2000_00, balance: 3000_00 })
    const short = run(w, { cells: [cellValue(w.rent.id, JAN, 3900_00)] })
    // 900 euros short: 1,000 dollars come back out
    expect(short.totals[JAN].toSavings).toBe(-900_00)
    expect(short.accounts[w.savings.id].months[JAN]).toMatchObject({ inflow: -1000_00, balance: 0 })
  })

  it('receives what a percentage rule works out', () => {
    const w = world('USD')
    const ruled = { ...w.toSavings, rule: 'share-of-income' as const, ruleShare: 0.1 }
    const out = computeEngine({
      tables: tables({ household: [w.h], accounts: [w.savings], rows: [w.salary, w.rent, ruled], cells: [cellValue(w.salary.id, JAN, 3000_00), cellValue(w.rent.id, JAN, 1200_00)], fxRates: RATE }),
      months: [JAN],
    })
    // 10% of 3,000 euros: 300 euros, 333.33 dollars
    expect(out.cells[cellKey(ruled.id, JAN)]).toMatchObject({ valueBase: 300_00, source: 'derived' })
    expect(out.accounts[w.savings.id].months[JAN].inflow).toBe(333_33)
  })

  it('gives up what is taken out of it by hand, in euros or in its own currency', () => {
    const w = world('USD')
    const repair = row({ name: 'Car repair', section: 'transfer', kind: 'from-savings', accountId: w.savings.id, order: 'c1' })
    const gift = row({ name: 'Gift', section: 'transfer', kind: 'from-savings', accountId: w.savings.id, currency: 'USD', order: 'c2' })
    const out = run(w, { rows: [repair, gift], cells: [cellValue(repair.id, JAN, 45_00), cellValue(gift.id, JAN, 33_33)] })
    // 45 euros are 50 dollars; 33.33 dollars are 33.33 dollars
    expect(out.accounts[w.savings.id].months[JAN]).toMatchObject({ outflow: 50_00 + 33_33, balance: 1000_00 - 83_33 })
    // the month receives both in euros
    expect(out.totals[JAN].fromAccounts).toBe(45_00 + 30_00)
  })

  it('follows its virtual accounts, which stay in the household currency', () => {
    const w = world('USD')
    const travel = pool({ name: 'Travel', accountId: w.savings.id, openingBalance: 100_00 })
    const fill = row({ name: 'To Travel', section: 'transfer', kind: 'pool-allocation', accountId: w.savings.id, order: 'c1' })
    travel.allocationRowId = fill.id
    const trips = row({ name: 'Trips', section: 'expense', defaultFundedBy: poolRef(travel.id), order: 'b1' })
    const hotel = row({ name: 'Hotel', section: 'expense', currency: 'USD', order: 'b2' })
    const out = run(w, {
      rows: [fill, trips, hotel], pools: [travel],
      cells: [cellValue(fill.id, JAN, 90_00), cellValue(trips.id, JAN, 45_00), cellItems(hotel.id, JAN, [{ amount: 30_00, fundedBy: poolRef(travel.id) }])],
    })
    // the virtual account: 100 + 90 set aside − 45 − 27 (30 dollars), all in euros
    expect(out.pools[travel.id].months[JAN]).toMatchObject({ allocation: 90_00, spend: 45_00 + 27_00, balance: 100_00 + 90_00 - 72_00 })
    // the account that holds it: +100 dollars set aside, −50 for the trip, −30 for the hotel as typed
    expect(out.accounts[w.savings.id].months[JAN]).toMatchObject({ inflow: 100_00, outflow: 50_00 + 30_00, balance: 1000_00 + 100_00 - 80_00 })
    expect(out.totals[JAN].fundedOwn).toEqual({ [poolRef(travel.id)]: { EUR: 45_00, USD: 30_00 } })
  })

  it('gives up what the old "Savings balance" paid, as typed when it was typed in its currency', () => {
    const w = world('USD')
    const boiler = row({ name: 'Boiler', section: 'expense', order: 'b1' })
    const flight = row({ name: 'Flight', section: 'expense', currency: 'USD', order: 'b2' })
    const out = run(w, {
      rows: [boiler, flight],
      cells: [cellItems(boiler.id, JAN, [{ amount: 90_00, fundedBy: 'savings' }]), cellItems(flight.id, JAN, [{ amount: 20_00, fundedBy: 'savings' }])],
    })
    expect(out.primarySavingsId).toBe(w.savings.id)
    expect(out.totals[JAN].savingsFunded).toBe(90_00 + 18_00)
    expect(out.accounts[w.savings.id].months[JAN]).toMatchObject({ outflow: 100_00 + 20_00, balance: 1000_00 - 120_00 })
  })

  it('continues from a real balance, and says how far the plan was off in its own currency', () => {
    const w = world('USD')
    const out = run(w, { cells: [cellValue(w.toSavings.id, JAN, 90_00)], accountMonths: [actual(w.savings.id, JAN, 1250_00)], fxRates: [...RATE, fx('USD/EUR', '2026-02', 0.9)] }, [JAN, '2026-02'])
    expect(out.accounts[w.savings.id].months[JAN]).toMatchObject({ computed: 1100_00, balance: 1250_00, adjustment: 150_00 })
    // February inherits the 90 euros and adds another 100 dollars to what the bank said
    expect(out.accounts[w.savings.id].months['2026-02'].balance).toBe(1350_00)
  })

  it('without a rate adds the amount as it is and says so once', () => {
    const w = world('USD')
    const out = run(w, { cells: [cellValue(w.toSavings.id, JAN, 90_00)], fxRates: [] })
    expect(out.accounts[w.savings.id].months[JAN]).toMatchObject({ inflow: 90_00, missingRate: true })
    expect(out.warnings).toContain('No EUR→USD rate for 2026-01 (Dollar savings)')
  })

  it('leaves an account in the household currency on the figures it always had', () => {
    const w = world('EUR')
    const travel = pool({ name: 'Travel', accountId: w.savings.id, openingBalance: 100_00 })
    const fill = row({ name: 'To Travel', section: 'transfer', kind: 'pool-allocation', accountId: w.savings.id, order: 'c1' })
    travel.allocationRowId = fill.id
    const trips = row({ name: 'Trips', section: 'expense', defaultFundedBy: poolRef(travel.id), order: 'b1' })
    const flight = row({ name: 'Flight', section: 'expense', currency: 'USD', order: 'b2' })
    const repair = row({ name: 'Car repair', section: 'transfer', kind: 'from-savings', accountId: w.savings.id, currency: 'USD', order: 'c2' })
    const dollars = { ...w.toSavings, currency: 'USD' }
    const out = computeEngine({
      tables: tables({
        household: [w.h], accounts: [w.savings], rows: [w.salary, w.rent, dollars, fill, trips, flight, repair], pools: [travel], fxRates: [fx('USD/EUR', JAN, 0.9137)],
        cells: [
          cellValue(w.salary.id, JAN, 3000_00), cellValue(w.rent.id, JAN, 1200_00), cellValue(dollars.id, JAN, 444_44), cellValue(fill.id, JAN, 90_00),
          cellValue(trips.id, JAN, 45_00), cellItems(flight.id, JAN, [{ amount: 33_33, fundedBy: 'savings' }]), cellValue(repair.id, JAN, 11_11),
        ],
      }),
      months: [JAN],
    })
    const base = (r: Row) => out.cells[cellKey(r.id, JAN)].valueBase
    // every amount in euros, each converted once: what the month's totals hold
    expect(out.accounts[w.savings.id].months[JAN]).toMatchObject({
      inflow: base(dollars) + 90_00,
      outflow: out.totals[JAN].savingsFunded + 45_00 + base(repair),
      balance: 1000_00 + 406_08 + 90_00 - 30_45 - 45_00 - 10_15,
    })
  })
})
