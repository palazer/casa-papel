import type { EngineOutput } from '@/engine'
import {
  CellSchema, RecurringItemSchema, cadenceOf, compareMonths, isDue, newId, repeatOf, sameRepeat,
  type CellItem, type Money, type MonthKey, type RecurringItem, type RepeatChoice, type Repeating, type Tables,
} from '@/model'
import { engineUpTo, freezeNext, rowChangePut, type EditScope, type RowChange } from './actions'
import { applyMutations } from './impact'
import { defaultMonths } from './months'
import { managedItem, pinCarriedMonths, planChangeRecurringFrom, planRecurringPosts } from './recurring'
import type { Mutation, Store } from './store'

/** What a row's dialog saves for one month: the month's items, and how each of them repeats from here on. */
export interface RowMonthSave {
  /** The month's items as they were edited: the plain ones, and the scheduled ones that land in it. */
  items: CellItem[]
  /** How an item repeats, where that was set or changed, by item id. Left out, an item keeps what it has. */
  repeats?: Record<string, RepeatChoice>
  /** For a scheduled item whose amount or source was edited and whose rhythm was not: this month alone, or from here on. */
  applyTo?: Record<string, EditScope>
  /** The row's schedules that do not land this month, where one was changed, by schedule id: from this month on. */
  others?: Record<string, { amount?: Money; repeat?: Repeating }>
  /** While nothing in the row repeats by itself: what later months do with the total. */
  scope: EditScope
  /** What the dialog changed on the row itself, for every month of it: its currency, its category. */
  row?: RowChange
}

const isCellPut = (m: Mutation, rowId: string, month: MonthKey) =>
  m.op === 'put' && m.table === 'cells' && m.record.rowId === rowId && m.record.month === month

/**
 * The mutations behind `saveRowMonth`. An item set to repeat becomes a schedule that starts this month, and the item
 * is linked to it, so the poster does not add it a second time; one that does not land this month leaves it. A
 * schedule whose rhythm or amount changed is changed from this month on (`planChangeRecurringFrom`), so earlier
 * months keep what they show; "only this month" on a scheduled item ends its schedule after this month. A row that
 * gets its first schedule here keeps the amounts its earlier months carried (`pinCarriedMonths`).
 */
export function planRowMonthSave(tables: Tables, engine: EngineOutput, rowId: string, month: MonthKey, save: RowMonthSave, ts: number): Mutation[] {
  const row = tables.rows.find((r) => r.id === rowId && !r.deletedAt)
  if (!row) throw new Error('That row is gone.')
  if (tables.monthStates.find((s) => s.month === month)?.closed) throw new Error(`${month} is closed. Reopen it to edit.`)
  const existing = tables.cells.find((c) => c.rowId === rowId && c.month === month)
  const before = new Map((existing?.items ?? []).map((i) => [i.id, i]))
  const muts: Mutation[] = []
  // each step builds on the ones before it
  let t = tables
  const push = (ms: Mutation[]) => {
    muts.push(...ms)
    t = applyMutations(t, ms)
  }
  const putSchedule = (record: RecurringItem): Mutation => ({ op: 'put', table: 'recurringItems', record })
  const scheduleOf = (id: string) => t.recurringItems.find((r) => r.id === id && !r.deletedAt && r.rowId === rowId)

  const items: CellItem[] = []
  for (const it of save.items) {
    const choice = save.repeats?.[it.id]
    if (it.kind !== 'normal' || it.skipped) {
      items.push(it)
      continue
    }
    const schedule = it.recurringItemId ? scheduleOf(it.recurringItemId) : undefined
    if (!schedule) {
      if (it.recurringItemId || !choice || choice.kind === 'none') {
        items.push(it)
        continue
      }
      // the row's first schedule takes its carry-forward away in every month: the earlier ones keep their amount first
      push(pinCarriedMonths(t, rowId, month, ts))
      const made = RecurringItemSchema.parse({ id: newId(), createdAt: ts, updatedAt: ts, name: it.label.trim() || row.name, rowId, amount: it.amount, fundedBy: it.fundedBy, ...cadenceOf(choice), startMonth: month })
      push([putSchedule(made)])
      if (isDue(made, month)) items.push({ ...it, label: made.name, recurringItemId: made.id })
      continue
    }
    const was = before.get(it.id)
    const edited = !!was && (was.amount !== it.amount || was.fundedBy !== it.fundedBy)
    // a schedule that ends with this month does not repeat any more, whatever its rhythm was
    const ended = !!schedule.endMonth && compareMonths(schedule.endMonth, month) <= 0
    if (choice && !sameRepeat(choice, ended ? { kind: 'none' } : repeatOf(schedule))) {
      if (choice.kind === 'none') {
        // no more after this month; this month's stays as it is
        push([putSchedule(RecurringItemSchema.parse({ ...schedule, endMonth: month, updatedAt: ts }))])
        items.push(edited ? { ...it, pinned: true } : it)
      } else {
        // one that had ended runs again from here, without an end
        const { mutations, targetId } = planChangeRecurringFrom(t, schedule, month, { ...cadenceOf(choice), amount: it.amount, fundedBy: it.fundedBy, ...(ended ? { endMonth: null } : {}) }, ts)
        push(mutations)
        const now = scheduleOf(targetId)
        // what is done stays where it was done, whatever the new rhythm says
        if ((now && isDue(now, month)) || it.status === 'done') items.push({ ...it, recurringItemId: targetId, pinned: false })
      }
    } else if (edited && (save.applyTo?.[it.id] ?? 'this-month') === 'from-now-on') {
      const { mutations, targetId } = planChangeRecurringFrom(t, schedule, month, { amount: it.amount, fundedBy: it.fundedBy }, ts)
      push(mutations)
      items.push({ ...it, recurringItemId: targetId, pinned: false })
    } else {
      items.push(edited ? { ...it, pinned: true } : it)
    }
  }

  for (const [id, change] of Object.entries(save.others ?? {})) {
    const schedule = scheduleOf(id)
    if (!schedule) continue
    const patch = {
      ...(change.repeat && !sameRepeat(change.repeat, repeatOf(schedule)) ? cadenceOf(change.repeat) : {}),
      ...(change.amount != null && change.amount !== schedule.amount ? { amount: change.amount } : {}),
    }
    if (Object.keys(patch).length === 0) continue
    const { mutations, targetId } = planChangeRecurringFrom(t, schedule, month, patch, ts)
    push(mutations)
    const now = scheduleOf(targetId)
    // a new rhythm may land in this very month: it is there at once
    if (now && isDue(now, month) && !items.some((i) => i.recurringItemId === targetId)) items.push(managedItem(now, row))
  }

  // the month's list is written once, here: whatever the steps above put into this cell is dropped
  const out = muts.filter((m) => !isCellPut(m, rowId, month))
  const scheduled = t.recurringItems.some((r) => !r.deletedAt && r.rowId === rowId)
  if (!scheduled && save.scope === 'this-month') out.push(...freezeNext(tables, engine, rowId, month))
  const cell = { rowId, month, value: null, note: existing?.note ?? null, currencyOverride: existing?.currencyOverride ?? null, markedDone: existing?.markedDone ?? false, updatedAt: ts }
  if (items.length > 0 || !scheduled) out.push({ op: 'put', table: 'cells', record: CellSchema.parse({ ...cell, mode: 'items', items }) })
  // a row on a schedule with nothing in the month has no cell of its own there
  else if (existing && existing.mode !== 'inherit') out.push({ op: 'put', table: 'cells', record: CellSchema.parse({ ...cell, mode: 'inherit', items: [] }) })
  out.push(...rowChangePut(tables, rowId, save.row))
  return out
}

/**
 * Save a row's month from its dialog: its items, and how each repeats. One step, one undo: what the schedules then
 * land in the row's other open months is part of it.
 */
export async function saveRowMonth(store: Store, rowId: string, month: MonthKey, save: RowMonthSave): Promise<void> {
  const { tables, engine, household } = await engineUpTo(store, month)
  const muts = planRowMonthSave(tables, engine, rowId, month, save, Date.now())
  const after = applyMutations(tables, muts)
  muts.push(...planRecurringPosts(after, defaultMonths(household, after)).filter((m) => m.op === 'put' && m.table === 'cells' && m.record.rowId === rowId))
  // a save that changes nothing leaves no step to undo
  if (muts.length) await store.commit(muts)
}
