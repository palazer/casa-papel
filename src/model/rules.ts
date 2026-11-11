import type { Account, Household, Row } from './schema'

/**
 * Rules: how the transfer that feeds an account, or an adult's pocket money, is worked out each month. One reading of
 * the stored fields for the engine, the store and the screens, so they never disagree about which row takes the rest.
 *
 *   typed                the amount is typed and carries forward (`rule` 'fixed', or no rule on a row that is not the rest)
 *   share-of-income      a share of the month's take-home income
 *   share-of-own-income  pocket money only: a share of the take-home income of the adult the row belongs to
 *   share-of-rest        a share of what the month has left after spending, typed amounts, income shares and the buffer
 *   rest             what is left after all of that; one row, and only under the savings-plug rule. In a month that
 *                    overruns the same row takes the difference back
 *   idle             a "to savings" row without a rule beside the rest row: stays at zero, as it always did
 */
export interface RuleState {
  kind: 'share-of-income' | 'share-of-own-income' | 'share-of-rest' | 'rest' | 'idle'
  /** The fraction for a share rule; 0 otherwise. */
  share: number
  /**
   * A month with a typed amount shows the typed amount. False for rows that never chose a rule (the first "to savings"
   * row of a savings-plug household and the idle ones beside it): what their cells hold was always ignored.
   */
  typedCounts: boolean
}

export interface Rules {
  /** Rows the app works out, by row id. A row that is not here is typed. */
  byRow: Map<string, RuleState>
  /** The row that takes the rest of the month, or null: then the rest stays in the main account. */
  restRowId: string | null
  warnings: string[]
}

/** Money taken out of an account into the month by hand: it counts as money in, never as income to take a share of. */
export const isTakenFromAccount = (row: Pick<Row, 'kind'>): boolean => row.kind === 'from-investment' || row.kind === 'from-savings'

/** Rows that can take the rest of the month: the transfer to a savings account, an investment account or a virtual account. */
export const canTakeRest = (row: Pick<Row, 'section' | 'kind'>): boolean =>
  row.section !== 'income' && (row.kind === 'to-savings' || row.kind === 'to-investment' || row.kind === 'pool-allocation')

/** An adult's pocket money: it can carry a rule, but never takes the rest. */
export const isPocketRow = (row: Pick<Row, 'section' | 'kind'>): boolean => row.section !== 'income' && row.kind === 'pocket-money'

/** Rows that can carry a rule: the transfers that can take the rest, and pocket money. */
export const canCarryRule = (row: Pick<Row, 'section' | 'kind'>): boolean => canTakeRest(row) || isPocketRow(row)

/** The rules that take a percentage: the app works the amount out every month. */
export const isShareRule = (kind: string | null | undefined): kind is 'share-of-income' | 'share-of-own-income' | 'share-of-rest' =>
  kind === 'share-of-income' || kind === 'share-of-own-income' || kind === 'share-of-rest'

/** Pocket money worked out the old way, as a share of the household's pocket total, until the row gets a rule of its own. */
export const isOldPocketShare = (row: Pick<Row, 'kind' | 'pocketMode' | 'rule'>): boolean =>
  row.kind === 'pocket-money' && row.pocketMode === 'share-of-pocket-total' && (row.rule ?? null) === null

/** The live, unarchived rows that move money into a savings or an investment account; none for any other account. */
export function rowsFeeding(rows: Row[], account: Pick<Account, 'id' | 'type'>): Row[] {
  const kind = account.type === 'savings' ? 'to-savings' : account.type === 'investment' ? 'to-investment' : null
  if (!kind) return []
  return rows.filter((r) => !r.deletedAt && !r.archivedMonth && r.section !== 'income' && r.kind === kind && r.accountId === account.id)
}

/**
 * Read every row's rule. `rows` are the live rows in display order: the first one that qualifies wins where only one
 * can. A stored household that never set a rule comes out exactly as before rules existed.
 */
export function resolveRules(rows: Row[], closingRule: Household['closingRule']): Rules {
  const plug = closingRule === 'savings-plug'
  const byRow = new Map<string, RuleState>()
  const warnings: string[] = []
  let rest: Row | null = null
  /** "To savings" rows without a rule under the plug: the first takes the rest unless a row was chosen for it. */
  const unruled: Row[] = []
  for (const row of rows) {
    const rule = row.rule ?? null
    const carries = canCarryRule(row)
    // any transfer that feeds an account can be chosen for the rest; the first one chosen takes it
    if (plug && canTakeRest(row) && rule === 'rest') {
      if (!rest) rest = row
      else warnings.push(`"${rest.name}" and "${row.name}" are both set to take the rest; "${rest.name}" takes it.`)
      continue
    }
    if (plug && row.kind === 'to-savings' && rule === null) {
      unruled.push(row)
      continue
    }
    if (!carries) continue
    // a share of an adult's own income is pocket money's alone
    if (rule === 'share-of-own-income' && !isPocketRow(row)) continue
    if (isShareRule(rule)) byRow.set(row.id, { kind: rule, share: row.ruleShare ?? 0, typedCounts: true })
  }
  const idle: RuleState = { kind: 'idle', share: 0, typedCounts: false }
  if (rest) {
    byRow.set(rest.id, { kind: 'rest', share: 0, typedCounts: true })
    for (const r of unruled) byRow.set(r.id, idle)
  } else if (unruled.length) {
    rest = unruled[0]
    byRow.set(rest.id, { kind: 'rest', share: 0, typedCounts: false })
    for (const r of unruled.slice(1)) byRow.set(r.id, idle)
    if (unruled.length > 1) warnings.push('More than one "to savings" row: the plug goes to the first one.')
  }
  return { byRow, restRowId: rest?.id ?? null, warnings }
}

const PERCENT = new Intl.NumberFormat('en', { style: 'percent', maximumFractionDigits: 1 })

/** 0.1 → "10%", 0.125 → "12.5%": a share to a tenth of a percent, for messages that have no locale at hand. */
export const sharePercent = (share: number): string => PERCENT.format(share)
