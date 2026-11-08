import { describe, expect, it } from 'vitest'
import { RowSchema, newId, type Row } from '@/model'
import {
  CasaDb, Store, exportFileName, exportSnapshot, importMerge, importReplace, parseExportFile, wipeAll,
} from '@/store'

const t0 = Date.now()
const fresh = () => new Store(new CasaDb(`test-${newId()}`))
const makeRow = (name: string, ts = t0): Row =>
  RowSchema.parse({ id: newId(), createdAt: ts, updatedAt: ts, name, section: 'expense' })

async function snapshot(db: CasaDb) {
  const out: Record<string, unknown[]> = {}
  for (const t of db.dataTables) out[t] = await db.table(t).toArray()
  return out
}

describe('export / import', () => {
  it('export → wipe → import replace restores tables and events', async () => {
    const a = fresh()
    const r1 = makeRow('Rent')
    const r2 = makeRow('Groceries')
    await a.commit([{ op: 'put', table: 'rows', record: r1 }, { op: 'put', table: 'rows', record: r2 }])
    await a.commit([{ op: 'put', table: 'cells', record: { rowId: r1.id, month: '2026-11', mode: 'value', value: 193500, items: [], updatedAt: t0 } }])
    const before = await snapshot(a.db)
    const file = await exportSnapshot(a)
    expect(file.format).toBe('casa-papel')
    expect(file.events).toHaveLength(3)
    expect((await a.meta()).eventsSinceExport).toBe(0)

    await wipeAll(a)
    expect(await a.db.rows.count()).toBe(0)
    expect(await a.db.events.count()).toBe(0)

    const parsed = parseExportFile(JSON.parse(JSON.stringify(file)))
    await importReplace(a, parsed)
    expect(await snapshot(a.db)).toEqual(before)
    expect(await a.db.events.count()).toBe(3)
  })

  it('merge brings in each side\'s edits, newest wins on conflict, and is idempotent', async () => {
    const a = fresh()
    const b = fresh()
    const r1 = makeRow('Rent')
    const r2 = makeRow('Groceries')
    await a.commit([{ op: 'put', table: 'rows', record: r1 }, { op: 'put', table: 'rows', record: r2 }])
    await importReplace(b, await exportSnapshot(a))

    // A renames r1 (later), B renames r2 and also r1 (earlier than A). The stamps sit a minute ahead of the clock:
    // the import raised B's clock floor to A's newest event time, and a write is never stamped below that floor.
    const later = t0 + 60_000
    await a.commit([{ op: 'put', table: 'rows', record: { ...r1, name: 'Rent A', updatedAt: later + 50 } }])
    await b.commit([{ op: 'put', table: 'rows', record: { ...r2, name: 'Groceries B', updatedAt: later + 10 } }])
    await b.commit([{ op: 'put', table: 'rows', record: { ...r1, name: 'Rent B', updatedAt: later + 20 } }])

    const fromA = await exportSnapshot(a)
    const res = await importMerge(b, fromA)
    expect((await b.db.rows.get(r1.id))?.name).toBe('Rent A')
    expect((await b.db.rows.get(r2.id))?.name).toBe('Groceries B')
    expect(res.newEvents).toBe(1)
    expect(res.applied).toBe(1)

    const again = await importMerge(b, fromA)
    expect(again.applied).toBe(0)
    expect(again.newEvents).toBe(0)

    // and back: A takes B's groceries rename, keeps its own newer rent
    await importMerge(a, await exportSnapshot(b))
    expect((await a.db.rows.get(r1.id))?.name).toBe('Rent A')
    expect((await a.db.rows.get(r2.id))?.name).toBe('Groceries B')
    const idsA = new Set((await a.db.events.toArray()).map((e) => e.id))
    const idsB = new Set((await b.db.events.toArray()).map((e) => e.id))
    expect(idsA).toEqual(idsB)
  })

  it('merge applies a delete unless the local record is newer', async () => {
    const a = fresh()
    const b = fresh()
    const r = makeRow('Gym')
    await a.commit([{ op: 'put', table: 'rows', record: r }])
    await importReplace(b, await exportSnapshot(a))

    await a.commit([{ op: 'delete', table: 'rows', key: r.id }])
    await importMerge(b, await exportSnapshot(a))
    expect(await b.db.rows.get(r.id)).toBeUndefined()

    // local edit newer than a (older) delete survives
    const c = fresh()
    await importReplace(c, await exportSnapshot(b))
    await c.commit([{ op: 'put', table: 'rows', record: { ...r, name: 'Gym kept', updatedAt: Date.now() + 100_000 } }])
    await importMerge(c, await exportSnapshot(a))
    expect((await c.db.rows.get(r.id))?.name).toBe('Gym kept')
  })

  it('rejects foreign files and newer schemas', () => {
    expect(() => parseExportFile({ hello: 1 })).toThrow(/not a Casa Papel/)
    expect(() => parseExportFile({ format: 'casa-papel', schemaVersion: 99 })).toThrow(/newer/)
  })

  it('names files from the household', () => {
    expect(exportFileName('Palaz Hane', new Date('2026-11-01T10:00:00Z'))).toBe('casa-papel-palaz-hane-2026-11-01.json')
    expect(exportFileName('   ', new Date('2026-11-01T10:00:00Z'))).toBe('casa-papel-household-2026-11-01.json')
  })
})
