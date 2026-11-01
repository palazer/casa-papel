import type { EntityKind, RowKind, Section } from './schema'

/** A suggested row. `{name}` in the title is replaced with the entity's name. */
export interface RowTemplate {
  key: string
  title: string
  section: Section
  kind?: RowKind
  defaultStatus?: 'projected' | 'committed'
  /** 'entity' scopes the row to the entity (personal / dependent); default shared. */
  scope?: 'entity' | 'shared'
  /** Tag the row with the entity so per-entity views can find it. */
  tag?: boolean
  inShareBasis?: boolean
  /** Pocket money row sharing the household pocket total. */
  pocket?: boolean
  /** Needs a destination account of this type. */
  account?: 'savings' | 'investment'
  /** Creates a pool with an allocation row; the row itself is the pool-funded spend. */
  pool?: boolean
  /** Pre-ticked in the wizard. */
  recommended?: boolean
}

export const HOUSEHOLD_TEMPLATES: RowTemplate[] = [
  { key: 'h.groceries', title: 'Groceries', section: 'expense', recommended: true },
  { key: 'h.transport', title: 'Transport', section: 'expense', recommended: true },
  { key: 'h.subscriptions', title: 'Subscriptions', section: 'expense', defaultStatus: 'committed', recommended: true },
  { key: 'h.health', title: 'Health', section: 'expense' },
  { key: 'h.gym', title: 'Gym & sports', section: 'expense' },
  { key: 'h.insurance', title: 'Insurance & tax', section: 'expense', defaultStatus: 'committed', recommended: true },
  { key: 'h.other', title: 'Other', section: 'expense', recommended: true },
  { key: 'h.otherIncome', title: 'Other income', section: 'income', recommended: true },
  { key: 'h.toSavings', title: 'To savings', section: 'transfer', kind: 'to-savings', defaultStatus: 'committed', account: 'savings', recommended: true },
  { key: 'h.toInvestments', title: 'To investments', section: 'transfer', kind: 'to-investment', defaultStatus: 'committed', account: 'investment' },
  { key: 'h.poolTravel', title: 'Travel', section: 'expense', pool: true, recommended: true },
  { key: 'h.poolClothing', title: 'Clothing', section: 'expense', pool: true },
  { key: 'h.poolFun', title: 'Entertainment & dining out', section: 'expense', pool: true },
]

export const ENTITY_TEMPLATES: Record<EntityKind, RowTemplate[]> = {
  adult: [
    { key: 'a.salary', title: '{name} – Salary', section: 'income', kind: 'salary', defaultStatus: 'committed', scope: 'entity', inShareBasis: true, recommended: true },
    { key: 'a.extra', title: '{name} – Extra income', section: 'income', scope: 'entity' },
    { key: 'a.personal', title: '{name} – Personal', section: 'expense', scope: 'entity', recommended: true },
    { key: 'a.pocket', title: 'Pocket – {name}', section: 'transfer', kind: 'pocket-money', defaultStatus: 'committed', scope: 'entity', pocket: true, recommended: true },
  ],
  child: [
    { key: 'c.benefit', title: 'Child benefit – {name}', section: 'income', defaultStatus: 'committed', scope: 'entity', tag: true, recommended: true },
    { key: 'c.care', title: 'Childcare & school – {name}', section: 'expense', defaultStatus: 'committed', scope: 'entity', tag: true, recommended: true },
    { key: 'c.gear', title: 'Gear & clothes – {name}', section: 'expense', tag: true },
    { key: 'c.longterm', title: 'Long-term savings – {name}', section: 'transfer', kind: 'to-investment', defaultStatus: 'committed', scope: 'entity', tag: true, account: 'investment' },
  ],
  pet: [
    { key: 'p.insurance', title: 'Insurance – {name}', section: 'expense', defaultStatus: 'committed', tag: true, recommended: true },
    { key: 'p.tax', title: 'Tax – {name}', section: 'expense', defaultStatus: 'committed', tag: true },
    { key: 'p.food', title: 'Food & supplies – {name}', section: 'expense', tag: true, recommended: true },
    { key: 'p.vet', title: 'Vet – {name}', section: 'expense', tag: true },
  ],
  vehicle: [
    { key: 'v.loan', title: 'Loan or lease – {name}', section: 'expense', kind: 'debt-payment', defaultStatus: 'committed', tag: true },
    { key: 'v.insurance', title: 'Insurance – {name}', section: 'expense', defaultStatus: 'committed', tag: true, recommended: true },
    { key: 'v.tax', title: 'Tax & inspection – {name}', section: 'expense', defaultStatus: 'committed', tag: true },
    { key: 'v.fuel', title: 'Fuel & parking – {name}', section: 'expense', tag: true, recommended: true },
    { key: 'v.maintenance', title: 'Maintenance – {name}', section: 'expense', tag: true },
  ],
  property: [
    { key: 'r.rent', title: 'Rent or mortgage – {name}', section: 'expense', defaultStatus: 'committed', tag: true, recommended: true },
    { key: 'r.utilities', title: 'Utilities – {name}', section: 'expense', defaultStatus: 'committed', tag: true, recommended: true },
    { key: 'r.internet', title: 'Internet & phone – {name}', section: 'expense', defaultStatus: 'committed', tag: true },
    { key: 'r.improvement', title: 'Home improvement – {name}', section: 'expense', tag: true },
    { key: 'r.insurance', title: 'Home insurance – {name}', section: 'expense', defaultStatus: 'committed', tag: true },
  ],
  company: [
    { key: 'k.expenses', title: 'Company expenses – {name}', section: 'expense', tag: true, recommended: true },
    { key: 'k.debt', title: 'Company debt payments – {name}', section: 'expense', kind: 'debt-payment', defaultStatus: 'committed', tag: true },
  ],
  other: [
    { key: 'o.costs', title: 'Costs – {name}', section: 'expense', tag: true, recommended: true },
  ],
}

export function templateTitle(t: RowTemplate, entityName?: string): string {
  return t.title.replace('{name}', entityName ?? '')
}

export const ENTITY_KIND_LABEL: Record<EntityKind, string> = {
  adult: 'Adult', child: 'Child', pet: 'Pet', vehicle: 'Vehicle', property: 'Home', company: 'Company', other: 'Other',
}
