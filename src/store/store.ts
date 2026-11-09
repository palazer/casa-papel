import {
  MetaSchema, SCHEMA_VERSION, TABLE_SCHEMAS, newId,
  type Meta, type StoreEvent, type TableName, type TableRecord,
} from '@/model'
import type { CasaDb } from './db'
import { primaryKeyOf, type PrimaryKey } from './keys'

/**
 * How long the change log is kept. Undo only reaches back to the last reload and sync sends 180 days of
 * deletions (`DELETE_HORIZON_MS`), so nothing reads older entries; without a limit every export file
 * would carry a before-and-after copy of every change ever made.
 */
export const EVENT_RETENTION_MS = 365 * 86_400_000

/** A single change to one record. */
export type Mutation =
  | { [T in TableName]: { op: 'put'; table: T; record: TableRecord[T] } }[TableName]
  | { op: 'delete'; table: TableName; key: PrimaryKey }

/**
 * All writes go through `commit`, which validates each record, writes it, and
 * appends one event per mutation inside a single transaction. Undo and redo are
 * themselves commits, so the event log stays append-only.
 */
export class Store {
  readonly db: CasaDb
  private undoStack: string[] = []
  private redoStack: string[] = []
  private listeners = new Set<() => void>()
  private version = 0

  constructor(db: CasaDb) {
    this.db = db
  }

  /** Notified after every commit, undo or redo. */
  subscribe(fn: () => void): () => void {
    this.listeners.add(fn)
    return () => {
      this.listeners.delete(fn)
    }
  }

  getVersion(): number {
    return this.version
  }

  private notify(): void {
    this.version += 1
    for (const l of this.listeners) l()
  }

  /** Singleton meta row; created on first access with a fresh deviceId. Parsed so rows from older versions get today's defaults. */
  async meta(): Promise<Meta> {
    const existing = await this.db.meta.get('meta')
    if (existing) return MetaSchema.parse(existing)
    const fresh = MetaSchema.parse({ key: 'meta', schemaVersion: SCHEMA_VERSION, deviceId: newId() })
    await this.db.meta.put(fresh)
    return fresh
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0
  }

  /** Apply mutations as one user action. Returns the transaction id. */
  async commit(mutations: Mutation[]): Promise<string> {
    const txId = await this.write(mutations)
    this.undoStack.push(txId)
    this.redoStack = []
    this.notify()
    return txId
  }

  /** Housekeeping writes (e.g. posting recurring items) that should not enter the undo history. */
  async commitSystem(mutations: Mutation[]): Promise<string> {
    if (mutations.length === 0) return ''
    const txId = await this.write(mutations)
    this.notify()
    return txId
  }

  /** Revert the most recent action. Recorded as a new transaction. */
  async undo(): Promise<boolean> {
    const txId = this.undoStack.pop()
    if (!txId) return false
    const events = await this.eventsOf(txId)
    const inverse: Mutation[] = events.reverse().map((e) =>
      e.inverse != null
        ? ({ op: 'put', table: e.table, record: e.inverse } as Mutation)
        : { op: 'delete', table: e.table, key: e.key as PrimaryKey },
    )
    await this.write(inverse)
    this.redoStack.push(txId)
    this.notify()
    return true
  }

  /** Re-apply the most recently undone action. */
  async redo(): Promise<boolean> {
    const txId = this.redoStack.pop()
    if (!txId) return false
    const events = await this.eventsOf(txId)
    const forward: Mutation[] = events.map((e) =>
      e.type === 'put'
        ? ({ op: 'put', table: e.table, record: e.record } as Mutation)
        : { op: 'delete', table: e.table, key: e.key as PrimaryKey },
    )
    const newTx = await this.write(forward)
    this.undoStack.push(newTx)
    this.notify()
    return true
  }

  /** Drop change-log entries older than the retention period (app start). The data tables are not touched. Returns how many went. */
  async pruneEvents(now: number = Date.now()): Promise<number> {
    return this.db.events.where('ts').below(now - EVENT_RETENTION_MS).delete()
  }

  private async eventsOf(txId: string): Promise<StoreEvent[]> {
    const events = await this.db.events.where('txId').equals(txId).toArray()
    return events.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  }

  private async write(mutations: Mutation[]): Promise<string> {
    const txId = newId()
    await this.db.transaction('rw', this.db.tables, async () => {
      // read inside the transaction: a merge landing in between would otherwise lose its revision bump or ours
      const meta = await this.meta()
      /** Never behind what this device has merged from elsewhere, so a local change always counts as later. */
      const ts = Math.max(Date.now(), meta.clockFloor + 1)
      for (const m of mutations) {
        const table = this.db.table(m.table)
        if (m.op === 'put') {
          const parsed = TABLE_SCHEMAS[m.table].parse(m.record)
          const key = primaryKeyOf(m.table, parsed)
          const inverse = (await table.get(key) as { updatedAt?: number } | undefined) ?? null
          // A write is newer than the version it replaces and than anything merged in, so undo and redo count as new edits.
          const record = { ...parsed, updatedAt: Math.max(parsed.updatedAt, (inverse?.updatedAt ?? -1) + 1, meta.clockFloor + 1) }
          await table.put(record)
          await this.db.events.add({
            id: newId(), ts, deviceId: meta.deviceId, schemaVersion: SCHEMA_VERSION, txId,
            type: 'put', table: m.table, key, record, inverse,
          })
        } else {
          const inverse = (await table.get(m.key)) ?? null
          await table.delete(m.key)
          await this.db.events.add({
            id: newId(), ts, deviceId: meta.deviceId, schemaVersion: SCHEMA_VERSION, txId,
            type: 'delete', table: m.table, key: m.key, record: null, inverse,
          })
        }
      }
      await this.db.meta.update('meta', { eventsSinceExport: meta.eventsSinceExport + mutations.length, localRevision: meta.localRevision + 1 })
    })
    return txId
  }
}
