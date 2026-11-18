import { describe, expect, it } from 'vitest'
import { cellKey, computeEngine } from '@/engine'
import { monthRange, newId } from '@/model'
import { CasaDb, Store, addRow, archiveRow, followRow, loadTables, quickCreateHousehold, restoreRow, setCellValue } from '@/store'

/**
 * A row that follows another stops following when that row is archived, and keeps what it showed (finding F10): every
 * month before the archive shows what it showed while it followed, also a month in which it showed nothing.
 */
const months = monthRange('2026-01', '2026-08')

/** Rent is 1,200.00 in January and February, nothing from March, 1,600.00 in May alone; "Flatmate" follows it at a quarter. */
async function fresh() {
  const store = new Store(new CasaDb(`test-${newId()}`))
  await quickCreateHousehold(store, { name: 'Test', baseCurrency: 'EUR', locale: 'en-IE', startMonth: '2026-01' })
  const rent = (await loadTables(store)).rows.find((r) => r.name === 'Rent')!
  await setCellValue(store, rent.id, '2026-01', 1200_00, 'from-now-on')
  await setCellValue(store, rent.id, '2026-03', 0, 'from-now-on')
  await setCellValue(store, rent.id, '2026-05', 1600_00, 'this-month')
  const share = await addRow(store, { name: 'Flatmate', section: 'income' })
  return { store, rent, share }
}
const values = async (store: Store, rowId: string): Promise<number[]> => {
  const out = computeEngine({ tables: await loadTables(store), months })
  return months.map((m) => out.cells[cellKey(rowId, m)].value / 100)
}
const storedOf = async (store: Store, rowId: string): Promise<string[]> =>
  (await loadTables(store)).cells.filter((c) => c.rowId === rowId).sort((a, b) => (a.month < b.month ? -1 : 1))
    .map((c) => `${c.month.slice(5)} ${c.mode === 'value' ? (c.value ?? 0) / 100 : c.mode}${c.once ? '!' : ''}`)

describe('a row that followed another, once that row is archived', () => {
  it('shows what it showed: nothing where it showed nothing, and the last amount from the archive on', async () => {
    const { store, rent, share } = await fresh()
    await followRow(store, share.id, rent.id, 0.25)
    const followed = [300, 300, 0, 0, 400, 0, 0, 0]
    expect(await values(store, share.id)).toEqual(followed)

    await archiveRow(store, rent.id, '2026-07')
    // January and February as amounts, the 0.00 of March written down, May as that month's alone; April and June carry the 0.00
    expect(await storedOf(store, share.id)).toEqual(['01 300', '02 300', '03 0', '05 400!'])
    expect(await values(store, share.id)).toEqual(followed)
    // one step, and Undo makes it follow again
    await store.undo()
    expect(await storedOf(store, share.id)).toEqual([])
    expect(await values(store, share.id)).toEqual(followed)
  })

  it('writes nothing into the months before its first amount', async () => {
    const { store, rent, share } = await fresh()
    await setCellValue(store, rent.id, '2026-01', 0, 'this-month')
    await followRow(store, share.id, rent.id, 0.25)
    expect(await values(store, share.id)).toEqual([0, 300, 0, 0, 400, 0, 0, 0])
    await archiveRow(store, rent.id, '2026-07')
    expect(await storedOf(store, share.id)).toEqual(['02 300', '03 0', '05 400!'])
    const out = computeEngine({ tables: await loadTables(store), months })
    expect(out.cells[cellKey(share.id, '2026-01')].source).toBe('empty')
  })

  it('an amount of its own from before it followed does not come back in a month it showed nothing', async () => {
    const { store, rent, share } = await fresh()
    // typed before the row followed anything; while it follows, these are not read
    await setCellValue(store, share.id, '2026-04', 55_00, 'this-month')
    await setCellValue(store, share.id, '2026-08', 77_00, 'this-month')
    await followRow(store, share.id, rent.id, 0.25)
    expect(await values(store, share.id)).toEqual([300, 300, 0, 0, 400, 0, 0, 0])
    await archiveRow(store, rent.id, '2026-07')
    expect(await storedOf(store, share.id)).toEqual(['01 300', '02 300', '03 0', '04 0', '05 400!', '08 77!'])
    // before the archive nothing moved; from the archive on the row is its own again, with what it holds there
    expect(await values(store, share.id)).toEqual([300, 300, 0, 0, 400, 0, 0, 77])
  })

  it('restoring the row makes it follow again, with what the row shows then', async () => {
    const { store, rent, share } = await fresh()
    await followRow(store, share.id, rent.id, 0.25)
    await archiveRow(store, rent.id, '2026-07')
    await restoreRow(store, rent.id)
    expect((await loadTables(store)).rows.find((r) => r.id === share.id)?.followsRowId).toBe(rent.id)
    expect(await values(store, share.id)).toEqual([300, 300, 0, 0, 400, 0, 0, 0])
  })
})
