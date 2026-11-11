import { describe, expect, it } from 'vitest'
import { cellKey, computeEngine, type EngineOutput } from '@/engine'
import { MonthStateSchema, RowSchema, monthRange, newId, type MonthKey, type Row } from '@/model'
import {
  CasaDb, Store, addAccount, addEntity, addRow, addRowOfKind, closeMonth, loadTables, previewRule, quickCreateHousehold, setCellValue, setRowScope, setRule, updateHousehold,
} from '@/store'

const months = monthRange('2026-01', '2026-06')

/** Ana brings 3,000 and Ben 2,500 every month, rent is 1,500, Savings takes the rest; each adult has a pocket line of 200. */
async function fresh() {
  const store = new Store(new CasaDb(`test-${newId()}`))
  await quickCreateHousehold(store, { name: 'T', baseCurrency: 'EUR', locale: 'en-IE', startMonth: '2026-01', closingRule: 'savings-plug' })
  const ana = await addEntity(store, { kind: 'adult', name: 'Ana' })
  const ben = await addEntity(store, { kind: 'adult', name: 'Ben' })
  const t = await loadTables(store)
  const named = (name: string) => t.rows.find((r) => r.name === name)!
  await setCellValue(store, named('Rent').id, '2026-01', 150000, 'from-now-on')
  const anaSalary = await addRow(store, { name: 'Ana – Salary', section: 'income', kind: 'salary' })
  const benSalary = await addRow(store, { name: 'Ben – Salary', section: 'income', kind: 'salary' })
  await setRowScope(store, anaSalary.id, ana.id)
  await setRowScope(store, benSalary.id, ben.id)
  await setCellValue(store, anaSalary.id, '2026-01', 300000, 'from-now-on')
  await setCellValue(store, benSalary.id, '2026-01', 250000, 'from-now-on')
  const anaPocket = await addRowOfKind(store, { section: 'transfer', name: 'Ana – Pocket', categoryId: null, kind: 'pocket-money', adultId: ana.id })
  const benPocket = await addRowOfKind(store, { section: 'transfer', name: 'Ben – Pocket', categoryId: null, kind: 'pocket-money', adultId: ben.id })
  await setCellValue(store, anaPocket.id, '2026-01', 20000, 'from-now-on')
  await setCellValue(store, benPocket.id, '2026-01', 20000, 'from-now-on')
  return { store, ana, ben, anaPocket, benPocket, toSavings: named('To savings'), savings: t.accounts.find((a) => a.type === 'savings')! }
}
const engineOf = async (store: Store): Promise<EngineOutput> => computeEngine({ tables: await loadTables(store), months })
const value = (out: EngineOutput, row: Pick<Row, 'id'>, m: MonthKey) => out.cells[cellKey(row.id, m)].value
const rowOf = async (store: Store, id: string) => (await loadTables(store)).rows.find((r) => r.id === id)!

describe('a rule on pocket money', () => {
  it('a percentage of the adult\'s own income counts from its month on, and one undo takes it back', async () => {
    const { store, anaPocket, benPocket, toSavings } = await fresh()
    const was = await engineOf(store)
    await setRule(store, { rowId: anaPocket.id }, { kind: 'share-of-own-income', share: 0.1 }, '2026-03')
    const now = await engineOf(store)
    expect(value(now, anaPocket, '2026-02')).toBe(20000)
    expect(value(now, anaPocket, '2026-03')).toBe(30000) // 10 % of Ana's 3,000
    expect(value(now, anaPocket, '2026-06')).toBe(30000)
    expect(value(now, benPocket, '2026-03')).toBe(20000)
    expect(value(now, toSavings, '2026-03')).toBe(value(was, toSavings, '2026-03') - 10000)
    expect(await rowOf(store, anaPocket.id)).toMatchObject({ rule: 'share-of-own-income', ruleShare: 0.1, pocketMode: 'fixed', pocketShare: null })
    await store.undo()
    expect(value(await engineOf(store), anaPocket, '2026-03')).toBe(20000)
    expect((await rowOf(store, anaPocket.id)).rule ?? null).toBeNull()
  })

  it('takes a percentage of income, a percentage of what is left or a fixed amount, like an account', async () => {
    const { store, anaPocket, benPocket } = await fresh()
    await setRule(store, { rowId: anaPocket.id }, { kind: 'share-of-income', share: 0.02 }, '2026-02')
    expect(value(await engineOf(store), anaPocket, '2026-02')).toBe(11000) // 2 % of 5,500
    await setRule(store, { rowId: benPocket.id }, { kind: 'share-of-rest', share: 0.1 }, '2026-02')
    // 5,500 in − 1,500 rent − 110 Ana = 3,890 left; a tenth of it
    expect(value(await engineOf(store), benPocket, '2026-02')).toBe(38900)
    await setRule(store, { rowId: benPocket.id }, { kind: 'fixed', amount: 25000 }, '2026-04')
    const out = await engineOf(store)
    expect(value(out, benPocket, '2026-03')).toBe(38900) // the month before keeps what the rule gave it
    expect(value(out, benPocket, '2026-04')).toBe(25000)
    expect(value(out, benPocket, '2026-06')).toBe(25000)
  })

  it('refuses the rest, and a percentage of own income where no adult is behind the row', async () => {
    const { store, anaPocket, toSavings } = await fresh()
    await expect(setRule(store, { rowId: anaPocket.id }, { kind: 'rest' }, '2026-02')).rejects.toThrow('Pocket money cannot take the rest of the month.')
    await expect(setRule(store, { rowId: toSavings.id }, { kind: 'share-of-own-income', share: 0.1 }, '2026-02')).rejects.toThrow('Only pocket money can be a percentage of an adult\'s own income')
    await setRowScope(store, anaPocket.id, 'shared')
    const tables = await loadTables(store)
    expect(() => previewRule(tables, { rowId: anaPocket.id }, { kind: 'share-of-own-income', share: 0.1 }, '2026-02', ['2026-02'])).toThrow('"Ana – Pocket" does not belong to an adult.')
    await expect(setRule(store, { rowId: anaPocket.id }, { kind: 'share-of-own-income', share: 1.5 }, '2026-02')).rejects.toThrow('The percentage must be above 0 and at most 100.')
    // nothing was written by any of the refusals
    expect((await rowOf(store, anaPocket.id)).rule ?? null).toBeNull()
    expect((await rowOf(store, toSavings.id)).rule ?? null).toBeNull()
  })

  it('pocket lines and accounts together take 100% of what is left at most', async () => {
    const { store, anaPocket } = await fresh()
    const rainy = await addAccount(store, { name: 'Rainy day', type: 'savings', currency: 'EUR', openingMonth: '2026-01' })
    await setRule(store, { accountId: rainy.id }, { kind: 'share-of-rest', share: 0.8 }, '2026-02')
    await expect(setRule(store, { rowId: anaPocket.id }, { kind: 'share-of-rest', share: 0.3 }, '2026-02')).rejects.toThrow('the percentages of what is left would add up to 110%')
    await setRule(store, { rowId: anaPocket.id }, { kind: 'share-of-rest', share: 0.2 }, '2026-02')
    expect((await engineOf(store)).warnings).toEqual([])
  })
})

describe('pocket money that was a share of the pocket total', () => {
  /** Two lines of half the household's 1,000 each; February was 800 for that month only; January is closed. */
  async function old() {
    const made = await fresh()
    const { store, anaPocket, benPocket } = made
    await updateHousehold(store, { pocketTotal: 100000 })
    const t = await loadTables(store)
    const share = (r: Row) => ({ op: 'put' as const, table: 'rows' as const, record: RowSchema.parse({ ...r, pocketMode: 'share-of-pocket-total', pocketShare: 0.5 }) })
    await store.commit([
      share(t.rows.find((r) => r.id === anaPocket.id)!), share(t.rows.find((r) => r.id === benPocket.id)!),
      // the typed 200 of before no longer counts: such a row never had cells
      ...t.cells.filter((c) => c.rowId === anaPocket.id || c.rowId === benPocket.id).map((c) => ({ op: 'delete' as const, table: 'cells' as const, key: [c.rowId, c.month] })),
      { op: 'put' as const, table: 'monthStates' as const, record: MonthStateSchema.parse({ month: '2026-02', pocketTotalOverride: 80000, updatedAt: Date.now() }) },
    ])
    await closeMonth(store, '2026-01')
    return made
  }

  it('keeps showing its amounts until it gets a rule', async () => {
    const { store, anaPocket } = await old()
    const out = await engineOf(store)
    expect(months.map((m) => value(out, anaPocket, m))).toEqual([50000, 40000, 50000, 50000, 50000, 50000])
  })

  it('a fixed amount from a month on keeps every earlier month, the closed one too, and makes it an ordinary line', async () => {
    const { store, anaPocket, benPocket, toSavings } = await old()
    const was = await engineOf(store)
    await setRule(store, { rowId: anaPocket.id }, { kind: 'fixed', amount: 30000 }, '2026-04')
    const now = await engineOf(store)
    expect(months.map((m) => value(now, anaPocket, m))).toEqual([50000, 40000, 50000, 30000, 30000, 30000])
    expect(months.map((m) => value(now, benPocket, m))).toEqual(months.map((m) => value(was, benPocket, m)))
    for (const m of ['2026-01', '2026-02', '2026-03'] as MonthKey[]) expect(value(now, toSavings, m), m).toBe(value(was, toSavings, m))
    expect(await rowOf(store, anaPocket.id)).toMatchObject({ rule: 'fixed', pocketMode: 'fixed', pocketShare: null })
    // the household's total no longer reaches it
    await updateHousehold(store, { pocketTotal: 0 })
    const later = await engineOf(store)
    expect(months.map((m) => value(later, anaPocket, m))).toEqual([50000, 40000, 50000, 30000, 30000, 30000])
    expect(value(later, benPocket, '2026-03')).toBe(0)
  })

  it('a percentage from a month on keeps the earlier months as well', async () => {
    const { store, anaPocket } = await old()
    await setRule(store, { rowId: anaPocket.id }, { kind: 'share-of-own-income', share: 0.1 }, '2026-03')
    const now = await engineOf(store)
    expect(months.map((m) => value(now, anaPocket, m))).toEqual([50000, 40000, 30000, 30000, 30000, 30000])
    await store.undo()
    const back = await engineOf(store)
    expect(months.map((m) => value(back, anaPocket, m))).toEqual([50000, 40000, 50000, 50000, 50000, 50000])
  })
})
