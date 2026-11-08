import {
  ExportFileSchema, SCHEMA_VERSION, TABLE_SCHEMAS, migrateExport,
  type ExportFile, type StoreEvent, type Tables,
} from '@/model'
import type { CasaDb } from './db'
import type { PrimaryKey } from './keys'
import type { Store } from './store'

/** Every data table as plain arrays. No side effects; sync and export both start here. */
export async function readTables(db: CasaDb): Promise<Tables> {
  const tables: Record<string, unknown[]> = {}
  for (const t of db.dataTables) tables[t] = await db.table(t).toArray()
  return tables as unknown as Tables
}

/** Snapshot of every data table plus the full event log. Marks the export time in meta. */
export async function exportSnapshot(store: Store): Promise<ExportFile> {
  const db = store.db
  const meta = await store.meta()
  const tables = await readTables(db)
  const events = await db.events.orderBy('id').toArray()
  const file = ExportFileSchema.parse({
    format: 'casa-papel',
    schemaVersion: SCHEMA_VERSION,
    exportedAt: Date.now(),
    deviceId: meta.deviceId,
    tables,
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
    await db.meta.put({ ...meta, schemaVersion: SCHEMA_VERSION, lastExportAt: file.exportedAt, eventsSinceExport: 0, localRevision: meta.localRevision + 1 })
  })
}

export interface MergeResult {
  /** Records written because the other side had a newer or unknown version. */
  applied: number
  /** Records kept because the local version was newer or identical. */
  kept: number
  /** Events added to the local log. */
  newEvents: number
}

/**
 * Merge another copy of the same household into this one. Shared by the Import card and cloud sync.
 * Records: last write wins by `updatedAt`; on an exact tie the side with the larger canonical JSON wins,
 * so two devices converge instead of each keeping its own. Tombstones are ordinary records with
 * `deletedAt`, so they take part in the same rule. Events: unseen ids are appended; delete events
 * apply when the local record is not newer than the deletion. Raises the clock floor to the newest
 * timestamp seen, so later local writes stay later.
 */
export async function mergeTables(store: Store, tables: Tables, events: StoreEvent[]): Promise<MergeResult> {
  const db = store.db
  const result: MergeResult = { applied: 0, kept: 0, newEvents: 0 }
  let newest = 0
  await db.transaction('rw', db.tables, async () => {
    for (const t of db.dataTables) {
      const table = db.table(t)
      const schema = TABLE_SCHEMAS[t]
      for (const raw of (tables[t] ?? []) as unknown[]) {
        const rec = schema.parse(raw) as { updatedAt: number }
        newest = Math.max(newest, rec.updatedAt)
        const key = keyOf(t, rec)
        const local = (await table.get(key)) as { updatedAt: number } | undefined
        const wins = !local || local.updatedAt < rec.updatedAt || (local.updatedAt === rec.updatedAt && canonical(rec) > canonical(local))
        if (wins) {
          await table.put(rec)
          result.applied++
        } else {
          result.kept++
        }
      }
    }
    const incoming = [...events].sort((a, b) => a.ts - b.ts || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    for (const e of incoming) {
      if (await db.events.get(e.id)) continue
      await db.events.add(e)
      newest = Math.max(newest, e.ts)
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
    const meta = await store.meta()
    const changed = result.applied > 0 || result.newEvents > 0
    await db.meta.update('meta', {
      clockFloor: Math.max(meta.clockFloor, newest),
      localRevision: changed ? meta.localRevision + 1 : meta.localRevision,
    })
  })
  return result
}

/** Merge an export file from another device of the same household. */
export function importMerge(store: Store, file: ExportFile): Promise<MergeResult> {
  return mergeTables(store, file.tables, file.events)
}

/** Remove all household data and events. Meta (device id, sync state) is kept; callers sign out first when synced. */
export async function wipeAll(store: Store): Promise<void> {
  const db = store.db
  await db.transaction('rw', db.tables, async () => {
    for (const t of db.dataTables) await db.table(t).clear()
    await db.events.clear()
    const meta = await store.meta()
    await db.meta.put({ ...meta, eventsSinceExport: 0, localRevision: meta.localRevision + 1 })
  })
}

/** A key-sorted JSON string, so two records with the same content compare equal whatever the key order. */
export function canonical(value: unknown): string {
  return JSON.stringify(value, (_k, v: unknown) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : v,
  )
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
