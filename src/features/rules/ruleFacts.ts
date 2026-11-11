import { RULE_KIND_INFO, isOldPocketShare, isPocketRow, isShareRule, resolveRules, type Account, type Entity, type Household, type Pool, type Row, type Tables } from '@/model'
import { sortRows } from '@/engine'
import { ruleRowOf, type RuleChoice, type RuleTarget } from '@/store'

export type RuleKind = RuleChoice['kind']

const KINDS = RULE_KIND_INFO.map((k) => ({ value: k.value as RuleKind, label: k.label, text: k.help }))

/** What the picker and the fields read about the thing a rule is set on. */
export interface RuleFacts {
  /** The row the rule sits on; null for an account or a virtual account that no row fills yet. */
  row: Row | null
  /** Why this cannot have a rule at all. */
  error?: string
  pool?: Pool
  account?: Account
  /** What the money goes to, by name: the virtual account, else the account, else the row. */
  name: string
  /** Pocket money: never the rest, and a percentage of its adult's own income instead. */
  pocket: boolean
  /** The adult the pocket money is for. */
  adult?: Entity
  /** Pocket money that still reads the pocket total the household had before. */
  wasShareOfTotal: boolean
  /** The choices on offer, in order. */
  kinds: Array<{ value: RuleKind; label: string; text: string }>
  /** The rule the row has now; a typed row has a fixed amount. */
  current: RuleKind
  /** The fraction of the rule it has now, when that is a percentage. */
  share: number | null
  /** The row that takes the rest now, and whether that is this one. */
  restRowName: string | null
  hasRest: boolean
  /** What the other rows already take of what is left. */
  othersOfRest: number
  ccy: string
}

/** Read everything the rule's picker and fields need. Pure: memoise it on the tables. */
export function ruleFacts(tables: Tables, household: Household, target: RuleTarget): RuleFacts {
  let row: Row | null = null
  let error: string | undefined
  try {
    row = ruleRowOf(tables, target)
  } catch (e) {
    error = e instanceof Error ? e.message : 'That cannot have a rule.'
  }
  const pool = 'poolId' in target ? tables.pools.find((p) => p.id === target.poolId) : row ? tables.pools.find((p) => !p.deletedAt && p.allocationRowId === row.id) : undefined
  const account = 'accountId' in target ? tables.accounts.find((a) => a.id === target.accountId) : row?.accountId ? tables.accounts.find((a) => a.id === row.accountId) : undefined
  const pocket = !!row && isPocketRow(row)
  const adult = row && pocket ? tables.entities.find((e) => e.id === row.scope && !e.deletedAt && e.kind === 'adult') : undefined
  const kinds = KINDS
    .filter((k) => (pocket ? k.value !== 'rest' : k.value !== 'share-of-own-income'))
    .map((k) => (k.value === 'share-of-own-income' && adult ? { ...k, label: `A percentage of ${adult.name}'s income` } : k))
  const rules = resolveRules(sortRows(tables.rows.filter((r) => !r.deletedAt), tables.categories), household.closingRule)
  const state = row ? rules.byRow.get(row.id) : undefined
  let othersOfRest = 0
  for (const [id, s] of rules.byRow) if (s.kind === 'share-of-rest' && id !== row?.id) othersOfRest += s.share
  return {
    row, error, pool, account, pocket, adult, kinds,
    name: pool?.name ?? account?.name ?? row?.name ?? 'this account',
    wasShareOfTotal: !!row && isOldPocketShare(row),
    current: state && (isShareRule(state.kind) || state.kind === 'rest') ? state.kind : 'fixed',
    share: state && state.share > 0 ? state.share : null,
    restRowName: tables.rows.find((r) => r.id === rules.restRowId)?.name ?? null,
    hasRest: !!row && rules.restRowId === row.id,
    othersOfRest,
    ccy: row?.currency ?? household.baseCurrency,
  }
}
