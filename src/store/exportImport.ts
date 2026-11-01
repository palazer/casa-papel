import {
  ExportFileSchema, SCHEMA_VERSION, TABLE_SCHEMAS, migrateExport,
  type ExportFile, type Tables,
} from '@/model'
import type { PrimaryKey } from './keys'
import type { Store } from './store'

/** Snapshot of every data table plus the full event log. Marks the export time in meta. */
export async function exportSnapshot(store: Store): Promise<ExportFile> {
  const db = store.db
  const meta = await store.meta()
  const tables: Record<string, unknown[]> = {}
  for (const t of db.dataTables) tables[t] = await db.table(t).toArray()
  const events = await db.events.orderBy('id').toArray()
  const file = ExportFileSchema.parse({
    format: 'casa-papel',
    schemaVersion: SCHEMA_VERSION,
    exportedAt: Date.now(),
    deviceId: meta.deviceId,
    tables: tables as unknown as Tables,
    events,
  })
  await db.meta.update('meta', { lastExportAt: file.exportedAt, eventsSinceExport: 0 })
  return file
}

export function exportFileName(householdName: string, when: Date = new Date()): string {
  const slug = householdName.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'household'
  return `casa-papel-${slug}-${when.toISOString().slice(0, 10)}.json`
}

/** Parse, migrate and validate a file produced by exportSnapshot. */
export function parseExportFile(raw: unknown): ExportFile {
  if (typeof raw !== 'object' || raw === null || (raw as { format?: unknown }).format !== 'casa-papel') {
    throw new Error('This is not a Casa Papel export file.')
  }
  return ExportFileSchema.parse(migrateExport(raw))
}

/** Replace everything in this database with the file's contents. Keeps this device's id. */
export async function importReplace(store: Store, file: ExportFile): Promise<void> {
  const db = store.db
  await db.transaction('rw', db.tables, async () => {
    for (const t of db.dataTables) {
      const table = db.table(t)
      await table.clear()
      await table.bulkPut(file.tables[t] as unknown[])
    }
    await db.events.clear()
    await db.events.bulkPut(file.events)
    const meta = await store.meta()
    await db.meta.put({ ...meta, schemaVersion: SCHEMA_VERSION, lastExportAt: file.exportedAt, eventsSinceExport: 0 })
  })
}

export interface MergeResult {
  /** Records written because the file had a newer or unknown version. */
  applied: number
  /** Records kept because the local version was newer or identical. */
  kept: number
  /** Events added to the local log. */
  newEvents: number
}

/**
 * Merge another copy of the same household into this one.
 * Records: last write wins by `updatedAt`; ties keep local. Tombstones are
 * ordinary records with `deletedAt`, so they take part in the same rule.
 * Events: unseen ids are appended; delete events apply when the local record
 * is not newer than the deletion.
 */
export async function importMerge(store: Store, file: ExportFile): Promise<MergeResult> {
  const db = store.db
  const result: MergeResult = { applied: 0, kept: 0, newEvents: 0 }
  await db.transaction('rw', db.tables, async () => {
    for (const t of db.dataTables) {
      const table = db.table(t)
      const schema = TABLE_SCHEMAS[t]
      for (const raw of file.tables[t] as unknown[]) {
        const rec = schema.parse(raw) as { updatedAt: number }
        const key = keyOf(t, rec)
        const local = (await table.get(key)) as { updatedAt: number } | undefined
        if (!local || local.updatedAt < rec.updatedAt) {
          await table.put(rec)
          result.applied++
        } else {
          result.kept++
        }
      }
    }
    const incoming = [...file.events].sort((a, b) => a.ts - b.ts || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    for (const e of incoming) {
      if (await db.events.get(e.id)) continue
      await db.events.add(e)
      result.newEvents++
      if (e.type === 'delete') {
        const table = db.table(e.table)
        const local = (await table.get(e.key as PrimaryKey)) as { updatedAt: number } | undefined
        if (local && local.updatedAt <= e.ts) {
          await table.delete(e.key as PrimaryKey)
          result.applied++
        }
      }
    }
  })
  return result
}

/** Remove all household data and events. Meta (device id) is kept. */
export async function wipeAll(store: Store): Promise<void> {
  const db = store.db
  await db.transaction('rw', db.tables, async () => {
    for (const t of db.dataTables) await db.table(t).clear()
    await db.events.clear()
    const meta = await store.meta()
    await db.meta.put({ ...meta, eventsSinceExport: 0 })
  })
}

function keyOf(table: string, rec: Record<string, unknown>): PrimaryKey {
  switch (table) {
    case 'accountMonths': return [rec.accountId as string, rec.month as string]
    case 'cells': return [rec.rowId as string, rec.month as string]
    case 'fxRates': return [rec.pair as string, rec.month as string]
    case 'monthStates': return rec.month as string
    default: return rec.id as string
  }
}
