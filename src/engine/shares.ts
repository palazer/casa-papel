/**
 * Per person: what each adult brings in, spends on themselves and takes as pocket money, and what that leaves for the
 * household. A row counts for an adult when it belongs to them ("Belongs to…"); everything else is the household's.
 */
import type { Entity, Money, MonthKey, Row, Tables } from '@/model'
import { cardIsItemized } from '@/model'
import { cellKey, type EngineOutput } from './types'

export interface PersonBudget {
  entityId: string
  name: string
  income: Money
  /** Expense rows that are this person's own. */
  ownSpend: Money
  pocket: Money
  /** income − own spend − pocket: what this person leaves for the household. */
  contribution: Money
}

const sortEntities = (list: Entity[]) => [...list].sort((a, b) => (a.order < b.order ? -1 : a.order > b.order ? 1 : 0))

function liveAdults(tables: Tables, month: MonthKey): Entity[] {
  return sortEntities(tables.entities.filter((e) => e.kind === 'adult' && !e.deletedAt && !(e.archivedMonth && e.archivedMonth <= month)))
}

/** Cards whose purchases are expense rows: their payment only moves money, so it is nobody's spending a second time. */
const itemizedCards = (tables: Tables): Set<string> => new Set(tables.accounts.filter((a) => !a.deletedAt && cardIsItemized(a)).map((a) => a.id))

/** Rows taken out of an income row that is live this month: already inside that row's net, so never own spending. */
function deductionTest(rows: Row[]): (r: Row) => boolean {
  const incomeIds = new Set(rows.filter((r) => r.section === 'income').map((r) => r.id))
  return (r) => r.section === 'expense' && r.deductedFromRowId != null && incomeIds.has(r.deductedFromRowId)
}

export function computePersonBudgets(tables: Tables, out: EngineOutput, month: MonthKey): PersonBudget[] {
  const adults = liveAdults(tables, month)
  const rows = out.rows.filter((r) => !(r.archivedMonth && r.archivedMonth <= month))
  const isDeduction = deductionTest(rows)
  const itemized = itemizedCards(tables)
  return adults.map((a) => {
    let income = 0
    let ownSpend = 0
    let pocket = 0
    for (const r of rows) {
      if (r.scope !== a.id) continue
      const c = out.cells[cellKey(r.id, month)]
      if (!c || c.source === 'archived') continue
      if (r.section === 'income') income += c.netBase
      else if (r.kind === 'pocket-money') pocket += c.valueBase
      else if (r.kind === 'card-payment' && r.accountId && itemized.has(r.accountId)) continue // moves money; the purchases were the spending
      else if (r.section === 'expense' && !isDeduction(r)) ownSpend += c.valueBase
    }
    return { entityId: a.id, name: a.name, income, ownSpend, pocket, contribution: income - ownSpend - pocket }
  })
}
