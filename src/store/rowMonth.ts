import { txt } from '@/i18n'
import { cellKey, type EngineOutput } from '@/engine'
import {
  RecurringItemSchema, cadenceOf, compareMonths, dayOfDate, isDue, monthOfDate, newId, repeatOf, sameRepeat,
  type CellItem, type Money, type MonthKey, type RecurringItem, type RepeatChoice, type Repeating, type Tables,
} from '@/model'
import { carriesForward, engineUpTo, itemsAmount, planFollowing, rowChangePut, rowInNewCurrency, standingMoves, withoutRewritten, type EditScope, type RowChange } from './actions'
import { cellPut } from './cells'
import { refuseThirdCurrency } from './currencies'
import { applyMutations } from './impact'
import { defaultMonths } from './months'
import { withUsualPayment } from './paymentActions'
import { managedItem, pinCarriedMonths, planChangeRecurringFrom, planRecurringPosts, planRename } from './recurring'
import type { Mutation, Store } from './store'

/** What a row's dialog saves for one month: the month's items, and how each of them repeats from here on. */
export interface RowMonthSave {
  /** The month's items as they were edited: the plain ones, and the scheduled ones that land in it. */
  items: CellItem[]
  /** How an item repeats, where that was set or changed, by item id. Left out, an item keeps what it has. */
  repeats?: Record<string, RepeatChoice>
  /** For a scheduled item whose amount or source was edited and whose rhythm was not: this month alone, or from here on. */
  applyTo?: Record<string, EditScope>
  /** The row's schedules that do not land this month, where one was changed, by schedule id: from this month on (a new name: in every month). */
  others?: Record<string, { amount?: Money; repeat?: Repeating; name?: string }>
  /** While nothing in the row repeats by itself: what later months do with the total. */
  scope: EditScope
  /** What the dialog changed on the row itself, for every month of it: its currency, its category. */
  row?: RowChange
}

/** An item that names no day and no method of its own: it follows its schedule, or the row. */
const FOLLOWS = { date: null, methodId: null } as const

const isCellPut = (m: Mutation, rowId: string, month: MonthKey) =>
  m.op === 'put' && m.table === 'cells' && m.record.rowId === rowId && m.record.month === month

/**
 * The mutations behind `saveRowMonth`. An item set to repeat becomes a schedule that starts this month, and the item
 * is linked to it, so the poster does not add it a second time; one that does not land this month leaves it. A
 * schedule whose rhythm or amount changed is changed from this month on (`planChangeRecurringFrom`), so earlier
 * months keep what they show; "only this month" on a scheduled item ends its schedule after this month. A row that
 * gets its first schedule here keeps the amounts its earlier months carried (`pinCarriedMonths`). A scheduled item
 * whose name was typed over is renamed (`planRename`), in every month. A dialog that also moves the row to a currency
 * counting other decimals is saved against the row's amounts in the new unit (`rowInNewCurrency`).
 *
 * The day and the method of payment (rule W1): an item that becomes a schedule hands it the ones it names, and
 * follows the schedule from then on. A scheduled item whose day or method was changed here keeps them for this
 * month alone, or, with "this and following months" or a new rhythm, hands them to its schedule from this month on.
 */
export function planRowMonthSave(stored: Tables, calculated: EngineOutput, rowId: string, month: MonthKey, save: RowMonthSave, ts: number): Mutation[] {
  const { tables, engine, pre } = rowInNewCurrency(stored, calculated, rowId, save.row, ts)
  const row = tables.rows.find((r) => r.id === rowId && !r.deletedAt)
  if (!row) throw new Error(txt.errors.rowGone)
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
  for (const typed of save.items) {
    let it = typed
    const choice = save.repeats?.[it.id]
    if (it.kind !== 'normal' || it.skipped) {
      items.push(it)
      continue
    }
    let schedule = it.recurringItemId ? scheduleOf(it.recurringItemId) : undefined
    // a scheduled item's name was typed over: the schedule is renamed; an emptied name keeps the one it has
    const name = it.label.trim()
    if (schedule && name !== schedule.name) {
      if (name) {
        push(planRename(t, rowId, schedule.name, name, ts))
        schedule = scheduleOf(schedule.id)
      }
      if (schedule) it = { ...it, label: schedule.name }
    }
    if (!schedule) {
      if (it.recurringItemId || !choice || choice.kind === 'none') {
        items.push(it)
        continue
      }
      // the row's first schedule takes its carry-forward away in every month: the earlier ones keep their amount first
      push(pinCarriedMonths(t, rowId, month, ts))
      const made = RecurringItemSchema.parse({
        id: newId(), createdAt: ts, updatedAt: ts, name: it.label.trim() || row.name, rowId, amount: it.amount, fundedBy: it.fundedBy, ...cadenceOf(choice), startMonth: month,
        payDay: dayOfDate(it.date, month), methodId: it.methodId ?? null,
      })
      push([putSchedule(made)])
      if (isDue(made, month)) items.push({ ...it, label: made.name, recurringItemId: made.id, ...FOLLOWS })
      continue
    }
    const was = before.get(it.id)
    const edited = !!was && (was.amount !== it.amount || was.fundedBy !== it.fundedBy)
    // the day or the method it names for itself was set here: as a change of its schedule, that is the schedule's from this month on
    const paid = !!was && ((was.date ?? null) !== (it.date ?? null) || (was.methodId ?? null) !== (it.methodId ?? null))
    const ownDay = dayOfDate(it.date, month)
    const pay = paid ? { ...(ownDay != null ? { payDay: ownDay } : {}), ...(it.methodId != null ? { methodId: it.methodId } : {}) } : {}
    const handed = paid ? FOLLOWS : {}
    // a schedule that ends with this month does not repeat any more, whatever its rhythm was
    const ended = !!schedule.endMonth && compareMonths(schedule.endMonth, month) <= 0
    if (choice && !sameRepeat(choice, ended ? { kind: 'none' } : repeatOf(schedule))) {
      if (choice.kind === 'none') {
        // no more after this month; this month's stays as it is
        push([putSchedule(RecurringItemSchema.parse({ ...schedule, endMonth: month, updatedAt: ts }))])
        items.push(edited ? { ...it, pinned: true } : it)
      } else {
        // one that had ended runs again from here, without an end
        const { mutations, targetId } = planChangeRecurringFrom(t, schedule, month, { ...cadenceOf(choice), amount: it.amount, fundedBy: it.fundedBy, ...pay, ...(ended ? { endMonth: null } : {}) }, ts)
        push(mutations)
        const now = scheduleOf(targetId)
        // what is done stays where it was done, whatever the new rhythm says
        if ((now && isDue(now, month)) || it.status === 'done') items.push({ ...it, recurringItemId: targetId, pinned: false, ...handed })
      }
    } else if ((edited || paid) && (save.applyTo?.[it.id] ?? 'this-month') === 'from-now-on') {
      const { mutations, targetId } = planChangeRecurringFrom(t, schedule, month, { amount: it.amount, fundedBy: it.fundedBy, ...pay }, ts)
      push(mutations)
      items.push({ ...it, recurringItemId: targetId, pinned: false, ...handed })
    } else {
      items.push(edited ? { ...it, pinned: true } : it)
    }
  }

  for (const [id, change] of Object.entries(save.others ?? {})) {
    let schedule = scheduleOf(id)
    if (!schedule) continue
    const name = change.name?.trim()
    if (name && name !== schedule.name) {
      push(planRename(t, rowId, schedule.name, name, ts))
      schedule = scheduleOf(id)
      if (!schedule) continue
    }
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
  // "Only this month" on a row whose months carry forward: the list is this month's alone
  const once = save.scope === 'this-month' && carriesForward(t, engine, rowId)
  if (once) out.push(...standingMoves(tables, engine, rowId, month, ts))
  // "This and following months": a new total replaces what the later months held
  else if (!scheduled) out.push(...planFollowing(t, engine, rowId, month, itemsAmount(items, engine.cells[cellKey(rowId, month)]?.given), ts).mutations)
  if (items.length > 0 || !scheduled) out.push(cellPut(existing, { rowId, month, mode: 'items', value: null, items, once }, ts))
  // a row on a schedule with nothing in the month has no cell of its own there
  else if (existing && existing.mode !== 'inherit') out.push(cellPut(existing, { rowId, month, mode: 'inherit', value: null, items: [] }, ts))
  out.push(...rowChangePut(stored, rowId, save.row))
  return withUsualPayment(stored, [...withoutRewritten(pre, out), ...out], rowId, save.row?.pay, ts)
}

/**
 * Save a row's month from its dialog: its items, and how each repeats. One step, one undo: what the schedules then
 * land in the row's later months is part of it.
 */
export async function saveRowMonth(store: Store, rowId: string, month: MonthKey, save: RowMonthSave): Promise<void> {
  const { tables, engine, household } = await engineUpTo(store, month)
  const muts = planRowMonthSave(tables, engine, rowId, month, save, Date.now())
  const after = applyMutations(tables, muts)
  // the dialog changes its row from this month on: the months before it keep what they hold. For a month that is
  // still to come, the months from the current one on are landed too: the app's own pass would do it a moment later,
  // as a second step that undo does not reach
  const today = monthOfDate()
  const from = compareMonths(month, today) < 0 ? month : today
  muts.push(...planRecurringPosts(after, defaultMonths(household, after).filter((m) => compareMonths(m, from) >= 0), [rowId]))
  refuseThirdCurrency(tables, muts)
  // a save that changes nothing leaves no step to undo
  if (muts.length) await store.commit(muts)
}
