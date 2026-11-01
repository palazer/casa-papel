import type { AccountType, EntityKind, RowKind, Section } from './schema'

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
  { key: 'h.otherIncome', title: 'Other income', description: 'Refunds, gifts, side income that is nobody\'s salary.', section: 'income', recommended: true },
  { key: 'h.groceries', title: 'Groceries', description: 'Food and everyday supplies.', section: 'expense', recommended: true },
  { key: 'h.transport', title: 'Transport', description: 'Public transport, taxis, bike.', section: 'expense', recommended: true },
  { key: 'h.subscriptions', title: 'Subscriptions', description: 'Streaming, phone, software. Counted as certain.', section: 'expense', defaultStatus: 'committed', recommended: true },
  { key: 'h.health', title: 'Health', description: 'Doctor, pharmacy, glasses.', section: 'expense' },
  { key: 'h.gym', title: 'Gym & sports', description: 'Memberships and sports.', section: 'expense' },
  { key: 'h.insurance', title: 'Insurance & tax', description: 'Liability and household insurance, taxes not tied to a car or home.', section: 'expense', defaultStatus: 'committed', recommended: true },
  { key: 'h.other', title: 'Other', description: 'Whatever fits nowhere else. Treated as an estimate.', section: 'expense', recommended: true },
  { key: 'h.poolTravel', title: 'Travel', description: 'Pool: set aside a monthly amount in savings, spend it when you travel.', section: 'expense', pool: true, recommended: true },
  { key: 'h.poolClothing', title: 'Clothing', description: 'Pool: a monthly amount set aside for clothes.', section: 'expense', pool: true },
  { key: 'h.poolFun', title: 'Entertainment & dining out', description: 'Pool: a monthly amount set aside for going out.', section: 'expense', pool: true },
  { key: 'h.toSavings', title: 'To savings', description: 'What is left at month end moves to savings. Filled in automatically unless your month-end rule says you decide it.', section: 'transfer', kind: 'to-savings', defaultStatus: 'committed', account: 'savings', recommended: true },
  { key: 'h.toInvestments', title: 'To investments', description: 'A fixed monthly deposit into an investment account.', section: 'transfer', kind: 'to-investment', defaultStatus: 'committed', account: 'investment' },
]

export const ENTITY_TEMPLATES: Record<EntityKind, RowTemplate[]> = {
  adult: [
    { key: 'a.salary', title: '{name} – Salary', description: 'Net salary after tax. Counted as certain.', section: 'income', kind: 'salary', defaultStatus: 'committed', scope: 'entity', inShareBasis: true, recommended: true },
    { key: 'a.extra', title: '{name} – Extra income', description: 'Bonuses, freelance work, side income.', section: 'income', scope: 'entity' },
    { key: 'a.personal', title: '{name} – Personal', description: 'Own spending the household pays for, like a phone contract or a membership.', section: 'expense', scope: 'entity', recommended: true },
    { key: 'a.pocket', title: 'Pocket – {name}', description: 'This adult\'s share of the pocket money total. Computed, not typed.', section: 'transfer', kind: 'pocket-money', defaultStatus: 'committed', scope: 'entity', pocket: true, recommended: true },
  ],
  child: [
    { key: 'c.benefit', title: 'Child benefit – {name}', description: 'State child benefit or allowance.', section: 'income', defaultStatus: 'committed', scope: 'entity', tag: true, recommended: true },
    { key: 'c.care', title: 'Childcare & school – {name}', description: 'Daycare, school fees, clubs.', section: 'expense', defaultStatus: 'committed', scope: 'entity', tag: true, recommended: true },
    { key: 'c.gear', title: 'Gear & clothes – {name}', description: 'Clothes, toys, equipment.', section: 'expense', tag: true },
    { key: 'c.longterm', title: 'Long-term savings – {name}', description: 'A monthly deposit into an investment account kept for the child.', section: 'transfer', kind: 'to-investment', defaultStatus: 'committed', scope: 'entity', tag: true, account: 'investment' },
  ],
  pet: [
    { key: 'p.insurance', title: 'Insurance – {name}', description: 'Pet liability or health insurance.', section: 'expense', defaultStatus: 'committed', tag: true, recommended: true },
    { key: 'p.tax', title: 'Tax – {name}', description: 'Pet tax or licence where it applies.', section: 'expense', defaultStatus: 'committed', tag: true },
    { key: 'p.food', title: 'Food & supplies – {name}', description: 'Food, litter, toys.', section: 'expense', tag: true, recommended: true },
    { key: 'p.vet', title: 'Vet – {name}', description: 'Check-ups and treatment.', section: 'expense', tag: true },
  ],
  vehicle: [
    { key: 'v.loan', title: 'Loan or lease – {name}', description: 'The monthly car loan or lease payment.', section: 'expense', kind: 'debt-payment', defaultStatus: 'committed', tag: true },
    { key: 'v.insurance', title: 'Insurance – {name}', description: 'Car insurance.', section: 'expense', defaultStatus: 'committed', tag: true, recommended: true },
    { key: 'v.tax', title: 'Tax & inspection – {name}', description: 'Road tax and the periodic inspection.', section: 'expense', defaultStatus: 'committed', tag: true },
    { key: 'v.fuel', title: 'Fuel & parking – {name}', description: 'Fuel or charging, parking, tolls.', section: 'expense', tag: true, recommended: true },
    { key: 'v.maintenance', title: 'Maintenance – {name}', description: 'Service, tyres, repairs.', section: 'expense', tag: true },
  ],
  property: [
    { key: 'r.rent', title: 'Rent or mortgage – {name}', description: 'The monthly rent or mortgage payment.', section: 'expense', defaultStatus: 'committed', tag: true, recommended: true },
    { key: 'r.utilities', title: 'Utilities – {name}', description: 'Electricity, gas, water, heating.', section: 'expense', defaultStatus: 'committed', tag: true, recommended: true },
    { key: 'r.internet', title: 'Internet & phone – {name}', description: 'Home internet, landline, TV licence.', section: 'expense', defaultStatus: 'committed', tag: true },
    { key: 'r.improvement', title: 'Home improvement – {name}', description: 'Furniture, repairs, decoration.', section: 'expense', tag: true },
    { key: 'r.insurance', title: 'Home insurance – {name}', description: 'Contents or building insurance.', section: 'expense', defaultStatus: 'committed', tag: true },
  ],
  company: [
    { key: 'k.expenses', title: 'Company expenses – {name}', description: 'What the business costs you each month.', section: 'expense', tag: true, recommended: true },
    { key: 'k.debt', title: 'Company debt payments – {name}', description: 'Repayments on money the company owes.', section: 'expense', kind: 'debt-payment', defaultStatus: 'committed', tag: true },
  ],
  other: [
    { key: 'o.costs', title: 'Costs – {name}', description: 'Running costs of this thing.', section: 'expense', tag: true, recommended: true },
  ],
}

export function templateTitle(t: RowTemplate, entityName?: string): string {
  return t.title.replace('{name}', entityName ?? '')
}

export const ENTITY_KIND_LABEL: Record<EntityKind, string> = {
  adult: 'Adult', child: 'Child', pet: 'Pet', vehicle: 'Vehicle', property: 'Home', company: 'Company', other: 'Other',
}

export const ENTITY_KIND_HELP: Record<EntityKind, string> = {
  adult: 'Someone with their own income or personal spending.',
  child: 'Child benefit, childcare and long-term savings rows. "Paid by" says whose income carries the costs when contributions are split.',
  pet: 'Food, vet, insurance and tax rows.',
  vehicle: 'Insurance, fuel, loan or lease, maintenance rows.',
  property: 'The place you live, rented or owned, or another property. Rent or mortgage, utilities, internet and insurance rows.',
  company: 'A business you own. Its expenses and debt payments get their own rows.',
  other: 'Anything else with running costs, like a boat or a hobby.',
}

export const SECTION_INFO: Record<Section, { label: string; blurb: string }> = {
  income: { label: 'Money in', blurb: 'What arrives during the month.' },
  expense: { label: 'Spending', blurb: 'What leaves and does not come back.' },
  transfer: { label: 'Moving money', blurb: 'From one of your accounts to another, or to a person\'s pocket. Not spending, so it is never counted as an expense.' },
}

export const ACCOUNT_TYPE_INFO: Array<{ value: AccountType; label: string; help: string }> = [
  { value: 'checking', label: 'Current account', help: 'Where salary lands and bills leave. Day-to-day money; its balance is not tracked.' },
  { value: 'joint', label: 'Joint account', help: 'A shared account partners pay into for shared bills. Pick this when a fixed amount moves there every month.' },
  { value: 'savings', label: 'Savings', help: 'Where the month\'s leftover goes. The balance is tracked month by month, and pools live inside it.' },
  { value: 'investment', label: 'Investments', help: 'Broker, fund or pension account. Deposits and value are tracked.' },
  { value: 'credit-card', label: 'Credit card', help: 'Spend now, pay later. The open balance is tracked.' },
  { value: 'loan', label: 'Loan', help: 'Money you owe. Payments bring the outstanding amount down.' },
  { value: 'other-asset', label: 'Other asset', help: 'Something you own with a value, like a rental deposit. Counts towards net worth.' },
  { value: 'cash', label: 'Cash', help: 'Wallet money. Only if you want to track it separately.' },
]
