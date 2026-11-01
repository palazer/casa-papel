import {
  AccountSchema, CellSchema, EntitySchema, FxRateSchema, HouseholdSchema, PoolSchema, RowSchema,
  EMPTY_TABLES, newId, type Cell, type Row, type Tables,
} from '@/model'
import { byRow, isCarryFormula, minor, num, type RawFixture } from './rawFixture'

const T0 = Date.UTC(2026, 9, 1)
const base = () => ({ id: newId(), createdAt: T0, updatedAt: T0, deletedAt: null })

/**
 * Map the v2 template workbook onto the app model. Row numbers are the
 * spreadsheet's; see plan §1 for what each one is.
 */
export function v2ToTables(fx: RawFixture) {
  const flow = fx.sheets.Flow
  const rows = byRow(flow)
  const months = flow.months
  const label = (r: number) => String(rows.get(r)?.label ?? `row ${r}`)

  const household = HouseholdSchema.parse({
    ...base(), name: 'Template', baseCurrency: 'TRY', locale: 'tr-TR', startMonth: months[0],
    closingRule: 'savings-plug', cashBuffer: 0, pocketTotal: 0,
  })
  const adultA = EntitySchema.parse({ ...base(), kind: 'adult', name: 'Adult A' })
  const adultB = EntitySchema.parse({ ...base(), kind: 'adult', name: 'Adult B' })
  const savings = AccountSchema.parse({
    ...base(), name: 'Savings', type: 'savings', currency: 'TRY', openingMonth: months[0], tracked: true,
    openingBalance: minor(num(rows.get(3)?.b)),
  })

  type Spec = { r: number; section: Row['section']; kind?: Row['kind']; currency?: string; scope?: string }
  const specs: Spec[] = [
    { r: 14, section: 'income', kind: 'salary', currency: 'USD', scope: adultA.id },
    { r: 16, section: 'income', scope: adultA.id },
    { r: 17, section: 'income', kind: 'salary', scope: adultB.id },
    { r: 18, section: 'income', scope: adultB.id },
    { r: 19, section: 'income' },
    { r: 20, section: 'income', kind: 'from-investment' },
    { r: 25, section: 'transfer', kind: 'to-investment' },
    { r: 26, section: 'transfer', kind: 'pocket-money' },
    ...[27, 28, 29, 30, 31, 32, 33, 34, 35, 37, 38, 39, 40, 42, 46, 47, 48, 49].map((r): Spec => ({ r, section: 'expense' })),
    { r: 36, section: 'expense', kind: 'debt-payment' },
    { r: 41, section: 'expense', kind: 'debt-payment' },
    { r: 43, section: 'transfer', kind: 'pool-allocation' },
    { r: 44, section: 'transfer', kind: 'pool-allocation' },
    { r: 45, section: 'transfer', kind: 'pool-allocation' },
  ]

  const appRows: Row[] = []
  const cells: Cell[] = []
  const rowIdBySheetRow = new Map<number, string>()
  specs.forEach((s, i) => {
    const raw = rows.get(s.r)
    if (!raw) throw new Error(`fixture has no row ${s.r}`)
    const row = RowSchema.parse({
      ...base(), name: label(s.r), section: s.section, kind: s.kind ?? 'plain', currency: s.currency ?? null,
      scope: s.scope ?? 'shared', inShareBasis: s.kind === 'salary', order: String(i).padStart(3, '0'),
      pocketMode: s.kind === 'pocket-money' ? 'fixed' : null,
      accountId: s.kind === 'pool-allocation' || s.kind === 'to-investment' ? savings.id : null,
    })
    appRows.push(row)
    rowIdBySheetRow.set(s.r, row.id)
    months.forEach((m, mi) => {
      const c = raw.cells[mi]
      if (isCarryFormula(c)) return // inherit
      cells.push(CellSchema.parse({ rowId: row.id, month: m, mode: 'value', value: minor(num(c)), items: [], updatedAt: T0 }))
    })
  })
  const toSavings = RowSchema.parse({ ...base(), name: label(24), section: 'transfer', kind: 'to-savings', accountId: savings.id, order: '900' })
  appRows.push(toSavings)

  const pools = [43, 44, 45].map((r) =>
    PoolSchema.parse({ ...base(), name: label(r).replace(/\s*⇩\s*$/, ''), accountId: savings.id, allocationRowId: rowIdBySheetRow.get(r), openingBalance: 0 }),
  )

  const fxRow = rows.get(55)
  const fxRates = months.map((m, i) => FxRateSchema.parse({ pair: 'USD/TRY', month: m, rate: num(fxRow?.cells[i]), source: 'manual', updatedAt: T0 }))

  const tables: Tables = {
    ...EMPTY_TABLES,
    household: [household], entities: [adultA, adultB], accounts: [savings], rows: appRows, cells, pools, fxRates,
  }
  return { tables, months, rowIdBySheetRow, savingsId: savings.id, poolIds: pools.map((p) => p.id), toSavingsId: toSavings.id }
}
