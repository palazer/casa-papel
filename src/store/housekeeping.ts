import { computeEngine } from '@/engine'
import { MonthStateSchema, addMonths, compareMonths, isDue, monthOfDate, monthRange, type Household, type MonthKey, type MonthState, type Tables } from '@/model'
import { countDoneMutations, loadTables } from './actions'
import { cellPut } from './cells'
import { applyMutations } from './impact'
import { defaultMonths } from './months'
import { managedItem, planRecurringPosts, scheduleLive } from './recurring'
import type { Mutation, Store } from './store'

/**
 * A month that an older version of the app had closed becomes an ordinary month that is over, with everything in it
 * ticked: that is what "closed" showed. Three things are written, stamped with the time the month was closed and
 * not with now, so that a device which updates late does not overrule what was corrected elsewhere since:
 *
 * - the tick on every line of the month (`countDoneMutations`); no amount changes;
 * - where a schedule would land in the month and has no item there (the month was closed with one typed figure, or
 *   the schedule came later), a note that the occurrence is left out. The month keeps its amount for good that way:
 *   nothing that looks at the row later finds a schedule to add;
 * - the month's record without the mark. Its cash buffer stays.
 */
function planOpenClosedMonths(tables: Tables, household: Household, closed: MonthState[]): Mutation[] {
  const months = closed.map((s) => s.month).sort()
  const first = compareMonths(household.startMonth, months[0]) < 0 ? household.startMonth : months[0]
  const engine = computeEngine({ tables, months: monthRange(first, addMonths(months[months.length - 1], 1)) })
  const out: Mutation[] = []
  for (const state of closed) {
    const ts = state.closedAt ?? state.updatedAt
    const ticks = countDoneMutations(tables, engine, state.month, ts)
    const after = applyMutations(tables, ticks)
    out.push(...ticks)
    for (const row of tables.rows) {
      if (row.deletedAt) continue
      const due = tables.recurringItems.filter((r) => r.rowId === row.id && scheduleLive(tables, r, state.month) && isDue(r, state.month))
      if (due.length === 0) continue
      const cell = after.cells.find((c) => c.rowId === row.id && c.month === state.month)
      const missing = due.filter((d) => !(cell?.items ?? []).some((i) => i.recurringItemId === d.id))
      if (missing.length === 0) continue
      const items = [...(cell?.mode === 'items' ? cell.items : []), ...missing.map((d) => ({ ...managedItem(d, row), skipped: true }))]
      out.push(cellPut(cell, { rowId: row.id, month: state.month, mode: 'items', value: null, items }, ts))
    }
    out.push({ op: 'put', table: 'monthStates', record: MonthStateSchema.parse({ ...state, closed: false, closedAt: null, updatedAt: ts }) })
  }
  return out
}

/**
 * The last month that holds anything of a schedule: an item one posted, or the note that an occurrence was left out.
 * Every month up to it has been in front of the schedules once. Null when no schedule ever landed.
 */
function lastReached(tables: Tables): MonthKey | null {
  let last: MonthKey | null = null
  for (const c of tables.cells) if ((last == null || c.month > last) && c.items.some((i) => i.recurringItemId)) last = c.month
  return last
}

/**
 * What the app does by itself whenever it has the data in front of it:
 *
 * - the schedules land in the current month and in the months after it. A month that is over is left alone: the app
 *   never changes the past by itself, and whatever reaches further back is somebody's own step, saved with its months.
 *   One kind of month that is over is still filled: a month the schedules never reached (`lastReached`), because
 *   the app was not opened from before the plan grew to it until after it ended. Nobody has seen such a month, so
 *   there is nothing in it to keep, and without its schedules it would show a rent that stops and starts again;
 * - a month that an older version had closed is opened (`planOpenClosedMonths`). That happens once per month, and
 *   again whenever such a month arrives: from another device, or from a file.
 *
 * Pure, and idempotent: a second run on its own result writes nothing.
 */
export function planHousekeeping(tables: Tables, today: MonthKey = monthOfDate()): Mutation[] {
  const household = tables.household.find((h) => !h.deletedAt)
  if (!household) return []
  const closed = tables.monthStates.filter((s) => s.closed)
  const opened = closed.length ? planOpenClosedMonths(tables, household, closed) : []
  const work = opened.length ? applyMutations(tables, opened) : tables
  const reached = lastReached(work)
  const months = defaultMonths(household, work, today).filter((m) => compareMonths(m, today) >= 0 || (reached != null && compareMonths(m, reached) > 0))
  return [...opened, ...planRecurringPosts(work, months)]
}

/** `planHousekeeping` as a system commit (not undoable). Returns how many records it wrote. */
export async function keepHouse(store: Store, today: MonthKey = monthOfDate()): Promise<number> {
  const mutations = planHousekeeping(await loadTables(store), today)
  if (mutations.length) await store.commitSystem(mutations)
  return mutations.length
}
