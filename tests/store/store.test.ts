import { describe, expect, it } from 'vitest'
import { CellSchema, RowSchema, SCHEMA_VERSION, newId, type Row } from '@/model'
import { CasaDb, Store } from '@/store'

function fresh() {
  return new Store(new CasaDb(`test-${newId()}`))
}

const now = Date.now()
const makeRow = (name: string): Row =>
  RowSchema.parse({ id: newId(), createdAt: now, updatedAt: now, name, section: 'expense' })

describe('store', () => {
  it('creates meta with a device id once', async () => {
    const s = fresh()
    const a = await s.meta()
    const b = await s.meta()
    expect(a.deviceId).toBe(b.deviceId)
    expect(a.schemaVersion).toBe(SCHEMA_VERSION)
  })

  it('commits puts and records events with inverses', async () => {
    const s = fresh()
    const row = makeRow('Rent')
    await s.commit([{ op: 'put', table: 'rows', record: row }])
    expect(await s.db.rows.get(row.id)).toMatchObject({ name: 'Rent' })

    await s.commit([{ op: 'put', table: 'rows', record: { ...row, name: 'Rent (new)', updatedAt: now + 1 } }])
    const events = await s.db.events.orderBy('id').toArray()
    expect(events).toHaveLength(2)
    expect(events[0].inverse).toBeNull()
    expect((events[1].inverse as Row).name).toBe('Rent')
    expect((await s.meta()).eventsSinceExport).toBe(2)
  })

  it('undo and redo walk the history and keep the log append-only', async () => {
    const s = fresh()
    const row = makeRow('Rent')
    await s.commit([{ op: 'put', table: 'rows', record: row }])
    await s.commit([{ op: 'put', table: 'rows', record: { ...row, name: 'Rent (new)', updatedAt: now + 1 } }])

    expect(await s.undo()).toBe(true)
    expect((await s.db.rows.get(row.id))?.name).toBe('Rent')
    expect(await s.undo()).toBe(true)
    expect(await s.db.rows.get(row.id)).toBeUndefined()
    expect(await s.undo()).toBe(false)

    expect(await s.redo()).toBe(true)
    expect((await s.db.rows.get(row.id))?.name).toBe('Rent')
    expect(await s.redo()).toBe(true)
    expect((await s.db.rows.get(row.id))?.name).toBe('Rent (new)')
    expect(await s.redo()).toBe(false)

    expect(await s.db.events.count()).toBe(6)
  })

  it('a new commit clears the redo stack', async () => {
    const s = fresh()
    await s.commit([{ op: 'put', table: 'rows', record: makeRow('A') }])
    await s.undo()
    expect(s.canRedo).toBe(true)
    await s.commit([{ op: 'put', table: 'rows', record: makeRow('B') }])
    expect(s.canRedo).toBe(false)
  })

  it('rejects invalid records and writes nothing', async () => {
    const s = fresh()
    await expect(
      s.commit([{ op: 'put', table: 'cells', record: { rowId: 'bad' } as never }]),
    ).rejects.toThrow()
    expect(await s.db.events.count()).toBe(0)
    expect(await s.db.cells.count()).toBe(0)
  })

  it('handles composite keys and deletes', async () => {
    const s = fresh()
    const row = makeRow('Groceries')
    const cell = CellSchema.parse({ rowId: row.id, month: '2026-11', mode: 'value', value: 120000, updatedAt: now })
    await s.commit([
      { op: 'put', table: 'rows', record: row },
      { op: 'put', table: 'cells', record: cell },
    ])
    expect(await s.db.cells.get([row.id, '2026-11'])).toMatchObject({ value: 120000 })
    await s.commit([{ op: 'delete', table: 'cells', key: [row.id, '2026-11'] }])
    expect(await s.db.cells.get([row.id, '2026-11'])).toBeUndefined()
    await s.undo()
    expect(await s.db.cells.get([row.id, '2026-11'])).toMatchObject({ value: 120000 })
  })
})
