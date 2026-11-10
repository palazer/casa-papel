import { z } from 'zod'
import { ID_PATTERN } from './ids'
import { MONTH_PATTERN } from './month'
import { FUNDED_BY_PATTERN } from './fundedBy'

// The built page's content security policy (vite.config.ts) forbids `new Function`. Zod would only try it once and
// fall back, but the browser logs the attempt as a violation; this skips the attempt and gives every build one code path.
z.config({ jitless: true })

/** Bump when the shape of stored data changes; add a migration in migrations.ts. */
export const SCHEMA_VERSION = 7

// ---------- primitives ----------
export const IdSchema = z.string().regex(ID_PATTERN, 'expected ULID')
export const MonthKeySchema = z.string().regex(MONTH_PATTERN, 'expected YYYY-MM')
export const CurrencyCodeSchema = z.string().regex(/^[A-Z]{3}$/, 'expected ISO 4217 code')
export const MoneySchema = z.number().int()
export const TimestampSchema = z.number().int().nonnegative() // epoch ms
export const FractionSchema = z.number() // 0..1 share, or a rate
export const IsoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
export const FundedBySchema = z.string().regex(FUNDED_BY_PATTERN) as unknown as z.ZodType<`cash` | `savings` | `pool:${string}`>
export const ItemStatusSchema = z.enum(['projected', 'committed', 'done'])
export const DefaultStatusSchema = z.enum(['projected', 'committed'])
export const SectionSchema = z.enum(['income', 'expense', 'transfer'])

/** Common fields on every durable record. Soft-deleted via `deletedAt`. */
const BaseRecord = z.object({
  id: IdSchema,
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
  deletedAt: TimestampSchema.nullable().default(null),
})

// ---------- household ----------
export const ClosingRuleSchema = z.enum(['savings-plug', 'leftover-plug'])
export const MoneyModeSchema = z.enum(['pooled', 'proportional'])
export const ShareBasisSchema = z.enum(['basis-rows', 'all-income', 'manual'])
export const FxMonthRateSchema = z.enum(['last', 'first', 'average'])

export const HouseholdSchema = BaseRecord.extend({
  name: z.string().min(1),
  baseCurrency: CurrencyCodeSchema,
  locale: z.string().min(2),
  startMonth: MonthKeySchema,
  closingRule: ClosingRuleSchema.default('savings-plug'),
  /** Total pocket money per month, split between adults by their pocket rows. */
  pocketTotal: MoneySchema.default(0),
  /** Cash deliberately left in checking at month end. Default 0. */
  cashBuffer: MoneySchema.default(0),
  moneyMode: MoneyModeSchema.default('pooled'),
  shareBasis: ShareBasisSchema.default('basis-rows'),
  manualShares: z.record(IdSchema, FractionSchema).default({}),
  displayExpensesNegative: z.boolean().default(true),
  /** Default monthly FX drift (fraction) for projected rates. */
  fxDriftDefault: z.number().default(0),
  /** Which day's ECB rate stands for a month: the first business day by default (decided 2026-11-08), the last, or the average. */
  fxMonthRate: FxMonthRateSchema.default('first'),
  /** How future rates are projected: a fixed monthly drift, or the average month-over-month change of the last year. */
  fxDriftMode: z.enum(['fixed', 'average']).default('fixed'),
  /** Per-pair monthly drift overrides, e.g. { 'EUR/TRY': 0.015 }. */
  fxPairDrift: z.record(z.string(), z.number()).default({}),
  /** "Add <year>": the plan reaches at least this December. null = the calendar rule alone decides (see store/months.ts). */
  planUntil: MonthKeySchema.nullable().default(null),
})

// ---------- entities ----------
export const EntityKindSchema = z.enum(['adult', 'child', 'pet', 'vehicle', 'property', 'company', 'other'])

export const EntitySchema = BaseRecord.extend({
  kind: EntityKindSchema,
  name: z.string().min(1),
  attributes: z.record(z.string(), z.string()).default({}),
  /** Adult charged for rows scoped to this entity (children, pets, vehicles…). */
  paidBy: IdSchema.nullable().default(null),
  archivedMonth: MonthKeySchema.nullable().default(null),
  order: z.string().default('a0'),
})

// ---------- accounts ----------
export const AccountTypeSchema = z.enum([
  'checking', 'joint', 'savings', 'investment', 'credit-card', 'loan', 'other-asset', 'cash',
])

export const InvestmentSettingsSchema = z.object({
  projectionMode: z.enum(['fixed-rate', 'historical-average']).default('fixed-rate'),
  /** Annual growth as a fraction, e.g. 0.03. */
  annualRate: z.number().default(0),
  depositTiming: z.enum(['start', 'end']).default('start'),
  depositFxMode: z.enum(['monthly-rate', 'fixed']).default('monthly-rate'),
  fixedRate: z.number().positive().nullable().default(null),
})

export const CardSettingsSchema = z.object({
  cardMode: z.enum(['itemized', 'lump']).default('itemized'),
})

export const AccountSchema = BaseRecord.extend({
  name: z.string().min(1),
  type: AccountTypeSchema,
  currency: CurrencyCodeSchema,
  /** null = household / joint. */
  ownerEntityId: IdSchema.nullable().default(null),
  openingBalance: MoneySchema.default(0),
  openingMonth: MonthKeySchema,
  /** Balance computed month by month by the engine. */
  tracked: z.boolean().default(false),
  investment: InvestmentSettingsSchema.optional(),
  card: CardSettingsSchema.optional(),
  archivedMonth: MonthKeySchema.nullable().default(null),
  order: z.string().default('a0'),
})

/** Manual truths for one account in one month; override engine values. */
export const AccountMonthSchema = z.object({
  accountId: IdSchema,
  month: MonthKeySchema,
  actualBalance: MoneySchema.nullable().default(null),
  actualDeposit: MoneySchema.nullable().default(null),
  actualSpend: MoneySchema.nullable().default(null),
  note: z.string().default(''),
  updatedAt: TimestampSchema,
})

// ---------- categories & rows ----------
export const CategorySchema = BaseRecord.extend({
  name: z.string().min(1),
  section: SectionSchema,
  order: z.string().default('a0'),
})

export const RowKindSchema = z.enum([
  'plain', 'salary', 'to-savings', 'to-investment', 'from-investment',
  'pocket-money', 'pool-allocation', 'debt-payment', 'card-payment',
  // An expense category's estimate: its cells hold what the whole category is expected to come to, and the engine
  // counts only what the category's other rows have not explained yet ("Not broken down yet"). One per category.
  'category-estimate',
  // Money taken out of a savings account into the month by hand: to fill a gap, or to top up a pool account. The
  // counterpart of 'from-investment'; both count as money in and lower the account they come from.
  'from-savings',
])

/**
 * How the transfer that feeds a savings account, an investment account or a pool account is worked out each month:
 * a typed amount that carries forward, a share of the month's take-home income, a share of what the month has left,
 * or the rest of the month (one savings row). `model/rules.ts` reads it for the engine, the store and the screens.
 */
export const RowRuleSchema = z.enum(['fixed', 'share-of-income', 'share-of-rest', 'rest'])

export const RowSchema = BaseRecord.extend({
  name: z.string().min(1),
  section: SectionSchema,
  kind: RowKindSchema.default('plain'),
  categoryId: IdSchema.nullable().default(null),
  entityTags: z.array(IdSchema).default([]),
  /** 'shared' or an entity id: who this row belongs to for splitting. */
  scope: z.string().default('shared'),
  inShareBasis: z.boolean().default(false),
  /** null = household base currency. */
  currency: CurrencyCodeSchema.nullable().default(null),
  /** Paying account (expenses) or destination account (transfers). */
  accountId: IdSchema.nullable().default(null),
  defaultFundedBy: FundedBySchema.default('cash'),
  defaultStatus: DefaultStatusSchema.default('projected'),
  pocketMode: z.enum(['fixed', 'share-of-pocket-total']).nullable().default(null),
  pocketShare: FractionSchema.nullable().default(null),
  /** Mirror another row's amount every month; this row's own cells are ignored while set. */
  followsRowId: IdSchema.nullable().default(null),
  /** With followsRowId: this row shows the followed amount × share (0.25 = a quarter). null = the whole amount. */
  followShare: FractionSchema.nullable().default(null),
  /** Expense rows only: the income row this is taken out of (tax, a pension contribution). The income's net is what the shares count. */
  deductedFromRowId: IdSchema.nullable().default(null),
  /**
   * The row's rule (see `RowRuleSchema`). null = as before rules existed: the amount is typed, and under the
   * savings-plug month-end rule the first "to savings" row takes the rest. A month with a typed amount shows that
   * amount whatever the rule says; that is how the months before a rule started keep theirs.
   */
  rule: RowRuleSchema.nullable().default(null),
  /** With a share rule: the fraction of its base (0.1 = 10 %). */
  ruleShare: FractionSchema.nullable().default(null),
  archivedMonth: MonthKeySchema.nullable().default(null),
  order: z.string().default('a0'),
})

// ---------- cells ----------
export const CellItemSchema = z.object({
  id: IdSchema,
  label: z.string().default(''),
  amount: MoneySchema,
  status: ItemStatusSchema.default('projected'),
  fundedBy: FundedBySchema.default('cash'),
  date: IsoDateSchema.nullable().default(null),
  note: z.string().nullable().default(null),
  recurringItemId: IdSchema.nullable().default(null),
  /** 'carry' contributes the previous month's effective value. */
  kind: z.enum(['normal', 'carry']).default('normal'),
  skipped: z.boolean().default(false),
  /** Amount/label/funding set by hand for this month; the recurring schedule leaves it alone. */
  pinned: z.boolean().optional(),
})

export const CellModeSchema = z.enum(['inherit', 'value', 'items'])

export const CellSchema = z.object({
  rowId: IdSchema,
  month: MonthKeySchema,
  mode: CellModeSchema.default('inherit'),
  value: MoneySchema.nullable().default(null),
  items: z.array(CellItemSchema).default([]),
  note: z.string().nullable().default(null),
  currencyOverride: CurrencyCodeSchema.nullable().default(null),
  /** Automatic rows only (the savings plug, a pocket share, a follower): this month's amount was ticked as moved. */
  markedDone: z.boolean().default(false),
  updatedAt: TimestampSchema,
})

// ---------- recurring ----------
export const CadenceSchema = z.object({
  intervalMonths: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(6), z.literal(12)]),
  anchorMonth: z.number().int().min(1).max(12),
})

export const RecurringItemSchema = BaseRecord.extend({
  name: z.string().min(1),
  rowId: IdSchema,
  amount: MoneySchema,
  currency: CurrencyCodeSchema.nullable().default(null),
  cadence: CadenceSchema.nullable().default(null),
  /** Explicit due months (1..12) when cadence is null. */
  dueMonths: z.array(z.number().int().min(1).max(12)).nullable().default(null),
  accountId: IdSchema.nullable().default(null),
  scope: z.string().default('shared'),
  fundedBy: FundedBySchema.default('cash'),
  startMonth: MonthKeySchema,
  endMonth: MonthKeySchema.nullable().default(null),
  notes: z.string().default(''),
})

// ---------- pools, fx, months ----------
export const PoolSchema = BaseRecord.extend({
  name: z.string().min(1),
  /** Savings account that holds this pool account. */
  accountId: IdSchema,
  allocationRowId: IdSchema.nullable().default(null),
  openingBalance: MoneySchema.default(0),
  archivedMonth: MonthKeySchema.nullable().default(null),
  order: z.string().default('a0'),
})

export const FxRateSchema = z.object({
  /** e.g. EUR/TRY = how many TRY for 1 EUR */
  pair: z.string().regex(/^[A-Z]{3}\/[A-Z]{3}$/),
  month: MonthKeySchema,
  rate: z.number().positive(),
  source: z.enum(['api', 'manual', 'projected']),
  /** For a fetched rate: the day it was taken on (the month-rate policy's day). null for manual rates and averages. */
  date: IsoDateSchema.nullable().default(null),
  updatedAt: TimestampSchema,
})

export const MonthStateSchema = z.object({
  month: MonthKeySchema,
  closed: z.boolean().default(false),
  closedAt: TimestampSchema.nullable().default(null),
  pocketTotalOverride: MoneySchema.nullable().default(null),
  cashBufferOverride: MoneySchema.nullable().default(null),
  updatedAt: TimestampSchema,
})

// ---------- events & meta ----------
// ---------- goals ----------
export const GoalKindSchema = z.enum(['account-balance', 'pool-balance', 'pay-off', 'net-worth'])

/** A finish line: grow an account or pool account to an amount, clear a debt, or reach a net worth. */
export const GoalSchema = BaseRecord.extend({
  name: z.string().min(1),
  kind: GoalKindSchema,
  /** account-balance and pay-off: the account watched. */
  accountId: IdSchema.nullable().default(null),
  /** pool-balance: the pool account watched. */
  poolId: IdSchema.nullable().default(null),
  /** Minor units in the account's currency (account kinds) or the base currency (pool, net worth). 0 for pay-off. */
  target: MoneySchema.default(0),
  /** Month the goal was set; pay-off progress counts down from what was owed then. */
  startMonth: MonthKeySchema,
  targetMonth: MonthKeySchema.nullable().default(null),
  notes: z.string().default(''),
  order: z.string().default('a0'),
})

export const TableNameSchema = z.enum([
  'household', 'entities', 'accounts', 'accountMonths', 'categories', 'rows',
  'cells', 'recurringItems', 'pools', 'fxRates', 'monthStates', 'goals',
])

/** Every mutation is a put (full record) or a delete (by key). `inverse` is the previous record, null if none. */
export const EventSchema = z.object({
  id: IdSchema,
  ts: TimestampSchema,
  deviceId: z.string().min(1),
  schemaVersion: z.number().int().positive(),
  /** Groups the events of one user action for undo. */
  txId: IdSchema,
  type: z.enum(['put', 'delete']),
  table: TableNameSchema,
  /** Primary key: id string or composite tuple. */
  key: z.unknown(),
  /** Full record for put; null for delete. */
  record: z.unknown().nullable(),
  inverse: z.unknown().nullable(),
})

/** This device's link to the cloud copy of its household. Present only while signed in. */
export const SyncStateSchema = z.object({
  householdId: z.string().min(1),
  email: z.string().min(1),
  /** The household key (AES-GCM-256, base64). Same threat model as the data in this database. */
  keyB64: z.string().nullable().default(null),
  /** Owner of the household row; owners may delete the cloud copy. */
  owner: z.boolean().default(false),
  /** Version of the last cloud snapshot this device pushed or pulled. */
  lastVersion: z.number().int().nonnegative().default(0),
  lastPullAt: TimestampSchema.nullable().default(null),
  lastPushAt: TimestampSchema.nullable().default(null),
  lastError: z.string().nullable().default(null),
  /** When pushes started failing; null while healthy. */
  failingSince: TimestampSchema.nullable().default(null),
})

export const MetaSchema = z.object({
  key: z.literal('meta'),
  schemaVersion: z.number().int().positive(),
  deviceId: z.string().min(1),
  lastExportAt: TimestampSchema.nullable().default(null),
  eventsSinceExport: z.number().int().nonnegative().default(0),
  /** Newest timestamp merged in from elsewhere; local writes stay above it so last-write-wins keeps its order. */
  clockFloor: TimestampSchema.default(0),
  /** Counts every local change (commits, imports, wipes). The sync engine pushes when it passes pushedRevision. */
  localRevision: z.number().int().nonnegative().default(0),
  pushedRevision: z.number().int().nonnegative().default(0),
  sync: SyncStateSchema.nullable().default(null),
})

export const TablesSchema = z.object({
  household: z.array(HouseholdSchema),
  entities: z.array(EntitySchema),
  accounts: z.array(AccountSchema),
  accountMonths: z.array(AccountMonthSchema),
  categories: z.array(CategorySchema),
  rows: z.array(RowSchema),
  cells: z.array(CellSchema),
  recurringItems: z.array(RecurringItemSchema),
  pools: z.array(PoolSchema),
  fxRates: z.array(FxRateSchema),
  monthStates: z.array(MonthStateSchema),
  goals: z.array(GoalSchema).default([]),
})

export const ExportFileSchema = z.object({
  format: z.literal('casa-papel'),
  schemaVersion: z.number().int().positive(),
  exportedAt: TimestampSchema,
  deviceId: z.string().min(1),
  tables: TablesSchema,
  events: z.array(EventSchema),
})

// ---------- inferred types ----------
export type Household = z.infer<typeof HouseholdSchema>
export type Entity = z.infer<typeof EntitySchema>
export type EntityKind = z.infer<typeof EntityKindSchema>
export type Account = z.infer<typeof AccountSchema>
export type AccountType = z.infer<typeof AccountTypeSchema>
export type AccountMonth = z.infer<typeof AccountMonthSchema>
export type Category = z.infer<typeof CategorySchema>
export type Row = z.infer<typeof RowSchema>
export type RowKind = z.infer<typeof RowKindSchema>
export type RowRule = z.infer<typeof RowRuleSchema>
export type Section = z.infer<typeof SectionSchema>
export type Cell = z.infer<typeof CellSchema>
/** A cell as written, before defaults fill in: what `putCell` and the demo build. */
export type CellInput = z.input<typeof CellSchema>
export type CellItem = z.infer<typeof CellItemSchema>
export type ItemStatus = z.infer<typeof ItemStatusSchema>
export type RecurringItem = z.infer<typeof RecurringItemSchema>
export type Cadence = z.infer<typeof CadenceSchema>
export type Pool = z.infer<typeof PoolSchema>
export type FxRate = z.infer<typeof FxRateSchema>
export type Goal = z.infer<typeof GoalSchema>
export type GoalKind = z.infer<typeof GoalKindSchema>
export type FxMonthRate = z.infer<typeof FxMonthRateSchema>
export type MonthState = z.infer<typeof MonthStateSchema>
export type TableName = z.infer<typeof TableNameSchema>
export type StoreEvent = z.infer<typeof EventSchema>
export type Meta = z.infer<typeof MetaSchema>
export type SyncState = z.infer<typeof SyncStateSchema>
export type Tables = z.infer<typeof TablesSchema>
export type ExportFile = z.infer<typeof ExportFileSchema>

/** Map table name → record type. */
export type TableRecord = {
  household: Household
  entities: Entity
  accounts: Account
  accountMonths: AccountMonth
  categories: Category
  rows: Row
  cells: Cell
  recurringItems: RecurringItem
  pools: Pool
  fxRates: FxRate
  monthStates: MonthState
  goals: Goal
}

export const TABLE_SCHEMAS = {
  household: HouseholdSchema,
  entities: EntitySchema,
  accounts: AccountSchema,
  accountMonths: AccountMonthSchema,
  categories: CategorySchema,
  rows: RowSchema,
  cells: CellSchema,
  recurringItems: RecurringItemSchema,
  pools: PoolSchema,
  fxRates: FxRateSchema,
  monthStates: MonthStateSchema,
  goals: GoalSchema,
} as const

export const EMPTY_TABLES: Tables = {
  household: [], entities: [], accounts: [], accountMonths: [], categories: [], rows: [],
  cells: [], recurringItems: [], pools: [], fxRates: [], monthStates: [], goals: [],
}
