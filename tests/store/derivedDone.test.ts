import { describe, expect, it } from 'vitest'
import { cellKey, computeEngine } from '@/engine'
import { monthRange, newId } from '@/model'
import { CasaDb, Store, closeMonth, loadTables, quickCreateHousehold, reopenMonth, setCellDone, setCellValue, setDerivedDone } from '@/store'

const months = monthRange('2026-01', '2026-03')

async function fresh() {
  const store = new Store(new CasaDb(`test-${newId()}`))
  await quickCreateHousehold(store, { name: 'Test', baseCurrency: 'EUR', locale: 'en-IE', startMonth: '2026-01' })
  const t = await loadTables(store)
  const salary = t.rows.find((r) => r.name === 'Salary')!
  const toSavings = t.rows.find((r) => r.name === 'To savings')!
  await setCellValue(store, salary.id, '2026-01', 300000, 'from-now-on')
  return { store, salary, toSavings }
}
const engineOf = async (store: Store) => computeEngine({ tables: await loadTables(store), months })
const plug = async (store: Store, rowId: string, m: string) => (await engineOf(store)).cells[cellKey(rowId, m)]

describe('automatic rows ticked as moved', () => {
  it('setDerivedDone flags one month, setCellDone delegates, undo takes it back', async () => {
    const { store, toSavings } = await fresh()
    expect(await plug(store, toSavings.id, '2026-02')).toMatchObject({ source: 'derived', status: 'derived', value: 300000 })
    await setDerivedDone(store, toSavings.id, '2026-02', true)
    expect(await plug(store, toSavings.id, '2026-02')).toMatchObject({ source: 'derived', status: 'done', value: 300000 })
    expect((await plug(store, toSavings.id, '2026-03')).status).toBe('derived')
    expect((await plug(store, toSavings.id, '2026-01')).status).toBe('derived')
    await store.undo()
    expect((await plug(store, toSavings.id, '2026-02')).status).toBe('derived')
    await setCellDone(store, toSavings.id, '2026-02', true)
    expect((await plug(store, toSavings.id, '2026-02')).status).toBe('done')
    await setCellDone(store, toSavings.id, '2026-02', false)
    expect((await plug(store, toSavings.id, '2026-02')).status).toBe('derived')
    // the second identical tick is a no-op
    const version = store.getVersion()
    await setDerivedDone(store, toSavings.id, '2026-02', false)
    expect(store.getVersion()).toBe(version)
  })

  it('never changes the amount or the totals', async () => {
    const { store, toSavings } = await fresh()
    const before = await engineOf(store)
    await setDerivedDone(store, toSavings.id, '2026-02', true)
    const after = await engineOf(store)
    expect(after.totals['2026-02'].toSavings).toBe(before.totals['2026-02'].toSavings)
    expect(after.cells[cellKey(toSavings.id, '2026-02')].value).toBe(before.cells[cellKey(toSavings.id, '2026-02')].value)
    expect(after.accounts).toEqual(before.accounts)
  })

  it('survives closing and reopening the month, and is refused while the month is closed', async () => {
    const { store, toSavings } = await fresh()
    await setDerivedDone(store, toSavings.id, '2026-02', true)
    await closeMonth(store, '2026-02')
    expect((await plug(store, toSavings.id, '2026-02')).status).toBe('done')
    await expect(setDerivedDone(store, toSavings.id, '2026-02', false)).rejects.toThrow(/closed/)
    await reopenMonth(store, '2026-02')
    expect((await plug(store, toSavings.id, '2026-02')).status).toBe('done')
    await setDerivedDone(store, toSavings.id, '2026-02', false)
    expect((await plug(store, toSavings.id, '2026-02')).status).toBe('derived')
  })
})
