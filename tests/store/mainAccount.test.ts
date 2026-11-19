import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { computeEngine } from '@/engine'
import { CellSchema, FxRateSchema, HouseholdSchema, RowSchema, monthRange, newId, type Account, type Tables } from '@/model'
import {
  CasaDb, Store, addAccount, addRowOfKind, archiveAccount, buildSetupMutations, checkFile, exportSnapshot, loadTables, mainAccountChoice, pastGuard,
  planMainAccount, quickCreateHousehold, restoreThing, setMainAccount, updateAccount, type PastQuestion,
} from '@/store'
import { applyMutations } from '@/store/impact'
import { restoreToday, setToday } from '../today'

/**
 * Rule B9 in the store: one main account open at a time, in the household's currency, and the upgrade that puts a
 * household from before the rule right. Today is 15 April 2026; the household begins in January 2026, in EUR.
 */
const MONTHS = monthRange('2026-01', '2026-03')
const SECOND = '"Joint account" would be a second main account; the household has "Main account". Another everyday account is an "Other current account": it keeps a balance of its own.'

async function fresh() {
  const store = new Store(new CasaDb(`test-${newId()}`))
  await quickCreateHousehold(store, { name: 'T', baseCurrency: 'EUR', locale: 'en-IE', startMonth: '2026-01', closingRule: 'leftover-plug' })
  const asked: PastQuestion[] = []
  store.setGuard(pastGuard(store, async (q) => {
    asked.push(q)
    return 'save'
  }))
  return { store, asked }
}

const account = (store: Store, name: string, type: Account['type'], over: Partial<Account> = {}) =>
  addAccount(store, { name, type, currency: 'EUR', openingMonth: '2026-01', openingBalance: 0, ...over })

describe('one main account: what is refused', () => {
  beforeEach(() => setToday('2026-04-15'))
  afterEach(restoreToday)

  it('a second main account, and one in another currency', async () => {
    const { store } = await fresh()
    await account(store, 'Main account', 'checking', { openingBalance: 1000_00 })
    await expect(account(store, 'Joint account', 'checking')).rejects.toThrow(SECOND)
    const usd = await account(store, 'Dollar account', 'joint', { currency: 'USD' })
    await expect(updateAccount(store, usd.id, { type: 'checking' })).rejects.toThrow('The main account is in the household\'s currency, EUR. An account in USD is an "Other current account".')
    const joint = await account(store, 'Joint account', 'joint')
    await expect(updateAccount(store, joint.id, { type: 'checking' })).rejects.toThrow(SECOND)
    expect((await loadTables(store)).accounts.filter((a) => a.type === 'checking').map((a) => a.name)).toEqual(['Main account'])
  })

  it('an account that rows move money into or take money out of, made the main account: that money would leave the plan', async () => {
    const { store } = await fresh()
    const joint = await account(store, 'Joint account', 'joint', { openingBalance: 300_00 })
    await addRowOfKind(store, { section: 'transfer', name: '', categoryId: null, kind: 'plain', accountId: joint.id })
    await expect(updateAccount(store, joint.id, { type: 'checking' }))
      .rejects.toThrow('"To Joint account" moves money into "Joint account" or out of it, and the main account is the month\'s money itself: that money would leave the plan. Point it at another account first.')
    // an account nothing moves money into can become the main account
    const other = await account(store, 'Partner', 'joint')
    await updateAccount(store, other.id, { type: 'checking' })
    expect((await loadTables(store)).accounts.find((a) => a.id === other.id)?.type).toBe('checking')
  })

  it('an archived main account is history: a new one can replace it, and it cannot be restored while that one is open', async () => {
    const { store } = await fresh()
    const old = await account(store, 'Main account', 'checking', { openingBalance: 1000_00 })
    await archiveAccount(store, old.id, '2026-03')
    const next = await account(store, 'New main', 'checking', { openingMonth: '2026-03' })
    await updateAccount(store, old.id, { name: 'Old main' })
    await expect(restoreThing(store, { kind: 'account', id: old.id })).rejects.toThrow('"Old main" would be a second main account; the household has "New main".')
    await archiveAccount(store, next.id, '2026-04')
    await restoreThing(store, { kind: 'account', id: old.id })
    expect((await loadTables(store)).accounts.find((a) => a.id === old.id)?.archivedMonth).toBeNull()
  })

  it('a new household from the guided setup has one main account at most', () => {
    const household = { name: 'T', baseCurrency: 'EUR', locale: 'en-IE', startMonth: '2026-01' }
    const input = { household, adults: [], dependents: [], householdTemplates: [], entityTemplates: {} }
    expect(() => buildSetupMutations({ ...input, accounts: [{ name: 'Main account', type: 'checking' }, { name: 'Joint account', type: 'checking' }] })).toThrow(SECOND)
    expect(() => buildSetupMutations({ ...input, accounts: [{ name: 'Dollars', type: 'checking', currency: 'USD' }] })).toThrow(/household's currency, EUR/)
    const ok = buildSetupMutations({ ...input, accounts: [{ name: 'Main account', type: 'checking' }, { name: 'Joint account', type: 'joint' }] })
    expect(ok.household.askMainAccount).toBe(false)
  })
})

/** A household as an app from before rule B9 left it: no mark, and the accounts typed as they were then. */
async function before(accounts: Array<Partial<Account> & { name: string; type: Account['type'] }>, extra: (t: Tables) => Partial<Tables> = () => ({})) {
  const { store, asked } = await fresh()
  const made: Account[] = []
  // made as savings accounts, then given the types the older app stored them with: written below the store's checks,
  // as a sync from that app would
  for (const [i, a] of accounts.entries()) made.push(await account(store, a.name, 'savings', { ...a, type: 'savings', order: `a${i}` }))
  const t = await loadTables(store)
  const h = t.household[0]
  await store.commitSystem([
    { op: 'put', table: 'household', record: HouseholdSchema.parse({ ...h, askMainAccount: undefined }) },
    ...made.map((m, i) => ({ op: 'put' as const, table: 'accounts' as const, record: { ...t.accounts.find((x) => x.id === m.id)!, ...accounts[i], tracked: false } })),
  ])
  const more = extra(await loadTables(store))
  const muts = Object.entries(more).flatMap(([table, records]) => (records as unknown[]).map((record) => ({ op: 'put' as const, table: table as keyof Tables, record })))
  if (muts.length) await store.commitSystem(muts as never)
  const ids = Object.fromEntries(made.map((m) => [m.name, m.id]))
  return { store, asked, ids }
}

const netWorth = (t: Tables) => {
  const out = computeEngine({ tables: t, months: MONTHS })
  return MONTHS.map((m) => out.netWorth[m])
}
const upgraded = (t: Tables) => applyMutations(t, planMainAccount(t))

/** 1,000 in and 700 out every month: 300 stays. */
const month = (t: Tables): Partial<Tables> => {
  const salary = RowSchema.parse({ id: newId(), createdAt: 0, updatedAt: 0, name: 'Salary', section: 'income', order: 'r0' })
  const rent = RowSchema.parse({ id: newId(), createdAt: 0, updatedAt: 0, name: 'Rent', section: 'expense', order: 'r1' })
  void t
  return {
    rows: [salary, rent],
    cells: [CellSchema.parse({ rowId: salary.id, month: '2026-01', mode: 'value', value: 1000_00, items: [], updatedAt: 0 }), CellSchema.parse({ rowId: rent.id, month: '2026-01', mode: 'value', value: 700_00, items: [], updatedAt: 0 })],
  }
}

describe('the upgrade: a household from before rule B9', () => {
  beforeEach(() => setToday('2026-04-15'))
  afterEach(restoreToday)

  it('a current and a joint account: the current one is the main account, the joint one keeps its own balance, net worth is what the older app showed, and the household is asked', async () => {
    const { store, ids } = await before([{ name: 'Main account', type: 'checking', openingBalance: 1200_00 }, { name: 'Joint account', type: 'joint', openingBalance: 300_00 }], month)
    const t = await loadTables(store)
    const plan = planMainAccount(t)
    // nothing to retype: only the mark
    expect(plan.map((m) => m.table)).toEqual(['household'])
    const after = applyMutations(t, plan)
    expect(after.household[0].askMainAccount).toBe(true)
    // the older app counted both in one line: 1,500 and 300 a month on it
    expect(netWorth(after)).toEqual([1800_00, 2100_00, 2400_00])
    const out = computeEngine({ tables: after, months: MONTHS })
    expect(MONTHS.map((m) => out.main!.months[m].balance)).toEqual([1500_00, 1800_00, 2100_00])
    expect(MONTHS.map((m) => out.accounts[ids['Joint account']].months[m].balance)).toEqual([300_00, 300_00, 300_00])
    expect(mainAccountChoice(after)).toMatchObject({ eligible: [{ name: 'Main account' }, { name: 'Joint account' }], foreign: [], mainId: ids['Main account'] })
  })

  it('real balances typed for both together stay, each on its own account, and net worth is what it was', async () => {
    const { store, ids } = await before([{ name: 'Main account', type: 'checking', openingBalance: 1200_00 }, { name: 'Joint account', type: 'joint', openingBalance: 300_00 }], (t) => ({
      ...month(t),
      accountMonths: [
        { accountId: t.accounts.find((a) => a.name === 'Main account')!.id, month: '2026-01', actualBalance: 1400_00, updatedAt: 0 },
        { accountId: t.accounts.find((a) => a.name === 'Joint account')!.id, month: '2026-01', actualBalance: 250_00, updatedAt: 0 },
      ],
    }))
    const after = upgraded(await loadTables(store))
    // the older app: 1,650 together in January, then 300 a month on it
    expect(netWorth(after)).toEqual([1650_00, 1950_00, 2250_00])
    const out = computeEngine({ tables: after, months: MONTHS })
    expect(out.main!.months['2026-01']).toMatchObject({ entered: true, balance: 1400_00 })
    expect(out.accounts[ids['Joint account']].months['2026-03']).toMatchObject({ balance: 250_00 })
  })

  it('two current accounts: the first is the main account and the other becomes an other current account', async () => {
    const { store, ids } = await before([{ name: 'Main account', type: 'checking', openingBalance: 1000_00 }, { name: 'Second', type: 'checking', openingBalance: 400_00 }], month)
    const t = await loadTables(store)
    const plan = planMainAccount(t)
    const after = applyMutations(t, plan)
    expect(after.accounts.map((a) => [a.name, a.type])).toEqual(expect.arrayContaining([['Main account', 'checking'], ['Second', 'joint']]))
    // the converted record keeps its stamp, plus one
    const second = t.accounts.find((a) => a.id === ids.Second)!
    expect(after.accounts.find((a) => a.id === ids.Second)!.updatedAt).toBe(second.updatedAt + 1)
    expect(netWorth(after)).toEqual([1700_00, 2000_00, 2300_00])
    // the same on every device, and nothing more the second time
    expect(planMainAccount(t)).toEqual(plan)
    expect(planMainAccount(after)).toEqual([])
  })

  it('without a current account but with a joint one in the household\'s currency, that one is the main account; with one alone nobody is asked', async () => {
    const { store } = await before([{ name: 'Joint account', type: 'joint', openingBalance: 500_00 }])
    const after = upgraded(await loadTables(store))
    expect(after.accounts.find((a) => a.name === 'Joint account')?.type).toBe('checking')
    expect(after.household[0].askMainAccount).toBe(false)
    expect(netWorth(after)).toEqual([500_00, 500_00, 500_00])
  })

  it('an archived current account becomes a main account: its money stays in the line, as it did', async () => {
    const { store } = await before([{ name: 'Main account', type: 'checking', openingBalance: 1000_00 }, { name: 'Old joint', type: 'joint', openingBalance: 500_00, archivedMonth: '2026-02' }])
    const after = upgraded(await loadTables(store))
    expect(after.accounts.find((a) => a.name === 'Old joint')?.type).toBe('checking')
    // one open current account: nobody is asked
    expect(after.household[0].askMainAccount).toBe(false)
    expect(netWorth(after)).toEqual([1500_00, 1500_00, 1500_00])
  })

  it('one in another currency becomes an other current account, worth what each month\'s rate makes of it: the one case where net worth moves', async () => {
    const rates = ['2026-01', '2026-02', '2026-03'].map((m, i) => FxRateSchema.parse({ pair: 'EUR/USD', month: m, rate: [1.1, 1.25, 1][i], source: 'api', updatedAt: 0 }))
    const { store, ids } = await before([{ name: 'Main account', type: 'checking' }, { name: 'Dollar account', type: 'checking', currency: 'USD', openingBalance: 1100_00 }], () => ({ fxRates: rates }))
    const t = await loadTables(store)
    // the older app converted it once, when it opened: 1,000 in every month
    expect(netWorth(t)).toEqual([1000_00, 1000_00, 1000_00])
    const after = upgraded(t)
    expect(after.accounts.find((a) => a.id === ids['Dollar account'])?.type).toBe('joint')
    expect(netWorth(after)).toEqual([1000_00, 880_00, 1100_00])
    // the question has one account to offer, and says the other is in dollars
    expect(after.household[0].askMainAccount).toBe(true)
    expect(mainAccountChoice(after)).toMatchObject({ eligible: [{ name: 'Main account' }], foreign: [{ name: 'Dollar account' }] })
  })

  it('a household made since rule B9 is marked done and has nothing to upgrade', async () => {
    const { store } = await fresh()
    await account(store, 'Main account', 'checking')
    await account(store, 'Joint account', 'joint')
    const t = await loadTables(store)
    expect(t.household[0].askMainAccount).toBe(false)
    expect(planMainAccount(t)).toEqual([])
  })

  it('after the upgrade, a second open main account from an older app is put right without asking again', async () => {
    const { store } = await fresh()
    await account(store, 'Main account', 'checking')
    const extra = await account(store, 'Joint account', 'joint')
    const t = await loadTables(store)
    await store.commitSystem([{ op: 'put', table: 'accounts', record: { ...t.accounts.find((a) => a.id === extra.id)!, type: 'checking' } }])
    const plan = planMainAccount(await loadTables(store))
    expect(plan).toHaveLength(1)
    expect(plan[0]).toMatchObject({ table: 'accounts', record: { id: extra.id, type: 'joint' } })
  })
})

describe('the question after the upgrade', () => {
  beforeEach(() => setToday('2026-04-15'))
  afterEach(restoreToday)

  it('choosing the other one makes it the main account; the old one keeps a balance of its own, net worth stays, and nothing asks about the past', async () => {
    const { store, asked, ids } = await before([{ name: 'Main account', type: 'checking', openingBalance: 1200_00 }, { name: 'Joint account', type: 'joint', openingBalance: 300_00 }], month)
    await store.commitSystem(planMainAccount(await loadTables(store)))
    await setMainAccount(store, ids['Joint account'])
    const t = await loadTables(store)
    expect(t.accounts.filter((a) => !a.deletedAt && a.type !== 'savings').map((a) => [a.name, a.type])).toEqual([['Main account', 'joint'], ['Joint account', 'checking']])
    expect(t.household[0].askMainAccount).toBe(false)
    expect(asked).toHaveLength(0)
    expect(netWorth(t)).toEqual([1800_00, 2100_00, 2400_00])
    const out = computeEngine({ tables: t, months: MONTHS })
    expect(out.main!.months['2026-03'].balance).toBe(1200_00)
    await expect(setMainAccount(store, ids['Main account'] + 'x')).rejects.toThrow(/household's currency, EUR/)
  })

  it('keeping the upgrade\'s pick only clears the mark', async () => {
    const { store } = await before([{ name: 'Main account', type: 'checking' }, { name: 'Joint account', type: 'joint' }])
    await store.commitSystem(planMainAccount(await loadTables(store)))
    await setMainAccount(store, null)
    const t = await loadTables(store)
    expect(t.household[0].askMainAccount).toBe(false)
    expect(t.accounts.find((a) => a.name === 'Joint account')?.type).toBe('joint')
  })
})

describe('a file from before rule B9', () => {
  beforeEach(() => setToday('2026-04-15'))
  afterEach(restoreToday)

  it('its check reads the file as the upgrade will leave it', async () => {
    const { store } = await fresh()
    await account(store, 'Main account', 'checking', { openingBalance: 1000_00 })
    const file = await exportSnapshot(store)
    // the same household, as an older app wrote it: no mark, and the main account stored as a joint one
    const older = {
      ...file, schemaVersion: 19,
      tables: {
        ...file.tables,
        household: file.tables.household.map((h) => ({ ...h, askMainAccount: undefined })),
        accounts: file.tables.accounts.map((a) => (a.type === 'checking' ? { ...a, type: 'joint' as const } : a)),
      },
    }
    const check = await checkFile(store, older)
    expect(check.replace.changes).toBeNull()
    expect(check.merge.changes).toBeNull()
  })
})
