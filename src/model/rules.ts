import type { Account, Household, Row } from './schema'

/**
 * Rules: how the transfer that feeds an account is worked out each month. One reading of the stored fields for the
 * engine, the store and the screens, so they never disagree about which row takes the rest.
 *
 *   typed            the amount is typed and carries forward (`rule` 'fixed', or no rule on a row that is not the rest)
 *   share-of-income  a share of the month's take-home income
 *   share-of-rest    a share of what the month has left after spending, typed amounts, income shares and the buffer
 *   rest             what is left after all of that; one "to savings" row, and only under the savings-plug rule
 *   idle             a "to savings" row without a rule beside the rest row: stays at zero, as it always did
 */
export interface RuleState {
  kind: 'share-of-income' | 'share-of-rest' | 'rest' | 'idle'
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

/** Rows that can carry a rule: the transfer to a savings account, an investment account or a pool account. */
export const canCarryRule = (row: Pick<Row, 'section' | 'kind'>): boolean =>
  row.section !== 'income' && (row.kind === 'to-savings' || row.kind === 'to-investment' || row.kind === 'pool-allocation')

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
    if (row.kind === 'to-savings' && plug) {
      if (rule === 'rest') {
        if (!rest) rest = row
        else warnings.push(`"${rest.name}" and "${row.name}" are both set to take the rest; "${rest.name}" takes it.`)
        continue
      }
      if (rule === null) {
        unruled.push(row)
        continue
      }
    }
    if (!canCarryRule(row)) continue
    if (rule === 'share-of-income' || rule === 'share-of-rest') byRow.set(row.id, { kind: rule, share: row.ruleShare ?? 0, typedCounts: true })
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

/** 0.1 → "10 %", 0.125 → "12.5 %": a share to a tenth of a percent. */
export const sharePercent = (share: number): string => `${Math.round(share * 1000) / 10} %`

/**
 * What a row's rule reads as, in the words the rule dialog uses: `a fixed amount`, `10 % of income`,
 * `30 % of what is left`, `the rest`. A row that carries no rule of its own reads as a fixed amount.
 */
export function ruleLabel(state: RuleState | undefined): string {
  if (!state) return 'a fixed amount'
  if (state.kind === 'share-of-income') return `${sharePercent(state.share)} of income`
  if (state.kind === 'share-of-rest') return `${sharePercent(state.share)} of what is left`
  if (state.kind === 'rest') return 'the rest'
  return 'nothing: another account takes the rest'
}
