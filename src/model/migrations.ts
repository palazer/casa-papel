import { SCHEMA_VERSION } from './schema'

/**
 * Migrate an export file / stored snapshot from an older schema version to the
 * current one. Each step transforms version n → n+1 on the raw (unknown) shape;
 * zod validation runs after migration.
 */
type Step = (raw: unknown) => unknown

const STEPS: Record<number, Step> = {
  // 1 → 2: add here when SCHEMA_VERSION becomes 2
}

export function migrateExport(raw: unknown): unknown {
  const obj = raw as { schemaVersion?: unknown }
  let version = typeof obj?.schemaVersion === 'number' ? obj.schemaVersion : 1
  if (version > SCHEMA_VERSION) {
    throw new Error(`This file was made by a newer Casa Papel (schema ${version}). Update the app to import it.`)
  }
  let data = raw
  while (version < SCHEMA_VERSION) {
    const step = STEPS[version]
    if (!step) throw new Error(`No migration from schema ${version} to ${version + 1}`)
    data = step(data)
    version += 1
    ;(data as { schemaVersion: number }).schemaVersion = version
  }
  return data
}
