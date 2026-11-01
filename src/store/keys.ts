import type { TableName, TableRecord } from '@/model'

export type PrimaryKey = string | [string, string]

/** Primary key of a record, matching the Dexie schema in db.ts. */
export function primaryKeyOf<T extends TableName>(table: T, record: TableRecord[T]): PrimaryKey {
  switch (table) {
    case 'accountMonths': {
      const r = record as TableRecord['accountMonths']
      return [r.accountId, r.month]
    }
    case 'cells': {
      const r = record as TableRecord['cells']
      return [r.rowId, r.month]
    }
    case 'fxRates': {
      const r = record as TableRecord['fxRates']
      return [r.pair, r.month]
    }
    case 'monthStates':
      return (record as TableRecord['monthStates']).month
    default:
      return (record as { id: string }).id
  }
}
