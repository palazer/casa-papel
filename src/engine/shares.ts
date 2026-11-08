/**
 * Who pays what. Proportional mode: every shared outflow is split between the adults in
 * proportion to a basis (salary rows by default); rows scoped to a person are theirs alone;
 * rows scoped to a child, pet or thing go to whoever "pays for" it. Pooled mode: a per-person
 * view of income, own spending and pocket money.
 */
import type { Entity, Money, MonthKey, Row, Tables } from '@/model'
import { cellKey, type CellResult, type EngineOutput } from './types'

export interface ShareLine {
  rowId: string
  name: string
  section: Row['section']
  kind: Row['kind']
  /** Base-currency amount that needs paying this month (cash-funded part for expenses). */
  total: Money
  byAdult: Record<string, Money>
  /** Account the money goes to or leaves from, when the row names one. */
  destinationAccountId: string | null
  /** How the line was routed. */
  routing: 'shared' | 'own' | 'paid-by'
}

export interface AdultContribution {
  entityId: string
  name: string
  basis: Money
  share: number
  income: Money
  owed: Money
  /** accountId → owed; '' for lines without an account. */
  owedByDestination: Record<string, Money>
  /** income − owed: what stays with this person. */
  remainder: Money
}

export interface MonthContributions {
  month: MonthKey
  basisTotal: Money
  adults: AdultContribution[]
  lines: ShareLine[]
}

export interface PersonBudget {
  entityId: string
  name: string
  income: Money
  /** Expense rows that are this person's (or paid by them for a dependent). */
  ownSpend: Money
  pocket: Money
  /** income − own spend − pocket: what this person puts into the household. */
  contribution: Money
}

const sortEntities = (list: Entity[]) => [...list].sort((a, b) => (a.order < b.order ? -1 : a.order > b.order ? 1 : 0))

function liveAdults(tables: Tables, month: MonthKey): Entity[] {
  return sortEntities(tables.entities.filter((e) => e.kind === 'adult' && !e.deletedAt && !(e.archivedMonth && e.archivedMonth <= month)))
}

/** The adult a row's scope points at: the adult itself, or whoever pays for the scoped entity. null = shared. */
function ownerOf(row: Row, tables: Tables, adultIds: Set<string>): { adultId: string | null; routing: ShareLine['routing'] } {
  if (row.scope === 'shared') return { adultId: null, routing: 'shared' }
  if (adultIds.has(row.scope)) return { adultId: row.scope, routing: 'own' }
  const ent = tables.entities.find((e) => e.id === row.scope)
  if (ent?.paidBy && adultIds.has(ent.paidBy)) return { adultId: ent.paidBy, routing: 'paid-by' }
  return { adultId: null, routing: 'shared' }
}

/** Split `amount` by `shares` so the parts add up exactly. */
function split(amount: Money, adults: Entity[], shares: Record<string, number>): Record<string, Money> {
  const out: Record<string, Money> = {}
  let left = amount
  adults.forEach((a, i) => {
    const part = i === adults.length - 1 ? left : Math.round(amount * (shares[a.id] ?? 0))
    out[a.id] = part
    left -= part
  })
  return out
}

/** What the row asks the household to pay this month, in base currency. */
function amountToPay(row: Row, c: CellResult): Money {
  if (row.section === 'income') return 0
  if (row.section === 'expense' && row.kind !== 'debt-payment') return c.funding.cash
  return c.valueBase
}

/** Rows taken out of an income row that is live this month: already inside that row's net, so never a line or own spend. */
function deductionTest(rows: Row[]): (r: Row) => boolean {
  const incomeIds = new Set(rows.filter((r) => r.section === 'income').map((r) => r.id))
  return (r) => r.section === 'expense' && r.deductedFromRowId != null && incomeIds.has(r.deductedFromRowId)
}

export function computeContributions(tables: Tables, out: EngineOutput, month: MonthKey): MonthContributions {
  const household = tables.household.find((h) => !h.deletedAt)
  const adults = liveAdults(tables, month)
  const adultIds = new Set(adults.map((a) => a.id))
  const cellOf = (row: Row) => out.cells[cellKey(row.id, month)]
  const rows = out.rows.filter((r) => !(r.archivedMonth && r.archivedMonth <= month))
  const isDeduction = deductionTest(rows)

  // ---- basis and shares (net of deductions; a net below zero counts as nothing)
  const basis: Record<string, Money> = Object.fromEntries(adults.map((a) => [a.id, 0]))
  const basisMode = household?.shareBasis ?? 'basis-rows'
  const anyBasisRow = rows.some((r) => r.section === 'income' && r.inShareBasis)
  for (const r of rows) {
    if (r.section !== 'income') continue
    if (basisMode === 'basis-rows' && anyBasisRow && !r.inShareBasis) continue
    if (basisMode === 'manual') continue
    const { adultId } = ownerOf(r, tables, adultIds)
    if (adultId) basis[adultId] += Math.max(0, cellOf(r)?.netBase ?? 0)
  }
  let shares: Record<string, number> = {}
  if (basisMode === 'manual') {
    const manual = household?.manualShares ?? {}
    const sum = adults.reduce((s, a) => s + (manual[a.id] ?? 0), 0)
    for (const a of adults) shares[a.id] = sum > 0 ? (manual[a.id] ?? 0) / sum : 1 / Math.max(1, adults.length)
  } else {
    const total = adults.reduce((s, a) => s + basis[a.id], 0)
    for (const a of adults) shares[a.id] = total > 0 ? basis[a.id] / total : 1 / Math.max(1, adults.length)
  }
  if (adults.length === 0) shares = {}

  // ---- income per adult
  const income: Record<string, Money> = Object.fromEntries(adults.map((a) => [a.id, 0]))
  for (const r of rows) {
    if (r.section !== 'income') continue
    const v = cellOf(r)?.netBase ?? 0
    if (v === 0) continue
    const { adultId } = ownerOf(r, tables, adultIds)
    if (adultId) income[adultId] += v
    else for (const [id, part] of Object.entries(split(v, adults, shares))) income[id] += part
  }

  // ---- outflow lines
  const lines: ShareLine[] = []
  for (const r of rows) {
    const c = cellOf(r)
    if (!c || c.source === 'archived' || isDeduction(r)) continue
    const total = amountToPay(r, c)
    if (total === 0) continue
    const { adultId, routing } = ownerOf(r, tables, adultIds)
    const byAdult = adultId ? Object.fromEntries(adults.map((a) => [a.id, a.id === adultId ? total : 0])) : split(total, adults, shares)
    lines.push({ rowId: r.id, name: r.name, section: r.section, kind: r.kind, total, byAdult, destinationAccountId: r.accountId ?? null, routing })
  }

  const result: AdultContribution[] = adults.map((a) => {
    const owedByDestination: Record<string, Money> = {}
    let owed = 0
    for (const l of lines) {
      const part = l.byAdult[a.id] ?? 0
      if (part === 0) continue
      owed += part
      const key = l.destinationAccountId ?? ''
      owedByDestination[key] = (owedByDestination[key] ?? 0) + part
    }
    return { entityId: a.id, name: a.name, basis: basis[a.id], share: shares[a.id] ?? 0, income: income[a.id], owed, owedByDestination, remainder: income[a.id] - owed }
  })
  return { month, basisTotal: adults.reduce((s, a) => s + basis[a.id], 0), adults: result, lines }
}

export function computePersonBudgets(tables: Tables, out: EngineOutput, month: MonthKey): PersonBudget[] {
  const adults = liveAdults(tables, month)
  const adultIds = new Set(adults.map((a) => a.id))
  const rows = out.rows.filter((r) => !(r.archivedMonth && r.archivedMonth <= month))
  const isDeduction = deductionTest(rows)
  return adults.map((a) => {
    let income = 0
    let ownSpend = 0
    let pocket = 0
    for (const r of rows) {
      const c = out.cells[cellKey(r.id, month)]
      if (!c || c.source === 'archived') continue
      const { adultId } = ownerOf(r, tables, adultIds)
      if (adultId !== a.id) continue
      if (r.section === 'income') income += c.netBase
      else if (r.kind === 'pocket-money') pocket += c.valueBase
      else if (r.section === 'expense' && !isDeduction(r)) ownSpend += c.valueBase
    }
    return { entityId: a.id, name: a.name, income, ownSpend, pocket, contribution: income - ownSpend - pocket }
  })
}
