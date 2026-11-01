import {
  EMPTY_TABLES, HouseholdSchema, RowSchema, CellSchema, AccountSchema, PoolSchema, MonthStateSchema, AccountMonthSchema,
  newId, type Tables, type Row, type Cell, type Account, type Pool,
} from '@/model'

export const T0 = Date.UTC(2026, 0, 1)

export function household(over: Partial<Parameters<typeof HouseholdSchema.parse>[0]> = {}) {
  return HouseholdSchema.parse({
    id: newId(), createdAt: T0, updatedAt: T0, name: 'Test', baseCurrency: 'EUR', locale: 'en-IE', startMonth: '2026-01', ...over,
  })
}

export function row(over: Partial<Row> & { name: string; section: Row['section'] }): Row {
  return RowSchema.parse({ id: newId(), createdAt: T0, updatedAt: T0, order: 'a0', ...over })
}

export function cellValue(rowId: string, month: string, value: number): Cell {
  return CellSchema.parse({ rowId, month, mode: 'value', value, items: [], updatedAt: T0 })
}

export function cellItems(rowId: string, month: string, items: Array<Partial<Cell['items'][number]> & { amount: number }>): Cell {
  return CellSchema.parse({
    rowId, month, mode: 'items', updatedAt: T0,
    items: items.map((it) => ({ id: newId(), label: '', status: 'committed', fundedBy: 'cash', kind: 'normal', skipped: false, ...it })),
  })
}

export function account(over: Partial<Account> & { name: string; type: Account['type'] }): Account {
  return AccountSchema.parse({ id: newId(), createdAt: T0, updatedAt: T0, currency: 'EUR', openingMonth: '2026-01', tracked: true, ...over })
}

export function pool(over: Partial<Pool> & { name: string; accountId: string }): Pool {
  return PoolSchema.parse({ id: newId(), createdAt: T0, updatedAt: T0, ...over })
}

export function closedMonth(month: string, over: Record<string, unknown> = {}) {
  return MonthStateSchema.parse({ month, closed: true, closedAt: T0, updatedAt: T0, ...over })
}

export function actual(accountId: string, month: string, actualBalance: number) {
  return AccountMonthSchema.parse({ accountId, month, actualBalance, updatedAt: T0 })
}

export function tables(partial: Partial<Tables>): Tables {
  return { ...EMPTY_TABLES, ...partial }
}
