import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { computeEngine } from '@/engine'
import { growthChangedFrom, growthIn, newId, type InvestmentSettings } from '@/model'
import { CasaDb, Store, addAccount, defaultMonths, loadTables, pastGuard, quickCreateHousehold, updateAccount, type PastAnswer, type PastQuestion } from '@/store'
import { growthText } from '@/features/household/growthText'
import { restoreToday, setToday } from '../today'

/**
 * An investment's growth from a month on (rule T4: "Only from <Month> on"). Today is 15 June 2026; "Index fund" opened
 * in January with 10,000.00 at 6% a year.
 */
const SIX: InvestmentSettings = { projectionMode: 'fixed-rate', annualRate: 0.06, depositTiming: 'start', depositFxMode: 'monthly-rate', fixedRate: null }

async function fresh(answer: PastAnswer) {
  const store = new Store(new CasaDb(`test-${newId()}`))
  await quickCreateHousehold(store, { name: 'Test', baseCurrency: 'EUR', locale: 'en-IE', startMonth: '2026-01' })
  const fund = await addAccount(store, { name: 'Index fund', type: 'investment', currency: 'EUR', openingMonth: '2026-01', openingBalance: 10000_00, investment: SIX })
  const asked: PastQuestion[] = []
  store.setGuard(pastGuard(store, async (q) => {
    asked.push(q)
    return answer
  }))
  const balance = async (m: string) => {
    const tables = await loadTables(store)
    return computeEngine({ tables, months: defaultMonths(tables.household[0], tables, '2026-06') }).accounts[fund.id].months[m].balance
  }
  const stored = async () => (await loadTables(store)).accounts.find((a) => a.id === fund.id)!
  return { store, fund, asked, balance, stored }
}

describe('growth from a month on', () => {
  beforeEach(() => setToday('2026-06-15'))
  afterEach(restoreToday)

  it('"Only from June 2026 on": the months before keep 6%, June grows at 12%', async () => {
    const { store, fund, asked, balance, stored } = await fresh('from-now')
    await updateAccount(store, fund.id, { investment: { ...SIX, annualRate: 0.12 } })
    expect(asked[0].fromNow).toBe('2026-06')
    expect(await balance('2026-05')).toBe(10245_76)
    expect(await balance('2026-06')).toBe(10342_98)
    expect((await stored()).investment).toMatchObject({ annualRate: 0.06, rateChanges: [{ from: '2026-06', annualRate: 0.12 }] })
  })

  it('"Save anyway": every month at the new rate, and no dated change is kept', async () => {
    const { store, fund, balance, stored } = await fresh('save')
    await updateAccount(store, fund.id, { investment: { ...SIX, rateChanges: [{ from: '2026-03', annualRate: 0.08 }], annualRate: 0.12 } })
    expect(await balance('2026-01')).toBe(Math.round(10000_00 * Math.pow(1.12, 1 / 12)))
    expect((await stored()).investment?.rateChanges).toBeUndefined()
  })

  it('a save that leaves the growth as it is now keeps the dated change: a rename, or the form sending this month\'s rate', async () => {
    const { store, fund, asked, stored } = await fresh('from-now')
    await updateAccount(store, fund.id, { investment: { ...SIX, annualRate: 0.12 } })
    // the form builds the investment afresh, with the rate the field shows: June's
    await updateAccount(store, fund.id, { name: 'World fund', investment: { ...SIX, annualRate: 0.12 } })
    expect(asked).toHaveLength(1)
    expect(await stored()).toMatchObject({ name: 'World fund', investment: { annualRate: 0.06, rateChanges: [{ from: '2026-06', annualRate: 0.12 }] } })
  })

  it('an account that opens this month or later has no past: nothing asks, and the rate is the account\'s', async () => {
    const { store, asked } = await fresh('cancel')
    const later = await addAccount(store, { name: 'New fund', type: 'investment', currency: 'EUR', openingMonth: '2026-07', openingBalance: 100_00, investment: SIX })
    await updateAccount(store, later.id, { investment: { ...SIX, annualRate: 0.12 } })
    expect(asked).toHaveLength(0)
    expect((await loadTables(store)).accounts.find((a) => a.id === later.id)?.investment?.annualRate).toBe(0.12)
  })
})

describe('the growth of a month', () => {
  it('the latest change from that month or earlier, else the account\'s rate; a new change replaces those from its month on', () => {
    const inv = { annualRate: 0.06, rateChanges: [{ from: '2026-06', annualRate: 0.12 }, { from: '2026-03', annualRate: 0.08 }] }
    expect(growthIn(inv, '2026-02')).toBe(0.06)
    expect(growthIn(inv, '2026-03')).toBe(0.08)
    expect(growthIn(inv, '2026-09')).toBe(0.12)
    expect(growthIn({ annualRate: 0.05 }, '2026-09')).toBe(0.05)
    expect(growthChangedFrom(inv, '2026-05', 0.1)).toEqual([{ from: '2026-03', annualRate: 0.08 }, { from: '2026-05', annualRate: 0.1 }])
  })

  it('the form says it in one line', () => {
    expect(growthText({ ...SIX, rateChanges: [{ from: '2026-06', annualRate: 0.12 }] }, 'en-IE')).toBe('6% a year until May 2026, 12% from June 2026')
    expect(growthText({ ...SIX, rateChanges: [{ from: '2026-06', annualRate: 0.12 }, { from: '2027-01', annualRate: 0.04 }] }, 'en-IE'))
      .toBe('6% a year until May 2026, 12% from June 2026 until December 2026, 4% from January 2027')
    expect(growthText(SIX, 'en-IE')).toBeNull()
  })
})
