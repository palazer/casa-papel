import { txt } from '@/i18n'
import { computeEngine } from '@/engine'
import { compareMonths, monthRange, type ExportFile, type MonthKey, type TableName, type TableRecord, type Tables } from '@/model'
import { loadTables } from './actions'
import { canonical, previewMerge } from './exportImport'
import { primaryKeyOf } from './keys'
import { defaultMonths } from './months'
import { applyMutations } from './impact'
import { planCards } from './cards'
import { planMainAccount } from './mainAccount'
import { changesBetween, type Changes } from './past'
import type { Store } from './store'

/** What one way of bringing a file in would change on this device. */
export interface FileChoice {
  /** The amounts and balances that change, over every month of the plan; null: none. */
  changes: Changes | null
  /** How many records change that hold no amount themselves: names, settings, notes, schedules. */
  other: number
}

/** A file picked to bring in, before anything is changed (rule T4, finding F9): what each way of bringing it in would do here. */
export interface FileCheck {
  /** "Merge into this device": what is newer in the file. */
  merge: FileChoice
  /** "Replace everything here": the file as it is. */
  replace: FileChoice
  /** The last month of the plan: a run of an amount that reaches it reads "from <Month>". */
  planEnd: MonthKey
  locale: string
}

/** The tables that hold amounts of a month; the others are counted as records without an amount. */
const AMOUNTS = new Set<TableName>(['cells', 'accountMonths', 'fxRates'])

/** How many records without an amount differ between two states (added, removed or changed; the time stamp aside). */
function otherChanges(before: Tables, after: Tables): number {
  let n = 0
  for (const t of Object.keys(before) as TableName[]) {
    if (AMOUNTS.has(t)) continue
    const said = (records: Tables[TableName]) => new Map((records as Array<TableRecord[TableName]>).map((r) => {
      const { updatedAt: _stamp, ...rest } = r as TableRecord[TableName] & { updatedAt: number }
      void _stamp
      return [JSON.stringify(primaryKeyOf(t, r)), canonical(rest)]
    }))
    const a = said(before[t])
    const b = said(after[t] ?? [])
    for (const key of new Set([...a.keys(), ...b.keys()])) if (a.get(key) !== b.get(key)) n += 1
  }
  return n
}

/** Every month either plan covers. */
function planMonths(before: Tables, after: Tables): MonthKey[] {
  const ranges = [before, after].flatMap((t) => {
    const h = t.household.find((x) => !x.deletedAt)
    return h ? [defaultMonths(h, t)] : []
  }).filter((r) => r.length > 0)
  if (ranges.length === 0) return []
  const first = ranges.map((r) => r[0]).sort(compareMonths)[0]
  const last = ranges.map((r) => r[r.length - 1]).sort(compareMonths).at(-1)!
  return monthRange(first, last)
}

/**
 * What merging `file` and what replacing everything with it would change on this device, before either is done. The
 * merge is worked out with the merge's own rules (`previewMerge`); nothing is written.
 */
export async function checkFile(store: Store, file: ExportFile): Promise<FileCheck> {
  const here = await loadTables(store)
  // read as the app leaves it once it has it: a household from before rule B9 is put right (`planMainAccount`), and
  // so are its cards from before schema 23 (`planCards`)
  const settled = (t: Tables) => {
    const main = applyMutations(t, planMainAccount(t))
    return applyMutations(main, planCards(main))
  }
  const merged = settled(await previewMerge(store, file))
  const replaced = settled(file.tables)
  const household = here.household.find((h) => !h.deletedAt) ?? replaced.household.find((h) => !h.deletedAt)
  const home = household?.baseCurrency ?? 'EUR'
  const choice = (after: Tables): FileChoice => {
    const months = planMonths(here, after)
    const before = { tables: here, engine: computeEngine({ tables: here, months }) }
    return { changes: months.length ? changesBetween(before, { tables: after, engine: computeEngine({ tables: after, months }) }, months, home) : null, other: otherChanges(here, after) }
  }
  const months = planMonths(here, replaced)
  return { merge: choice(merged), replace: choice(replaced), planEnd: months[months.length - 1] ?? '', locale: household?.locale ?? 'en' }
}

/** "and 4 other changes: names, settings, notes or schedules", for the records a list of amounts does not show. */
export function otherText(n: number): string | null {
  if (n === 0) return null
  return txt.store.otherChanges(n)
}
