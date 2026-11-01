import Dexie, { type Table } from 'dexie'
import type {
  Account, AccountMonth, Category, Cell, Entity, FxRate, Household, Meta, MonthState, Pool,
  RecurringItem, Row, StoreEvent, TableName,
} from '@/model'

export const DEFAULT_DB_NAME = 'casa-papel'
export const DEMO_DB_NAME = 'casa-papel-demo'

/**
 * One IndexedDB database per household. Tables mirror the model; `events` is the
 * append-only change log; `meta` is a singleton row.
 */
export class CasaDb extends Dexie {
  household!: Table<Household, string>
  entities!: Table<Entity, string>
  accounts!: Table<Account, string>
  accountMonths!: Table<AccountMonth, [string, string]>
  categories!: Table<Category, string>
  rows!: Table<Row, string>
  cells!: Table<Cell, [string, string]>
  recurringItems!: Table<RecurringItem, string>
  pools!: Table<Pool, string>
  fxRates!: Table<FxRate, [string, string]>
  monthStates!: Table<MonthState, string>
  events!: Table<StoreEvent, string>
  meta!: Table<Meta, string>

  constructor(name: string = DEFAULT_DB_NAME) {
    super(name)
    this.version(1).stores({
      household: 'id',
      entities: 'id, kind',
      accounts: 'id, type',
      accountMonths: '[accountId+month], accountId, month',
      categories: 'id, section',
      rows: 'id, section, kind',
      cells: '[rowId+month], rowId, month',
      recurringItems: 'id, rowId',
      pools: 'id, accountId',
      fxRates: '[pair+month], pair',
      monthStates: 'month',
      events: 'id, ts, txId',
      meta: 'key',
    })
  }

  /** The data tables (everything except events and meta). */
  get dataTables(): TableName[] {
    return [
      'household', 'entities', 'accounts', 'accountMonths', 'categories', 'rows',
      'cells', 'recurringItems', 'pools', 'fxRates', 'monthStates',
    ]
  }
}
