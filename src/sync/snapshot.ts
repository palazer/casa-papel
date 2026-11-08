import { ExportFileSchema, SCHEMA_VERSION, type ExportFile, type StoreEvent } from '@/model'
import { readTables } from '@/store'
import type { Store } from '@/store'

/** Delete events older than this are left out of the payload; by then every device has seen them. */
export const DELETE_HORIZON_MS = 180 * 86_400_000

/**
 * What a device uploads: every table plus its recent delete events (without the deleted records),
 * in the export-file shape so the receiving side can validate and migrate it with `parseExportFile`.
 */
export async function buildSyncPayload(store: Store, deviceId: string, now: number = Date.now()): Promise<ExportFile> {
  const tables = await readTables(store.db)
  const since = now - DELETE_HORIZON_MS
  const deletes: StoreEvent[] = (await store.db.events.where('ts').above(since).toArray())
    .filter((e) => e.type === 'delete')
    .map((e) => ({ ...e, inverse: null }))
  return ExportFileSchema.parse({ format: 'casa-papel', schemaVersion: SCHEMA_VERSION, exportedAt: now, deviceId, tables, events: deletes })
}
