import {
  AccountMonthSchema, AccountSchema, CellSchema, EntitySchema, FxRateSchema, HouseholdSchema, PoolSchema, RowSchema,
  EMPTY_TABLES, newId, type Cell, type Row, type Tables,
} from '@/model'
import { byRow, isCarryFormula, minor, num, type RawFixture } from './rawFixture'

const T0 = Date.UTC(2026, 9, 1)
const base = () => ({ id: newId(), createdAt: T0, updatedAt: T0, deletedAt: null })

/**
 * Map the v2 template workbook onto the app model. Row numbers are the
 * spreadsheet's; see plan §1 for what each one is.
 * - savings (row 3) and investments (row 4: grow at A4 per year, then add the deposit) are tracked accounts
 * - the USD/TRY chain (row 55) is one known rate plus the sheet's fixed monthly drift (A55)
 */
export function v2ToTables(fx: RawFixture) {
  const flow = fx.sheets.Flow
  const rows = byRow(flow)
  const months = flow.months
  const label = (r: number) => String(rows.get(r)?.label ?? `row ${r}`)

  const fxRow = rows.get(55)
  const household = HouseholdSchema.parse({
    ...base(), name: 'Template', baseCurrency: 'TRY', locale: 'tr-TR', startMonth: months[0],
    closingRule: 'savings-plug', cashBuffer: 0, pocketTotal: 0,
    fxDriftMode: 'fixed', fxDriftDefault: num(fxRow?.a),
  })
  const adultA = EntitySchema.parse({ ...base(), kind: 'adult', name: 'Adult A' })
  const adultB = EntitySchema.parse({ ...base(), kind: 'adult', name: 'Adult B' })
  const savings = AccountSchema.parse({
    ...base(), name: 'Savings', type: 'savings', currency: 'TRY', openingMonth: months[0], tracked: true,
    openingBalance: minor(num(rows.get(3)?.b)),
  })
  const investments = AccountSchema.parse({
    ...base(), name: 'Investments', type: 'investment', currency: 'TRY', openingMonth: months[0], tracked: true,
    openingBalance: minor(num(rows.get(4)?.b)),
    investment: { projectionMode: 'fixed-rate', annualRate: num(rows.get(4)?.a), depositTiming: 'end', depositFxMode: 'monthly-rate', fixedRate: null },
  })

  const loans = AccountSchema.parse({ ...base(), name: 'Loans', type: 'loan', currency: 'TRY', openingMonth: months[0], tracked: true, openingBalance: minor(num(rows.get(9)?.b)) })
  const companyDebt = AccountSchema.parse({ ...base(), name: 'Company debt', type: 'loan', currency: 'TRY', openingMonth: months[0], tracked: true, openingBalance: minor(num(rows.get(10)?.b)) })
  const card = AccountSchema.parse({ ...base(), name: 'Card', type: 'credit-card', currency: 'TRY', openingMonth: months[0], tracked: true, openingBalance: minor(num(rows.get(7)?.b)), card: { cardMode: 'itemized' } })

  type Spec = { r: number; section: Row['section']; kind?: Row['kind']; currency?: string; scope?: string; accountId?: string }
  const specs: Spec[] = [
    { r: 14, section: 'income', kind: 'salary', currency: 'USD', scope: adultA.id },
    { r: 16, section: 'income', scope: adultA.id },
    { r: 17, section: 'income', kind: 'salary', scope: adultB.id },
    { r: 18, section: 'income', scope: adultB.id },
    { r: 19, section: 'income' },
    { r: 20, section: 'income', kind: 'from-investment' },
    { r: 25, section: 'transfer', kind: 'to-investment' },
    { r: 26, section: 'transfer', kind: 'pocket-money' },
    ...[27, 28, 29, 30, 31, 32, 33, 34, 35, 37, 38, 39, 40, 46, 47, 48, 49].map((r): Spec => ({ r, section: 'expense' })),
    { r: 36, section: 'expense', kind: 'debt-payment', accountId: loans.id },
    { r: 41, section: 'expense', kind: 'debt-payment', accountId: loans.id },
    { r: 42, section: 'expense', kind: 'debt-payment', accountId: companyDebt.id },
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
    const accountId = s.accountId ?? (s.kind === 'pool-allocation' ? savings.id : s.kind === 'to-investment' || s.kind === 'from-investment' ? investments.id : null)
    const row = RowSchema.parse({
      ...base(), name: label(s.r), section: s.section, kind: s.kind ?? 'plain', currency: s.currency ?? null,
      scope: s.scope ?? 'shared', inShareBasis: s.kind === 'salary', order: String(i).padStart(3, '0'),
      pocketMode: s.kind === 'pocket-money' ? 'fixed' : null,
      accountId,
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
  // card payment (row 6) sits in the balances block, outside the sheet's expense range; row 7 is the real remaining debt
  const cardPayment = RowSchema.parse({ ...base(), name: label(6), section: 'transfer', kind: 'card-payment', accountId: card.id, order: '901' })
  appRows.push(cardPayment)
  months.forEach((m, mi) => {
    const v = num(rows.get(6)?.cells[mi])
    cells.push(CellSchema.parse({ rowId: cardPayment.id, month: m, mode: 'value', value: minor(v), items: [], updatedAt: T0 }))
  })
  const accountMonths = months.flatMap((m, mi) => {
    const c = rows.get(7)?.cells[mi]
    return c && typeof c.v === 'number' ? [AccountMonthSchema.parse({ accountId: card.id, month: m, actualBalance: minor(c.v), updatedAt: T0 })] : []
  })

  const pools = [43, 44, 45].map((r) =>
    PoolSchema.parse({ ...base(), name: label(r).replace(/\s*⇩\s*$/, ''), accountId: savings.id, allocationRowId: rowIdBySheetRow.get(r), openingBalance: 0 }),
  )

  // only the first month is a known rate; the rest is projected with the drift
  const fxRates = [FxRateSchema.parse({ pair: 'USD/TRY', month: months[0], rate: num(fxRow?.cells[0]), source: 'manual', updatedAt: T0 })]

  const tables: Tables = {
    ...EMPTY_TABLES,
    household: [household], entities: [adultA, adultB], accounts: [savings, investments, loans, companyDebt, card], rows: appRows, cells, pools, fxRates, accountMonths,
  }
  return { tables, months, rowIdBySheetRow, savingsId: savings.id, investmentsId: investments.id, loansId: loans.id, companyDebtId: companyDebt.id, cardId: card.id, poolIds: pools.map((p) => p.id), toSavingsId: toSavings.id }
}
