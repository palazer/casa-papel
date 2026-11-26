import { ACCOUNT_TYPE_INFO, ENTITY_KIND_HELP, ENTITY_KIND_LABEL, GOAL_KIND_INFO, PAYMENT_KIND_INFO, RULE_KIND_INFO, type EntityKind } from '@/model'
import { txt } from '@/i18n'
import type { HelpKey } from './help'
import type { Screen } from './screens'

/**
 * The Guide (DESIGN.md §2): one module, no React. The words are in the catalogue (`src/i18n/en/guide.ts`); here is
 * what does not change with the language: the order of the topics, their keys, their (i) texts and the screen each
 * opens. Topics that explain a choice carry the model's own option texts as `facts`, so the Guide and the dialogs
 * never disagree.
 */

export const REPO_URL = 'https://github.com/palazer/casa-papel'

export const GUIDE_LEAD = txt.guide.lead

export interface GuideFact {
  label: string
  text: string
}

export interface GuideTopic {
  /** Kebab-case; the section's id is `guide-<key>`. */
  key: string
  title: string
  /** One sentence under the title. */
  summary: string
  /** One to three short paragraphs: what it is and how it behaves. */
  what: string[]
  /** Numbered steps naming the exact controls in quotes. */
  steps: string[]
  /** The model's own option texts, when the topic explains a choice. */
  factsTitle?: string
  facts?: GuideFact[]
  /** The (i) texts that belong to the topic, rendered from `HELP` so the two never disagree. */
  tips: HelpKey[]
  /** The screen the "Open …" button goes to. */
  open: Screen
}

const kinds: GuideFact[] = (Object.keys(ENTITY_KIND_LABEL) as EntityKind[]).map((k) => ({ label: ENTITY_KIND_LABEL[k], text: ENTITY_KIND_HELP[k] }))
const rules: GuideFact[] = RULE_KIND_INFO.map((r) => ({ label: r.label, text: r.help }))
const accountTypes: GuideFact[] = ACCOUNT_TYPE_INFO.map((a) => ({ label: a.label, text: a.help }))
const goalKinds: GuideFact[] = GOAL_KIND_INFO.map((g) => ({ label: g.label, text: g.help }))
const paymentKinds: GuideFact[] = PAYMENT_KIND_INFO.map((k) => ({ label: k.label, text: k.help }))

const T = txt.guide.topics

/** The topics in the Guide's order: the words from the catalogue, and what does not change with the language. */
export const GUIDE: GuideTopic[] = [
  { key: 'statement', ...T.statement, tips: ['statement.progress', 'cell.howSure', 'row.automatic', 'derived.keptInAccount', 'derived.leftover', 'statement.months', 'statement.month', 'statement.position', 'statement.expenses', 'statement.setAside', 'statement.fromAccounts', 'statement.setup', 'statement.suggestions', 'statement.mainAccount', 'statement.netWorth', 'statement.free', 'statement.perPerson'], open: 'statement' },
  { key: 'grid', ...T.grid, tips: ['section.income', 'section.expense', 'section.transfer', 'derived.incomeTotal', 'derived.expensesTotal', 'derived.netWorth', 'cell.repeats', 'past.question'], open: 'grid' },
  { key: 'people', ...T.people, facts: kinds, tips: ['row.belongsTo', 'household.archived'], open: 'household' },
  { key: 'income', ...T.income, tips: ['section.income', 'row.deductedFrom', 'cell.deductions', 'row.follows', 'row.followShare', 'derived.incomeTotal'], open: 'statement' },
  { key: 'spending', ...T.spending, tips: ['section.expense', 'cell.howSure', 'cell.comesOutOf', 'row.category', 'household.categories', 'household.usualCategories', 'row.categoryEstimate', 'derived.expensesTotal', 'derived.fromSavings'], open: 'statement' },
  { key: 'schedules', ...T.schedules, tips: ['schedule.status', 'statement.progress'], open: 'household' },
  { key: 'virtual-accounts', ...T['virtual-accounts'], tips: ['balance.pool', 'cell.comesOutOf', 'derived.fromSavings', 'balance.savings'], open: 'household' },
  { key: 'transfers', ...T.transfers, facts: rules, tips: ['section.transfer', 'derived.keptInAccount', 'derived.leftover', 'row.toSavingsPlug', 'household.buffer', 'household.bufferScope', 'row.automatic', 'row.rule', 'row.ruleFrom', 'statement.mainAccount', 'balance.currentAccount', 'statement.mainAccountQuestion'], open: 'household' },
  { key: 'investments', ...T.investments, facts: accountTypes, tips: ['balance.investmentValue', 'balance.deposited', 'balance.return', 'balance.inBase', 'household.tracked', 'setup.owner', 'derived.netWorth'], open: 'household' },
  { key: 'debts', ...T.debts, tips: ['balance.cardOwed', 'balance.loanOutstanding', 'balance.otherAsset', 'derived.netWorth', 'household.tracked'], open: 'household' },
  { key: 'payments', ...T.payments, facts: paymentKinds, tips: ['payments.switch', 'payments.usual', 'payments.kind', 'payments.note', 'payments.owner', 'payments.archivedMethod'], open: 'household' },
  { key: 'payments-page', ...T['payments-page'], tips: ['payments.toPay', 'payments.byDay', 'payments.untracked', 'payments.totals', 'payments.people'], open: 'payments' },
  { key: 'goals', ...T.goals, facts: goalKinds, tips: ['goal.status'], open: 'statement' },
  { key: 'trends', ...T.trends, tips: ['trends.tiles', 'trends.amounts', 'trends.changes', 'trends.breakdown', 'trends.goals'], open: 'trends' },
  { key: 'pocket-money', ...T['pocket-money'], tips: ['row.belongsTo', 'row.rule', 'row.ruleFrom', 'statement.perPerson'], open: 'statement' },
  { key: 'currencies', ...T.currencies, tips: ['row.currency', 'cell.rate', 'cell.conversion', 'statement.rate', 'balance.inBase', 'household.fxForecast'], open: 'household' },
  { key: 'remove', ...T.remove, tips: ['remove.archiveFrom', 'household.archived'], open: 'household' },
  { key: 'data', ...T.data, tips: ['data.export', 'sync.privacy'], open: 'data' },
  { key: 'marks', ...T.marks, tips: ['cell.howSure', 'row.automatic'], open: 'grid' },
]
