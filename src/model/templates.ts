import type { AccountType, EntityKind, GoalKind, RowKind, RowRule, Section } from './schema'

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
  /** An adult's pocket money: a line of its own, with an amount or a rule. */
  pocket?: boolean
  /** Needs a destination account of this type. */
  account?: 'savings' | 'investment' | 'loan'
  /** Creates a pool with an allocation row; the row itself is the pool-funded spend. */
  pool?: boolean
  /** One of the usual rows: the Statement suggests it straight away, the others wait behind "More suggestions". */
  recommended?: boolean
  /** The usual expense category the row belongs to, by name, when the household has it. */
  category?: string
}

/** The six expense categories most households use, in grid order. */
export const DEFAULT_CATEGORIES = ['Housing', 'Living', 'Transport', 'Family & pets', 'Fun', 'Personal'] as const

export const HOUSEHOLD_TEMPLATES: RowTemplate[] = [
  { key: 'h.otherIncome', title: 'Other income', description: 'Refunds, gifts, side income that is nobody\'s salary.', section: 'income', recommended: true },
  { key: 'h.groceries', title: 'Groceries', description: 'Food and everyday supplies.', section: 'expense', recommended: true, category: 'Living' },
  { key: 'h.transport', title: 'Transport', description: 'Public transport, taxis, bike.', section: 'expense', recommended: true, category: 'Transport' },
  { key: 'h.subscriptions', title: 'Subscriptions', description: 'Streaming, phone, software. Counted as certain.', section: 'expense', defaultStatus: 'committed', recommended: true, category: 'Fun' },
  { key: 'h.health', title: 'Health', description: 'Doctor, pharmacy, glasses.', section: 'expense', category: 'Living' },
  { key: 'h.gym', title: 'Gym & sports', description: 'Memberships and sports.', section: 'expense', category: 'Personal' },
  { key: 'h.insurance', title: 'Insurance & tax', description: 'Liability and household insurance, taxes not tied to a car or home.', section: 'expense', defaultStatus: 'committed', recommended: true, category: 'Living' },
  { key: 'h.other', title: 'Other', description: 'Whatever fits nowhere else. Treated as an estimate.', section: 'expense', recommended: true },
  { key: 'h.poolTravel', title: 'Travel', description: 'Pool account: set aside a monthly amount in savings, spend it when you travel.', section: 'expense', pool: true, recommended: true, category: 'Fun' },
  { key: 'h.poolClothing', title: 'Clothing', description: 'Pool account: a monthly amount set aside for clothes.', section: 'expense', pool: true, category: 'Fun' },
  { key: 'h.poolFun', title: 'Entertainment & dining out', description: 'Pool account: a monthly amount set aside for going out.', section: 'expense', pool: true, category: 'Fun' },
  { key: 'h.toSavings', title: 'To savings', description: 'What is left at month end moves to savings. Filled in automatically unless your month-end rule says you decide it.', section: 'transfer', kind: 'to-savings', defaultStatus: 'committed', account: 'savings', recommended: true },
  { key: 'h.toInvestments', title: 'To investments', description: 'A fixed monthly deposit into an investment account.', section: 'transfer', kind: 'to-investment', defaultStatus: 'committed', account: 'investment' },
]

export const ENTITY_TEMPLATES: Record<EntityKind, RowTemplate[]> = {
  adult: [
    { key: 'a.salary', title: '{name} – Salary', description: 'Net salary after tax. Counted as certain.', section: 'income', kind: 'salary', defaultStatus: 'committed', scope: 'entity', inShareBasis: true, recommended: true },
    { key: 'a.extra', title: '{name} – Extra income', description: 'Bonuses, freelance work, side income.', section: 'income', scope: 'entity' },
    { key: 'a.personal', title: '{name} – Personal', description: 'Own spending the household pays for, like a phone contract or a membership.', section: 'expense', scope: 'entity', recommended: true, category: 'Personal' },
    { key: 'a.pocket', title: '{name} – Pocket', description: 'Money this adult spends freely each month: an amount you type, or a percentage once the line has a rule.', section: 'transfer', kind: 'pocket-money', defaultStatus: 'committed', scope: 'entity', pocket: true, recommended: true },
  ],
  child: [
    { key: 'c.benefit', title: '{name} – Child benefit', description: 'State child benefit or allowance.', section: 'income', defaultStatus: 'committed', scope: 'entity', tag: true, recommended: true },
    { key: 'c.care', title: '{name} – Childcare & school', description: 'Daycare, school fees, clubs.', section: 'expense', defaultStatus: 'committed', scope: 'entity', tag: true, recommended: true, category: 'Family & pets' },
    { key: 'c.gear', title: '{name} – Gear & clothes', description: 'Clothes, toys, equipment.', section: 'expense', tag: true, category: 'Family & pets' },
    { key: 'c.longterm', title: '{name} – Long-term savings', description: 'A monthly deposit into an investment account kept for the child.', section: 'transfer', kind: 'to-investment', defaultStatus: 'committed', scope: 'entity', tag: true, account: 'investment' },
  ],
  pet: [
    { key: 'p.insurance', title: '{name} – Insurance', description: 'Pet liability or health insurance.', section: 'expense', defaultStatus: 'committed', tag: true, recommended: true, category: 'Family & pets' },
    { key: 'p.tax', title: '{name} – Tax', description: 'Pet tax or licence where it applies.', section: 'expense', defaultStatus: 'committed', tag: true, category: 'Family & pets' },
    { key: 'p.food', title: '{name} – Food & supplies', description: 'Food, litter, toys.', section: 'expense', tag: true, recommended: true, category: 'Family & pets' },
    { key: 'p.vet', title: '{name} – Vet', description: 'Check-ups and treatment.', section: 'expense', tag: true, category: 'Family & pets' },
  ],
  vehicle: [
    { key: 'v.loan', title: '{name} – Loan or lease', description: 'The monthly car loan or lease payment. Linked to a loan account, it brings the outstanding amount down.', section: 'expense', kind: 'debt-payment', defaultStatus: 'committed', tag: true, account: 'loan', category: 'Transport' },
    { key: 'v.insurance', title: '{name} – Insurance', description: 'Car insurance.', section: 'expense', defaultStatus: 'committed', tag: true, recommended: true, category: 'Transport' },
    { key: 'v.tax', title: '{name} – Tax & inspection', description: 'Road tax and the periodic inspection.', section: 'expense', defaultStatus: 'committed', tag: true, category: 'Transport' },
    { key: 'v.fuel', title: '{name} – Fuel & parking', description: 'Fuel or charging, parking, tolls.', section: 'expense', tag: true, recommended: true, category: 'Transport' },
    { key: 'v.maintenance', title: '{name} – Maintenance', description: 'Service, tyres, repairs.', section: 'expense', tag: true, category: 'Transport' },
  ],
  property: [
    { key: 'r.rent', title: '{name} – Rent or mortgage', description: 'The monthly rent or mortgage payment.', section: 'expense', defaultStatus: 'committed', tag: true, recommended: true, category: 'Housing' },
    { key: 'r.utilities', title: '{name} – Utilities', description: 'Electricity, gas, water, heating.', section: 'expense', defaultStatus: 'committed', tag: true, recommended: true, category: 'Housing' },
    { key: 'r.internet', title: '{name} – Internet & phone', description: 'Home internet, landline, TV licence.', section: 'expense', defaultStatus: 'committed', tag: true, category: 'Housing' },
    { key: 'r.improvement', title: '{name} – Home improvement', description: 'Furniture, repairs, decoration.', section: 'expense', tag: true, category: 'Housing' },
    { key: 'r.insurance', title: '{name} – Home insurance', description: 'Contents or building insurance.', section: 'expense', defaultStatus: 'committed', tag: true, category: 'Housing' },
  ],
  company: [
    { key: 'k.expenses', title: '{name} – Company expenses', description: 'What the business costs you each month.', section: 'expense', tag: true, recommended: true },
    { key: 'k.debt', title: '{name} – Company debt payments', description: 'Repayments on money the company owes. Linked to a loan account, it brings the debt down.', section: 'expense', kind: 'debt-payment', defaultStatus: 'committed', tag: true, account: 'loan' },
  ],
  other: [
    { key: 'o.costs', title: '{name} – Costs', description: 'Running costs of this thing.', section: 'expense', tag: true, recommended: true },
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

/**
 * What a goal is for, as the app asks it: fill an account or a pool account to an amount, or pay a debt down to one.
 * Net worth is the third, set only from the Statement's Net worth line. The stored kinds stay as they were: "fill" is
 * `account-balance` or `pool-balance` by what it watches, "pay-down" is `pay-off`.
 */
export type GoalFamily = 'fill' | 'pay-down' | 'net-worth'
export const goalFamilyOf = (kind: GoalKind): GoalFamily => (kind === 'pay-off' ? 'pay-down' : kind === 'net-worth' ? 'net-worth' : 'fill')

export const GOAL_KIND_INFO: Array<{ value: GoalFamily; label: string; help: string }> = [
  { value: 'fill', label: 'Fill an account', help: 'A savings, investment or other asset account, or a pool account, reaches an amount. An account is compared in its own currency.' },
  { value: 'pay-down', label: 'Pay down a debt', help: 'A card or loan comes down to an amount, zero unless you type another. Progress counts down from what was owed when you set the goal.' },
  { value: 'net-worth', label: 'Reach a net worth', help: 'Tracked assets minus tracked debts, in your base currency. Set it from the "Net worth" line on the Statement.' },
]

/**
 * How the transfer into an account, or an adult's pocket money, is worked out each month: the rule dialog's choices,
 * one sentence each. An account is offered all but the adult's own income; pocket money all but the rest.
 */
export const RULE_KIND_INFO: Array<{ value: RowRule; label: string; help: string }> = [
  { value: 'fixed', label: 'A fixed amount', help: 'The same amount every month until you change it.' },
  { value: 'share-of-income', label: 'A percentage of income', help: 'A share of the month\'s take-home income: what comes in, minus what is deducted from it. Money taken out of investments does not count.' },
  { value: 'share-of-own-income', label: 'A percentage of their own income', help: 'Pocket money only: a share of what the adult it is for takes home, the income lines that belong to them minus what is deducted from those. An income the household shares counts for nobody.' },
  { value: 'share-of-rest', label: 'A percentage of what is left', help: 'A share of what the month has left after spending, fixed amounts, percentages of income and the cash kept in the account. Nothing in a month that overruns.' },
  { value: 'rest', label: 'The rest', help: 'Everything that is left after all of that. One account can take the rest, and the same account fills the gap in a month that overruns.' },
]

export const ACCOUNT_TYPE_INFO: Array<{ value: AccountType; label: string; help: string }> = [
  { value: 'checking', label: 'Current account', help: 'Where salary lands and bills leave. Day-to-day money; its balance is not tracked.' },
  { value: 'joint', label: 'Joint account', help: 'A shared account partners pay into for shared bills. Pick this when a fixed amount moves there every month.' },
  { value: 'savings', label: 'Savings', help: 'Where the month\'s leftover goes. The balance is tracked month by month, and pool accounts live inside it.' },
  { value: 'investment', label: 'Investments', help: 'Broker, fund or pension account. Deposits and value are tracked.' },
  { value: 'credit-card', label: 'Credit card', help: 'Spend now, pay later. The open balance is tracked.' },
  { value: 'loan', label: 'Loan', help: 'Money you owe. Payments bring the outstanding amount down.' },
  { value: 'other-asset', label: 'Other asset', help: 'Something you own with a value, like a rental deposit. Counts towards net worth.' },
  { value: 'cash', label: 'Cash', help: 'Wallet money. Only if you want to track it separately.' },
]
