import { z } from 'zod'
import { ID_PATTERN } from './ids'
import { MONTH_PATTERN } from './month'
import { FUNDED_BY_PATTERN, type FundedBy } from './fundedBy'

// The built page's content security policy (vite.config.ts) forbids `new Function`. Zod would only try it once and
// fall back, but the browser logs the attempt as a violation; this skips the attempt and gives every build one code path.
z.config({ jitless: true })

/** Bump when the shape of stored data changes; add a migration in migrations.ts. */
export const SCHEMA_VERSION = 22

// ---------- primitives ----------
export const IdSchema = z.string().regex(ID_PATTERN, 'expected ULID')
export const MonthKeySchema = z.string().regex(MONTH_PATTERN, 'expected YYYY-MM')
export const CurrencyCodeSchema = z.string().regex(/^[A-Z]{3}$/, 'expected ISO 4217 code')
export const MoneySchema = z.number().int()
export const TimestampSchema = z.number().int().nonnegative() // epoch ms
export const FractionSchema = z.number() // 0..1 share, or a rate
export const IsoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
export const FundedBySchema = z.string().regex(FUNDED_BY_PATTERN) as unknown as z.ZodType<FundedBy>
export const ItemStatusSchema = z.enum(['projected', 'committed', 'done'])
export const DefaultStatusSchema = z.enum(['projected', 'committed'])
export const SectionSchema = z.enum(['income', 'expense', 'transfer'])
/** The day of the month an amount goes out on ("Paid on"). A day the month does not have is its last day. */
export const PayDaySchema = z.number().int().min(1).max(31)

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
  /**
   * The pocket money total households had before pocket rows got rules. Nothing sets it any more; the engine reads it
   * only for a pocket row that is still a share of it (`pocketMode` 'share-of-pocket-total' and no rule).
   */
  pocketTotal: MoneySchema.default(0),
  /** Cash deliberately left in checking at month end. Default 0. */
  cashBuffer: MoneySchema.default(0),
  /**
   * The proportional split (each adult's share of the shared costs, "Who pays what") was removed on the `statement`
   * branch in November 2026. These three, `Row.inShareBasis` and `Entity.paidBy` stay in stored data and are no longer read.
   */
  moneyMode: MoneyModeSchema.default('pooled'),
  shareBasis: ShareBasisSchema.default('basis-rows'),
  manualShares: z.record(IdSchema, FractionSchema).default({}),
  displayExpensesNegative: z.boolean().default(true),
  /**
   * Older versions: one change per month for every currency's months to come. Not read any more (rule X12); where
   * one is set, `planHousekeeping` copies it to each currency's own change (`fxPairDrift`) and empties it.
   */
  fxDriftDefault: z.number().default(0),
  /**
   * Older versions: which day's ECB rate stood for a month (the first business day by default). Not read any more:
   * a month uses its last working day's rate once it is over and the latest one while it runs (rule X11). A month
   * still stored with another day is fetched again, which the app reads from the rate's own record (`rateSettled`).
   */
  fxMonthRate: FxMonthRateSchema.default('first'),
  /** Older versions: how months to come were worked out for every currency. Not read any more (rule X12). */
  fxDriftMode: z.enum(['fixed', 'average']).default('fixed'),
  /**
   * A currency pair's own change per month for the months to come, as a fraction: { 'EUR/TRY': 0.015 }. 0 holds the
   * last rate. A pair without an entry follows its trend, fading out (rule X12).
   */
  fxPairDrift: z.record(z.string(), z.number()).default({}),
  /** "Add <year>": the plan reaches at least this December. null = the calendar rule alone decides (see store/months.ts). */
  planUntil: MonthKeySchema.nullable().default(null),
  /** The Statement shows its setup strip: true from the first screen until "Done". Households made before it have none. */
  setupOpen: z.boolean().default(false),
  /** Suggestions the household said no to (`<entity id or "household">:<template key>`); they sit behind "More suggestions". */
  dismissedSuggestions: z.array(z.string()).default([]),
  /**
   * Rule B9 (one main account): unset in data from before it, which the app puts right when it opens it
   * (`planMainAccount`); true while the household is to be asked which of its current accounts is the main account;
   * false once that is settled. A household made since is made with false. Read it with `== null`, never `=== undefined`.
   */
  askMainAccount: z.boolean().optional(),
  /**
   * "Plan payments by day and method": the Payments page, the list of payment methods and the fields "Paid on" and
   * "Paid with" exist while this is on. Off or unset, they are hidden and nothing is lost: what was set stays. None
   * of it reaches a figure, on or off (rule W1). Read it by truthiness.
   */
  payments: z.boolean().optional(),
})

// ---------- entities ----------
export const EntityKindSchema = z.enum(['adult', 'child', 'pet', 'vehicle', 'property', 'company', 'other'])

export const EntitySchema = BaseRecord.extend({
  kind: EntityKindSchema,
  name: z.string().min(1),
  attributes: z.record(z.string(), z.string()).default({}),
  /** No longer read (see `Household.moneyMode`): the adult who was charged for this entity's rows in the proportional split. */
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
  /**
   * The growth from a month on, where it changed without changing the months before (rule T4: "Only from <Month> on").
   * Before the first change `annualRate` counts. Absent on accounts that never had one; read with `?? []`.
   */
  rateChanges: z.array(z.object({ from: MonthKeySchema, annualRate: z.number() })).optional(),
})

/**
 * What archiving something changed besides the thing itself. It is kept on the archived record, so that restoring
 * can put those things back on any device and however long ago the archive was: the history of changes does not
 * travel between devices and is cleared after a year. Ids and earlier values only, never copies of records. Restoring
 * puts a thing back only where it still shows what archiving left, so whatever was changed in between stays.
 */
export const ArchiveMemoSchema = z.object({
  /** The month the thing was archived from: what the entries below were changed for. */
  month: MonthKeySchema,
  /** A row's schedules that archiving ended (`endMonth` is what they had before) or removed (they started later). */
  schedules: z.array(z.object({ id: IdSchema, endMonth: MonthKeySchema.nullable(), removed: z.boolean() })).default([]),
  /** Rows that followed the row and were set free. */
  followers: z.array(IdSchema).default([]),
  /** What was archived with it: a virtual account's "To …" row, an account's virtual accounts. `was` is the archive month each had before, if any. */
  with: z.array(z.object({ table: z.enum(['rows', 'pools']), id: IdSchema, was: MonthKeySchema.nullable() })).default([]),
  /** What came out of it (`was`) and was moved to `to`: the rows by their default, the schedules, and single items of months. */
  sources: z.array(z.object({
    was: FundedBySchema, to: FundedBySchema,
    rows: z.array(IdSchema).default([]),
    schedules: z.array(IdSchema).default([]),
    items: z.array(z.object({ rowId: IdSchema, month: MonthKeySchema, id: IdSchema })).default([]),
  })).default([]),
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
  /**
   * Left out of net worth: money that is a person's own, like saved pocket money. The account keeps its balance and
   * can pay into the month, but no sum of what the household has counts it. Read it through `isOutsideNetWorth`:
   * it only means something on an account that holds money.
   */
  outsideNetWorth: z.boolean().default(false),
  investment: InvestmentSettingsSchema.optional(),
  card: CardSettingsSchema.optional(),
  archivedMonth: MonthKeySchema.nullable().default(null),
  /** While archived: what the archive changed with it. A record archived before schema 14 has none. */
  archiveMemo: ArchiveMemoSchema.nullable().default(null),
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

// ---------- payment methods ----------
/**
 * How a payment goes: collected or sent by itself (a direct debit, a standing order), made by hand (a transfer,
 * cash), or made when something is bought (a card, a wallet). `model/payments.ts` says which kind asks what.
 */
export const PaymentKindSchema = z.enum(['direct-debit', 'standing-order', 'transfer', 'debit-card', 'credit-card', 'wallet', 'cash', 'other'])

/**
 * A way of paying ("Paid with"): the household's own list. A method is a label: how an amount is paid, and by whom.
 * It is tied to no account and reaches no figure (rule W1); whose money pays for an amount stays "Comes out of", and
 * what is bought on a card stays "Paid by card…" on the row. A method that amounts were paid with is archived, never
 * deleted, so they keep its name.
 */
export const PaymentMethodSchema = BaseRecord.extend({
  name: z.string().min(1),
  kind: PaymentKindSchema,
  /** Who pays with it; null = the household. */
  ownerEntityId: IdSchema.nullable().default(null),
  /**
   * A few words of one's own after the name: "main account", "Bills pot". Read it through `methodNote`: a method
   * from schema 21 has none, and shows the name of the account it was tied to then.
   */
  note: z.string().nullable().optional(),
  /** Schema 21 only: the account a method was tied to. No figure reads it; it is cleared when the method is edited. */
  accountId: IdSchema.nullable().optional(),
  /** No longer offered; what uses it keeps it. */
  archived: z.boolean().default(false),
  order: z.string().default('a0'),
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
  // Money taken out of a savings account into the month by hand: to fill a gap, or to top up a virtual account. The
  // counterpart of 'from-investment'; both count as money in and lower the account they come from.
  'from-savings',
])

/**
 * How the transfer that feeds a savings account, an investment account or a virtual account, or an adult's pocket money,
 * is worked out each month: a typed amount that carries forward, a share of the month's take-home income, a share of
 * what the month has left, or the rest of the month (one row, never pocket money). Pocket money can also be a share
 * of its adult's own take-home income, and any of them a share of one income row (`Row.ruleRowId` says which).
 * `model/rules.ts` reads it for the engine, the store and the screens.
 */
export const RowRuleSchema = z.enum(['fixed', 'share-of-income', 'share-of-own-income', 'share-of-row', 'share-of-rest', 'rest'])

export const RowSchema = BaseRecord.extend({
  name: z.string().min(1),
  section: SectionSchema,
  kind: RowKindSchema.default('plain'),
  categoryId: IdSchema.nullable().default(null),
  entityTags: z.array(IdSchema).default([]),
  /** 'shared' or an entity id: who this row belongs to ("Belongs to…"). */
  scope: z.string().default('shared'),
  /** No longer read (see `Household.moneyMode`). */
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
  /** With the rule 'share-of-row': the income row the share is taken of. */
  ruleRowId: IdSchema.nullable().default(null),
  /** The suggestion that made this row (`RowTemplate.key`); with the row's person or thing it keeps the Statement from suggesting it again. */
  templateKey: z.string().nullable().default(null),
  /**
   * "Usually paid…": the day of the month the row's amount goes out on, and the method it is paid with, in every
   * month where an item says nothing of its own. Rows from before schema 21 have neither: read both with `?? null`.
   * Neither reaches a figure: the row's card stays `accountId` ("Paid by card…").
   */
  payDay: PayDaySchema.nullable().optional(),
  payMethodId: IdSchema.nullable().optional(),
  archivedMonth: MonthKeySchema.nullable().default(null),
  /** While archived: what the archive changed with it. A record archived before schema 14 has none. */
  archiveMemo: ArchiveMemoSchema.nullable().default(null),
  order: z.string().default('a0'),
})

// ---------- cells ----------
/**
 * What a transaction in another currency really came to (rule X10): the amount in the other currency, the amount in
 * the household's, and the rate between them, written the way a month's rate is (how many of the other currency one
 * unit of the household's buys). The user records it; a month's rate does not touch it. The two amounts are kept as
 * they were recorded: a rate worked out from them seldom gives the same cents back. See `src/model/conversion.ts`.
 */
export const ConversionSchema = z.object({
  /** The other currency: the amount's own where the row is in another currency, else that of the account it moves. */
  foreign: CurrencyCodeSchema,
  foreignAmount: MoneySchema,
  homeAmount: MoneySchema,
  rate: z.number().positive(),
  /** The day whose official rate was taken, where one was; null for a rate that was typed or follows from the two amounts. */
  date: IsoDateSchema.nullable().default(null),
})

export const CellItemSchema = z.object({
  id: IdSchema,
  label: z.string().default(''),
  amount: MoneySchema,
  status: ItemStatusSchema.default('projected'),
  fundedBy: FundedBySchema.default('cash'),
  /** "Paid on": the day this item goes out, in its month. null = the row's usual day. */
  date: IsoDateSchema.nullable().default(null),
  /** "Paid with": this item's own payment method. Absent or null = the row's usual one. Read it with `?? null`. */
  methodId: IdSchema.nullable().optional(),
  note: z.string().nullable().default(null),
  recurringItemId: IdSchema.nullable().default(null),
  /** 'carry' contributes the previous month's effective value. */
  kind: z.enum(['normal', 'carry']).default('normal'),
  skipped: z.boolean().default(false),
  /** Amount/label/funding set by hand for this month; the recurring schedule leaves it alone. */
  pinned: z.boolean().optional(),
  /**
   * The conversion that was recorded for this item (rule X10). It counts while the item is done; an item that is
   * not, or a record from before schema 18, has none in force. Read it with `?? null`.
   */
  conversion: ConversionSchema.optional(),
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
  /**
   * The month's own amount is this month's alone (an exception): the months after it go on with what the month
   * before handed to it. Only said of a month with an amount of its own (`value` or `items`). A record from before
   * schema 16 lacks it: read it by truthiness.
   */
  once: z.boolean().default(false),
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
  /**
   * The day of the month it goes out on and the method it is paid with: what the item it posts carries (`CellItem.date`,
   * `CellItem.methodId`). Schedules from before schema 21 have neither: read both with `?? null`.
   */
  payDay: PayDaySchema.nullable().optional(),
  methodId: IdSchema.nullable().optional(),
})

// ---------- pools, fx, months ----------
export const PoolSchema = BaseRecord.extend({
  name: z.string().min(1),
  /** Savings account that holds this virtual account. */
  accountId: IdSchema,
  allocationRowId: IdSchema.nullable().default(null),
  openingBalance: MoneySchema.default(0),
  archivedMonth: MonthKeySchema.nullable().default(null),
  /** While archived: what the archive changed with it. A record archived before schema 14 has none. */
  archiveMemo: ArchiveMemoSchema.nullable().default(null),
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

/**
 * What a month keeps for itself: its cash buffer, and the pocket total of the old pocket share. `closed` and
 * `closedAt` are what versions before schema 15 wrote when a month was closed; nothing closes a month any more, and
 * the app clears the mark where it meets it (`planHousekeeping`).
 */
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

/** A finish line: fill an account or virtual account to an amount, pay a debt down to one, or reach a net worth. */
export const GoalSchema = BaseRecord.extend({
  name: z.string().min(1),
  kind: GoalKindSchema,
  /** account-balance and pay-off: the account watched. */
  accountId: IdSchema.nullable().default(null),
  /** pool-balance: the virtual account watched. */
  poolId: IdSchema.nullable().default(null),
  /** Minor units in the account's currency (account kinds) or the base currency (pool, net worth). Pay-off: what the debt comes down to, 0 to clear it. */
  target: MoneySchema.default(0),
  /** Month the goal was set; pay-off progress counts down from what was owed then. */
  startMonth: MonthKeySchema,
  targetMonth: MonthKeySchema.nullable().default(null),
  notes: z.string().default(''),
  order: z.string().default('a0'),
})

export const TableNameSchema = z.enum([
  'household', 'entities', 'accounts', 'accountMonths', 'categories', 'rows',
  'cells', 'recurringItems', 'pools', 'fxRates', 'monthStates', 'goals', 'paymentMethods',
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
  paymentMethods: z.array(PaymentMethodSchema).default([]),
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
export type InvestmentSettings = z.infer<typeof InvestmentSettingsSchema>
export type ArchiveMemo = z.infer<typeof ArchiveMemoSchema>
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
export type Conversion = z.infer<typeof ConversionSchema>
export type ItemStatus = z.infer<typeof ItemStatusSchema>
export type RecurringItem = z.infer<typeof RecurringItemSchema>
export type Cadence = z.infer<typeof CadenceSchema>
export type Pool = z.infer<typeof PoolSchema>
export type FxRate = z.infer<typeof FxRateSchema>
export type Goal = z.infer<typeof GoalSchema>
export type GoalKind = z.infer<typeof GoalKindSchema>
export type PaymentMethod = z.infer<typeof PaymentMethodSchema>
export type PaymentKind = z.infer<typeof PaymentKindSchema>
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
  paymentMethods: PaymentMethod
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
  paymentMethods: PaymentMethodSchema,
} as const

export const EMPTY_TABLES: Tables = {
  household: [], entities: [], accounts: [], accountMonths: [], categories: [], rows: [],
  cells: [], recurringItems: [], pools: [], fxRates: [], monthStates: [], goals: [], paymentMethods: [],
}
