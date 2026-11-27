import { inEveryLanguage, sameText, txt, type Messages } from '@/i18n'
import type { AccountType, EntityKind, GoalKind, RowKind, RowRule, Section } from './schema'

/**
 * The model's tables of words. The words themselves are in the language catalogue (`src/i18n`, `txt.model`); the tables
 * here keep the order and everything that is not a word.
 */

/** A suggested row. `{name}` in the title is replaced with the entity's name. */
export interface RowTemplate {
  key: string
  title: string
  /** One line a first-time user understands. */
  description: string
  section: Section
  kind?: RowKind
  defaultStatus?: 'projected' | 'committed'
  /** 'entity' scopes the row to the entity (personal / dependent); default shared. */
  scope?: 'entity' | 'shared'
  /** Tag the row with the entity so per-entity views can find it. */
  tag?: boolean
  /** An adult's pocket money: a line of its own, with an amount or a rule. */
  pocket?: boolean
  /** Needs a destination account of this type. */
  account?: 'savings' | 'investment' | 'loan'
  /** Creates a pool with an allocation row; the row itself is the pool-funded spend. */
  pool?: boolean
  /** One of the usual rows: the Statement suggests it straight away, the others wait behind "More suggestions". */
  recommended?: boolean
  /** The usual expense category the row belongs to, when the household has it (`isUsualCategory` finds it by name). */
  category?: CategoryKey
}

/** The six expense categories most households use, in grid order, by the name the household gets them under. */
const CATEGORY = txt.names.category
/** One of the six usual expense categories. */
export type CategoryKey = keyof Messages['names']['category']
const CATEGORY_KEYS = Object.keys(CATEGORY) as CategoryKey[]

/**
 * Whether a category's name is that usual category's: in either language, since the device that made it may speak
 * another one, and whatever its case. A category the household renamed is no longer it.
 */
export const isUsualCategory = (name: string, key: CategoryKey): boolean => inEveryLanguage((m) => m.names.category[key]).some((n) => sameText(n, name))

/** The usual categories a household does not have yet, by the names of this device's language. */
export const missingUsualCategories = (have: string[]): string[] => CATEGORY_KEYS.filter((k) => !have.some((n) => isUsualCategory(n, k))).map((k) => CATEGORY[k])
export const DEFAULT_CATEGORIES: readonly string[] = Object.values(CATEGORY)

/** A suggestion: its words from the catalogue, by its key, and the rest of what it is. */
const t = (key: keyof typeof txt.model.templates, rest: Omit<RowTemplate, 'key' | 'title' | 'description'>): RowTemplate => ({ key, ...txt.model.templates[key], ...rest })

export const HOUSEHOLD_TEMPLATES: RowTemplate[] = [
  t('h.otherIncome', { section: 'income', recommended: true }),
  t('h.groceries', { section: 'expense', recommended: true, category: 'living' }),
  t('h.transport', { section: 'expense', recommended: true, category: 'transport' }),
  t('h.subscriptions', { section: 'expense', defaultStatus: 'committed', recommended: true, category: 'fun' }),
  t('h.health', { section: 'expense', category: 'living' }),
  t('h.gym', { section: 'expense', category: 'personal' }),
  t('h.insurance', { section: 'expense', defaultStatus: 'committed', recommended: true, category: 'living' }),
  t('h.other', { section: 'expense', recommended: true }),
  t('h.poolTravel', { section: 'expense', pool: true, recommended: true, category: 'fun' }),
  t('h.poolClothing', { section: 'expense', pool: true, category: 'fun' }),
  t('h.poolFun', { section: 'expense', pool: true, category: 'fun' }),
  t('h.toSavings', { section: 'transfer', kind: 'to-savings', defaultStatus: 'committed', account: 'savings', recommended: true }),
  t('h.toInvestments', { section: 'transfer', kind: 'to-investment', defaultStatus: 'committed', account: 'investment' }),
]

export const ENTITY_TEMPLATES: Record<EntityKind, RowTemplate[]> = {
  adult: [
    t('a.salary', { section: 'income', kind: 'salary', defaultStatus: 'committed', scope: 'entity', recommended: true }),
    t('a.extra', { section: 'income', scope: 'entity' }),
    t('a.personal', { section: 'expense', scope: 'entity', recommended: true, category: 'personal' }),
    t('a.pocket', { section: 'transfer', kind: 'pocket-money', defaultStatus: 'committed', scope: 'entity', pocket: true, recommended: true }),
  ],
  child: [
    t('c.benefit', { section: 'income', defaultStatus: 'committed', scope: 'entity', tag: true, recommended: true }),
    t('c.care', { section: 'expense', defaultStatus: 'committed', scope: 'entity', tag: true, recommended: true, category: 'family' }),
    t('c.gear', { section: 'expense', tag: true, category: 'family' }),
    t('c.longterm', { section: 'transfer', kind: 'to-investment', defaultStatus: 'committed', scope: 'entity', tag: true, account: 'investment' }),
  ],
  pet: [
    t('p.insurance', { section: 'expense', defaultStatus: 'committed', tag: true, recommended: true, category: 'family' }),
    t('p.tax', { section: 'expense', defaultStatus: 'committed', tag: true, category: 'family' }),
    t('p.food', { section: 'expense', tag: true, recommended: true, category: 'family' }),
    t('p.vet', { section: 'expense', tag: true, category: 'family' }),
  ],
  vehicle: [
    t('v.loan', { section: 'expense', kind: 'debt-payment', defaultStatus: 'committed', tag: true, account: 'loan', category: 'transport' }),
    t('v.insurance', { section: 'expense', defaultStatus: 'committed', tag: true, recommended: true, category: 'transport' }),
    t('v.tax', { section: 'expense', defaultStatus: 'committed', tag: true, category: 'transport' }),
    t('v.fuel', { section: 'expense', tag: true, recommended: true, category: 'transport' }),
    t('v.maintenance', { section: 'expense', tag: true, category: 'transport' }),
  ],
  property: [
    t('r.rent', { section: 'expense', defaultStatus: 'committed', tag: true, recommended: true, category: 'housing' }),
    t('r.utilities', { section: 'expense', defaultStatus: 'committed', tag: true, recommended: true, category: 'housing' }),
    t('r.internet', { section: 'expense', defaultStatus: 'committed', tag: true, category: 'housing' }),
    t('r.improvement', { section: 'expense', tag: true, category: 'housing' }),
    t('r.insurance', { section: 'expense', defaultStatus: 'committed', tag: true, category: 'housing' }),
  ],
  company: [
    t('k.expenses', { section: 'expense', tag: true, recommended: true }),
    t('k.debt', { section: 'expense', kind: 'debt-payment', defaultStatus: 'committed', tag: true, account: 'loan' }),
  ],
  other: [
    t('o.costs', { section: 'expense', tag: true, recommended: true }),
  ],
}

export function templateTitle(t: RowTemplate, entityName?: string): string {
  return t.title.replace('{name}', entityName ?? '')
}

const pick = <K extends string, V extends object, F extends keyof V>(told: Record<K, V>, field: F): Record<K, V[F]> =>
  Object.fromEntries(Object.entries<V>(told).map(([k, v]) => [k, v[field]])) as Record<K, V[F]>
/** A table of choices in the catalogue's order: each choice's value with its words. */
const listed = <K extends string, V extends object>(told: Record<K, V>): Array<{ value: K } & V> =>
  (Object.keys(told) as K[]).map((value) => ({ value, ...told[value] }))

export const ENTITY_KIND_LABEL: Record<EntityKind, string> = pick(txt.model.entityKind, 'label')

export const ENTITY_KIND_HELP: Record<EntityKind, string> = pick(txt.model.entityKind, 'help')

export const SECTION_INFO: Record<Section, { label: string; blurb: string }> = txt.model.section

/**
 * What a goal is for, as the app asks it: fill an account or a virtual account to an amount, or pay a debt down to one.
 * Net worth is the third, set only from the Statement's Net worth line. The stored kinds stay as they were: "fill" is
 * `account-balance` or `pool-balance` by what it watches, "pay-down" is `pay-off`.
 */
export type GoalFamily = 'fill' | 'pay-down' | 'net-worth'
export const goalFamilyOf = (kind: GoalKind): GoalFamily => (kind === 'pay-off' ? 'pay-down' : kind === 'net-worth' ? 'net-worth' : 'fill')

export const GOAL_KIND_INFO: Array<{ value: GoalFamily; label: string; help: string }> = listed(txt.model.goalKind)

/**
 * How the transfer into an account, or an adult's pocket money, is worked out each month: the choices under "How the
 * amount is set", one sentence each. An account is offered all but the adult's own income; pocket money all but the rest.
 */
export const RULE_KIND_INFO: Array<{ value: RowRule; label: string; help: string }> = listed(txt.model.ruleKind)

export const ACCOUNT_TYPE_INFO: Array<{ value: AccountType; label: string; help: string }> = listed(txt.model.accountType)
