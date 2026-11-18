import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { liveQuery } from 'dexie'
import { newId } from '@/model'
import {
  CasaDb, Store, addAccount, addRow, changeLineText, checkFile, exportSnapshot, importMerge, loadTables, mergeTables, otherText, parseExportFile,
  previewMerge, quickCreateHousehold, setCellValue, updateRow,
} from '@/store'
import { restoreToday, setToday } from '../today'

/**
 * A file picked to bring in shows, before anything is changed, what "Merge into this device" and what "Replace
 * everything here" would each change here (rule T4, finding F9). Today is 15 March 2026; the plan runs to December.
 */
async function fresh() {
  const store = new Store(new CasaDb(`test-${newId()}`))
  await quickCreateHousehold(store, { name: 'Test', baseCurrency: 'EUR', locale: 'en-IE', startMonth: '2026-01' })
  await addAccount(store, { name: 'Current account', type: 'checking', currency: 'EUR', openingMonth: '2026-01', openingBalance: 1000_00 })
  const rent = (await loadTables(store)).rows.find((r) => r.name === 'Rent')!
  await setCellValue(store, rent.id, '2026-01', 1200_00, 'from-now-on')
  return { store, rent }
}
const fileOf = async (store: Store) => parseExportFile(JSON.parse(JSON.stringify(await exportSnapshot(store))))
/** A second device of the same household, with everything the first one has. */
async function secondOf(store: Store) {
  const second = new Store(new CasaDb(`test-${newId()}`))
  const file = await fileOf(store)
  await mergeTables(second, file.tables, file.events, { synced: true })
  return second
}

describe('a file picked to bring in', () => {
  beforeEach(() => setToday('2026-03-15'))
  afterEach(restoreToday)

  it('made before a change here: merging changes nothing, replacing everything turns Rent back', async () => {
    const { store, rent } = await fresh()
    const file = await fileOf(store)
    await setCellValue(store, rent.id, '2026-03', 1300_00, 'from-now-on')
    const check = await checkFile(store, file)
    expect(check.merge).toEqual({ changes: null, other: 0 })
    const lines = check.replace.changes!.lines.map((l) => changeLineText(l, check.locale, { planEnd: check.planEnd }))
    expect(lines[0]).toBe('"Rent" from Mar 2026: €1,300.00 → €1,200.00')
    expect(check.planEnd).toBe('2026-12')
  })

  it('from the other device: merging brings what is newer there', async () => {
    const { store } = await fresh()
    const second = await secondOf(store)
    const gym = await addRow(second, { name: 'Gym', section: 'expense', categoryId: null })
    await setCellValue(second, gym.id, '2026-04', 40_00, 'from-now-on')
    const groceries = (await loadTables(second)).rows.find((r) => r.name === 'Groceries')!
    await updateRow(second, groceries.id, { name: 'Food' })
    const check = await checkFile(store, await fileOf(second))
    expect(changeLineText(check.merge.changes!.lines[0], check.locale, { planEnd: check.planEnd })).toBe('"Gym" from Apr 2026: nothing → €40.00')
    // the new row and the new name
    expect(check.merge.other).toBe(2)
    expect(otherText(check.merge.other)).toBe('and 2 other changes: names, settings, notes or schedules')
  })

  it('looking writes nothing, and the real merge comes to what was shown', async () => {
    const { store, rent } = await fresh()
    const second = await secondOf(store)
    const gym = await addRow(second, { name: 'Gym', section: 'expense', categoryId: null })
    await setCellValue(second, gym.id, '2026-04', 40_00, 'from-now-on')
    await setCellValue(store, rent.id, '2026-03', 1300_00, 'from-now-on')
    const file = await fileOf(second)

    let heard = 0
    const watching = liveQuery(() => store.db.table('cells').toArray()).subscribe(() => { heard += 1 })
    await new Promise((r) => setTimeout(r, 20))
    const heardBefore = heard
    const before = await loadTables(store)
    const meta = await store.meta()
    const shown = await previewMerge(store, file)
    await new Promise((r) => setTimeout(r, 20))
    expect(await loadTables(store)).toEqual(before)
    expect(await store.meta()).toEqual(meta)
    expect(heard).toBe(heardBefore)

    await importMerge(store, file)
    expect(await loadTables(store)).toEqual(shown)
    // the same watcher hears a merge that is written
    await new Promise((r) => setTimeout(r, 20))
    expect(heard).toBeGreaterThan(heardBefore)
    watching.unsubscribe()
  })
})
