import { SCHEMA_VERSION } from './schema'

/**
 * Migrate an export file / stored snapshot from an older schema version to the
 * current one. Each step transforms version n → n+1 on the raw (unknown) shape;
 * zod validation runs after migration.
 */
type Step = (raw: unknown) => unknown

const STEPS: Record<number, Step> = {
  // 1 → 2: goals table
  1: (raw) => {
    const obj = raw as { tables?: Record<string, unknown> }
    return { ...obj, tables: { ...(obj.tables ?? {}), goals: obj.tables?.goals ?? [] } }
  },
  // 2 → 3: `Cell.markedDone` (an automatic row ticked as moved) and `Pool.archivedMonth`; both fill in from their defaults
  2: (raw) => raw,
  // 3 → 4: `Household.planUntil` ("Add <year>"), `FxRate.date`, `Row.followShare`, `Row.deductedFromRowId`, and the
  // 'first' month-rate default for new households (a stored 'last' is a choice and stays); everything fills in from its default
  3: (raw) => raw,
  // 4 → 5: the row kind 'category-estimate' (a category's estimate, counted as what its rows have not explained yet).
  // Nothing to rewrite; the version only keeps an older app from reading a row it would count in full.
  4: (raw) => raw,
  // 5 → 6: `Row.rule` and `Row.ruleShare` (a share of income, a share of what is left, or the rest for a chosen
  // savings row). Both fill in from their defaults; the version keeps an older app from typing over a worked-out row.
  5: (raw) => raw,
  // 6 → 7: the row kind 'from-savings' (money taken out of a savings account into the month). Nothing to rewrite; the
  // version keeps an older app from reading such a row as an ordinary transfer out.
  6: (raw) => raw,
  // 7 → 8: `Household.setupOpen` and `Household.dismissedSuggestions` (setting up on the Statement) and
  // `Row.templateKey` (the suggestion a row came from). All fill in from their defaults; the version keeps an older
  // app from dropping them when it writes a record back.
  7: (raw) => raw,
  // 8 → 9: the rule 'share-of-own-income' (pocket money as a share of its adult's own income), and pocket money rows
  // that carry a rule at all. Nothing to rewrite; the version keeps an older app from reading a rule it does not know.
  8: (raw) => raw,
  // 9 → 10: the rule 'share-of-row' (a share of one income row) and `Row.ruleRowId`, the income it is taken of.
  // Nothing to rewrite; the version keeps an older app from reading a rule it does not know.
  9: (raw) => raw,
  // 10 → 11: an expense can come out of one named account (`account:<id>` beside `cash`, `savings` and `pool:<id>`).
  // Nothing to rewrite: `savings` keeps meaning the first savings account. The version keeps an older app from
  // reading a source it does not know.
  10: (raw) => raw,
  // 11 → 12: an account of type 'cash' has a balance of its own, as another asset, and no longer counts with the
  // current accounts. Nothing to rewrite: its opening amount and its real balances are read as its own. The version
  // keeps an older app from counting it in the main account.
  11: (raw) => raw,
  // 12 → 13: `Account.outsideNetWorth` (an account left out of net worth) and a pocket money row that lands in such
  // an account. Both fill in from their defaults; the version keeps an older app from counting the account.
  12: (raw) => raw,
  // 13 → 14: `archiveMemo` on rows, virtual accounts and accounts (what archiving changed with them, so that restoring
  // can put it back). It fills in from its default; the version keeps an older app from dropping the memo when it
  // writes an archived record back.
  13: (raw) => raw,
  // 14 → 15: closing a month went away. No field changes: `MonthState.closed` and `closedAt` stay for what older
  // versions wrote, and the app turns a closed month into a month with everything ticked when it meets one
  // (`planHousekeeping`). The version keeps an older app, which would lock those months again, from syncing.
  14: (raw) => raw,
  // 15 → 16: `Cell.once` (an amount that is its month's alone: the months after it go on with what came before).
  // It fills in from its default: an exception an older version made keeps the amount that version wrote into the
  // month after. The version keeps an older app, which would count such a month as an amount that runs on, from
  // syncing.
  15: (raw) => raw,
  // 16 → 17: the months to come of a currency follow its trend, fading out (rule X12), where versions up to 16 held
  // the last rate or applied one % to all. No field changes: a pair's own change stays in `fxPairDrift`, and the app
  // copies an old % for all currencies to each pair when it opens the data (`planHousekeeping`). The version keeps an
  // older app, which would show other amounts for every month to come, from syncing.
  16: (raw) => raw,
  // 17 → 18: an item of a month can carry the conversion that was recorded for it (`CellItem.conversion`, rule X10).
  // Optional, so nothing is rewritten. The version keeps an older app from syncing: it would drop the field from
  // every month it writes, and its later write would win.
  17: (raw) => raw,
  // 18 → 19: an investment's growth can change from a month on (`InvestmentSettings.rateChanges`, rule T4). Optional,
  // so nothing is rewritten. The version keeps an older app from syncing: it would count the old rate in every month
  // and drop the field when it writes the account.
  18: (raw) => raw,
  // 19 → 20: one main account (rule B9). An account of type 'checking' is the main account; one of type 'joint' (an
  // other current account) has a balance of its own, as another asset, and no longer counts with it. Nothing to
  // rewrite here: a sync pull reads every older snapshot through these steps. The app puts a household with several
  // current accounts right when it opens the data (`planMainAccount`). The version keeps an older app, which would
  // count an other current account in the main account again, from syncing.
  19: (raw) => raw,
  // 20 → 21: payments by day and method. A new table of payment methods, a household switch, and optional fields: a
  // row's usual day and method, a schedule's, an item's own method (its `date` was there, unused). Nothing to rewrite.
  // The version keeps an older app from syncing: it would drop the fields from what it writes. (Schema 21 also
  // counted an item as bought on a card when its method drew on one; schema 22 took that back.)
  20: (raw) => raw,
  // 21 → 22: a payment method is a label and no longer tied to an account. `PaymentMethod.note` is new and optional;
  // `accountId` stays readable, and a method from schema 21 shows that account's name as its note (`methodNote`)
  // until it is edited. Nothing to rewrite. The version keeps an older app from syncing: it requires an account on
  // every method, and it counts an item paid with a method on a card as bought on that card, where this one counts a
  // card's purchases by the row again (rule C2).
  21: (raw) => raw,
}

export function migrateExport(raw: unknown): unknown {
  const obj = raw as { schemaVersion?: unknown }
  let version = typeof obj?.schemaVersion === 'number' ? obj.schemaVersion : 1
  if (version > SCHEMA_VERSION) {
    throw new Error(`This file was made by a newer Casa Papel (schema ${version}). Update the app to import it.`)
  }
  let data = raw
  while (version < SCHEMA_VERSION) {
    const step = STEPS[version]
    if (!step) throw new Error(`No migration from schema ${version} to ${version + 1}`)
    data = step(data)
    version += 1
    ;(data as { schemaVersion: number }).schemaVersion = version
  }
  return data
}
