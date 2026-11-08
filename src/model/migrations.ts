import { SCHEMA_VERSION } from './schema'

/**
 * Migrate an export file / stored snapshot from an older schema version to the
 * current one. Each step transforms version n → n+1 on the raw (unknown) shape;
 * zod validation runs after migration.
 */
type Step = (raw: unknown) => unknown

const STEPS: Record<number, Step> = {
  // 1 → 2: goals table
  1: (raw) => {
    const obj = raw as { tables?: Record<string, unknown> }
    return { ...obj, tables: { ...(obj.tables ?? {}), goals: obj.tables?.goals ?? [] } }
  },
  // 2 → 3: `Cell.markedDone` (an automatic row ticked as moved) and `Pool.archivedMonth`; both fill in from their defaults
  2: (raw) => raw,
  // 3 → 4: `Household.planUntil` ("Add <year>"), `FxRate.date`, `Row.followShare`, `Row.deductedFromRowId`, and the
  // 'first' month-rate default for new households (a stored 'last' is a choice and stays); everything fills in from its default
  3: (raw) => raw,
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
