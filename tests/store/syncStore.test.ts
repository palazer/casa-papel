import { describe, expect, it } from 'vitest'
import { cellKey, computeEngine } from '@/engine'
import { RowSchema, monthRange, newId, type Row } from '@/model'
import {
  CasaDb, Store, canonical, clearCell, exportSnapshot, importMerge, importReplace, loadTables, mergeTables, quickCreateHousehold, readTables, setCellValue, wipeAll,
} from '@/store'

const t0 = Date.now()
const fresh = () => new Store(new CasaDb(`test-${newId()}`))
const makeRow = (name: string, ts = t0): Row => RowSchema.parse({ id: newId(), createdAt: ts, updatedAt: ts, name, section: 'expense' })
const rev = async (s: Store) => (await s.meta()).localRevision

describe('store: last-write-wins across devices', () => {
  it('an undo is a new edit, so it wins over the other device\'s copy', async () => {
    const a = fresh()
    const b = fresh()
    const r = makeRow('Rent')
    await a.commit([{ op: 'put', table: 'rows', record: r }])
    await a.commit([{ op: 'put', table: 'rows', record: { ...r, name: 'Rent (new)', updatedAt: t0 + 1 } }])
    await importReplace(b, await exportSnapshot(a))
    expect((await b.db.rows.get(r.id))?.name).toBe('Rent (new)')

    await a.undo()
    const undone = await a.db.rows.get(r.id)
    expect(undone?.name).toBe('Rent')
    expect(undone!.updatedAt).toBeGreaterThan(t0 + 1)
    await importMerge(b, await exportSnapshot(a))
    expect((await b.db.rows.get(r.id))?.name).toBe('Rent')
  })

  it('writes after a merge stay above the newest merged timestamp', async () => {
    const a = fresh()
    const future = t0 + 3_600_000
    const r = makeRow('Far ahead', future)
    await mergeTables(a, { ...(await readTables(a.db)), rows: [r] }, [])
    expect((await a.meta()).clockFloor).toBe(future)
    const other = makeRow('Local')
    await a.commit([{ op: 'put', table: 'rows', record: other }])
    expect((await a.db.rows.get(other.id))!.updatedAt).toBeGreaterThan(future)
  })

  it('an exact timestamp tie converges on both devices', async () => {
    const a = fresh()
    const b = fresh()
    const r = makeRow('Shared')
    await a.commit([{ op: 'put', table: 'rows', record: { ...r, name: 'From A', updatedAt: t0 + 5 } }])
    await b.commit([{ op: 'put', table: 'rows', record: { ...r, name: 'From B', updatedAt: t0 + 5 } }])
    await importMerge(a, await exportSnapshot(b))
    await importMerge(b, await exportSnapshot(a))
    const nameA = (await a.db.rows.get(r.id))?.name
    const nameB = (await b.db.rows.get(r.id))?.name
    expect(nameA).toBe(nameB)
    expect(canonical({ b: 1, a: 2 })).toBe('{"a":2,"b":1}')
  })

  it('localRevision counts commits, merges that change something, replaces and wipes', async () => {
    const a = fresh()
    const r0 = await rev(a)
    await a.commit([{ op: 'put', table: 'rows', record: makeRow('A') }])
    expect(await rev(a)).toBe(r0 + 1)
    const file = await exportSnapshot(a)
    await importMerge(a, file) // nothing new
    expect(await rev(a)).toBe(r0 + 1)
    const b = fresh()
    await importMerge(b, file)
    expect(await rev(b)).toBe(1)
    await importReplace(b, file)
    expect(await rev(b)).toBe(2)
    await wipeAll(b)
    expect(await rev(b)).toBe(3)
  })

  it('clearing a cell leaves an inherit record that the engine treats as inherited', async () => {
    const store = fresh()
    await quickCreateHousehold(store, { name: 'T', baseCurrency: 'EUR', locale: 'en-IE', startMonth: '2026-01' })
    const rent = (await loadTables(store)).rows.find((r) => r.name === 'Rent')!
    await setCellValue(store, rent.id, '2026-01', 100000, 'from-now-on')
    await setCellValue(store, rent.id, '2026-03', 120000, 'from-now-on')
    await clearCell(store, rent.id, '2026-03')
    const t = await loadTables(store)
    expect(t.cells.find((c) => c.month === '2026-03')).toMatchObject({ mode: 'inherit', value: null })
    const out = computeEngine({ tables: t, months: monthRange('2026-01', '2026-04') })
    expect(out.cells[cellKey(rent.id, '2026-03')]).toMatchObject({ value: 100000, source: 'inherit' })
  })

  it('a sync payload carries only delete events, and they still apply', async () => {
    const a = fresh()
    const b = fresh()
    const r = makeRow('Gym')
    await a.commit([{ op: 'put', table: 'rows', record: r }])
    await importReplace(b, await exportSnapshot(a))
    await a.commit([{ op: 'delete', table: 'rows', key: r.id }])
    const deletes = (await a.db.events.toArray()).filter((e) => e.type === 'delete').map((e) => ({ ...e, inverse: null }))
    expect(deletes).toHaveLength(1)
    await mergeTables(b, await readTables(a.db), deletes)
    expect(await b.db.rows.get(r.id)).toBeUndefined()
    expect(await b.db.events.get(deletes[0].id)).toBeDefined()
  })
})
