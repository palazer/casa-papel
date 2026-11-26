import {
  compareMonths, methodFrom, methodOf, payContext, payDayFrom, payDayOf, paymentKindInfo,
  type CellItem, type Money, type MonthKey, type PayFrom, type PaymentAsk, type PaymentMethod, type Row, type Tables,
} from '@/model'
import { buildStatement, type StatementLine } from './statement'
import { cellKey, type CellStatus, type EngineOutput } from './types'

/**
 * Where a payment stands. One that names neither a day nor a method is untracked: it is listed, and counts in no sum
 * of the page. A tracked one that is ticked is done; one without a day cannot be placed; in the current month one
 * with a day is overdue, due today or still coming, and in any other month it is simply open, listed by its day.
 */
export type PaymentState = 'overdue' | 'today' | 'coming' | 'open' | 'no-day' | 'done' | 'untracked'

/** One amount that leaves in a month: a line of the Statement's "Money out", or one of its items. */
export interface Payment {
  /** The Statement line's id: the row's, or `<row>:<item>`. */
  id: string
  rowId: string
  /** The item it is, where the row's month is a list of items and this is one of them. */
  itemId?: string
  /** The one item behind a row's amount, where the month is a list with a single item. The line is still the row's (`itemId` is unset, and the tick is the month's), but the item can hold a day and a method of its own. */
  soleItemId?: string
  /** The schedule that posted the item (`itemId` or `soleItemId`), while it runs in this month: its day and method can be changed from this month on. */
  scheduleId?: string
  /** What it is called: the item's name, or the row's. */
  label: string
  /** For an item: the row it stands in. */
  rowLabel?: string
  /** In the household's currency. */
  amount: Money
  /** As typed, where the row is kept in another currency. */
  native?: { amount: Money; currency: string }
  /** The day of the month it goes out on; null where nothing says. */
  day: number | null
  /** Which place says the day: the item of this month, its schedule, the row. null with no day. */
  dayFrom: PayFrom | null
  methodId: string | null
  /** Which place names the method; null without one. */
  methodFrom: PayFrom | null
  /** What the method asks of the household; null without a method. */
  ask: PaymentAsk | null
  /** It has a day or a method. Only what is tracked counts in "to pay", "done" and the sums per method and person. */
  tracked: boolean
  /** Who pays: the method's owner; null = the household, and every payment without a method. */
  ownerId: string | null
  status: CellStatus
  done: boolean
  /** Worked out by the app (a share, the rest of the month): it can still move while the month runs. */
  automatic: boolean
  estimate: boolean
  state: PaymentState
}

export interface PaymentMethodTotal {
  /** null: what is tracked by a day alone, with no method named. */
  methodId: string | null
  label: string
  total: Money
  /** Not ticked yet. */
  left: Money
  count: number
}

export interface PaymentPersonTotal {
  /** null: the household. */
  ownerId: string | null
  label: string
  total: Money
  left: Money
  count: number
}

export interface Payments {
  month: MonthKey
  currency: string
  /** Everything that leaves in the month, tracked or not, in the Statement's order. */
  payments: Payment[]
  /** What is tracked and not ticked yet. */
  toPay: Money
  /** What is tracked and ticked. */
  paid: Money
  overdue: number
  /** The tracked payments by method, in the methods' own order; what names no method last. */
  methods: PaymentMethodTotal[]
  /** The tracked payments by who pays, the household first. */
  people: PaymentPersonTotal[]
  /** What names neither a day nor a method: how many amounts, and what they come to. */
  untracked: { count: number; total: Money }
}

export const NO_METHOD = 'No method'

/**
 * A month's payments, read from its Statement (`buildStatement`): every row of "Money out" that has an amount, and
 * the items of a row that lists them. So the list never says something else than the Statement of its month, and a
 * tick on one is a tick on the other.
 *
 * A day and a method are labels (rule W1): nothing here says which account an amount leaves or what is owed on a
 * card. The sums are by method and by who pays with it, over what is tracked.
 *
 * `today` is an ISO date (YYYY-MM-DD): the calculation does not read the clock.
 */
export function buildPayments(tables: Tables, engine: EngineOutput, month: MonthKey, today: string): Payments | null {
  const statement = buildStatement(tables, engine, month)
  const household = tables.household.find((h) => !h.deletedAt)
  if (!statement || !household) return null
  const ctx = payContext(tables)
  const rowsById = new Map(engine.rows.map((r) => [r.id, r]))
  const entities = new Map(tables.entities.filter((e) => !e.deletedAt).map((e) => [e.id, e]))
  const thisMonth = today.slice(0, 7)
  const todayDay = Number(today.slice(8, 10))
  const current = compareMonths(month, thisMonth) === 0

  const stateOf = (tracked: boolean, done: boolean, day: number | null): PaymentState => {
    if (!tracked) return 'untracked'
    if (done) return 'done'
    if (day == null) return 'no-day'
    if (!current) return 'open'
    return day < todayDay ? 'overdue' : day === todayDay ? 'today' : 'coming'
  }
  /** The schedule behind an item, while it is one that can be changed from this month on. */
  const runningSchedule = (item: CellItem | null): string | undefined => {
    const s = item?.recurringItemId ? ctx.schedules.get(item.recurringItemId) : undefined
    if (!s || s.deletedAt || compareMonths(month, s.startMonth) < 0 || (s.endMonth && compareMonths(month, s.endMonth) > 0)) return undefined
    return s.id
  }

  const payments: Payment[] = []
  const add = (row: Row, line: StatementLine, item: CellItem | null, amount: Money, native: Payment['native'], over: Partial<Payment>) => {
    const method: PaymentMethod | null = methodOf(item, row, ctx)
    const day = payDayOf(item, row, month, ctx)
    const done = line.status === 'done'
    const tracked = day != null || method != null
    payments.push({
      id: line.id, rowId: row.id, label: line.label, amount, native,
      day, dayFrom: payDayFrom(item, row, month, ctx),
      methodId: method?.id ?? null, methodFrom: methodFrom(item, row, ctx), ask: method ? paymentKindInfo(method.kind).ask : null,
      tracked, ownerId: method?.ownerEntityId ?? null, scheduleId: runningSchedule(item),
      status: line.status ?? 'projected', done, automatic: !!line.automatic, estimate: !!line.estimate,
      state: stateOf(tracked, done, day), ...over,
    })
  }

  const walk = (lines: StatementLine[]) => {
    for (const line of lines) {
      if (line.kind !== 'row' || !line.rowId) {
        walk(line.children)
        continue
      }
      const row = rowsById.get(line.rowId)
      const c = engine.cells[cellKey(line.rowId, month)]
      if (!row || !c || line.amount === 0) continue
      const live = c.items.filter((i) => !i.skipped)
      const listed = line.children.filter((ch) => ch.kind === 'item' && ch.itemId && !ch.skipped && !ch.resting)
      if (listed.length === 0) {
        // one amount: a typed or carried one, one the app works out, or a month with a single item
        const sole = live.length === 1 ? live[0] : null
        add(row, line, sole, line.amount, line.native, sole && c.source === 'items' ? { soleItemId: sole.id } : {})
        continue
      }
      // a list of items: each is a payment of its own. Their amounts are in the row's currency; in the household's
      // each takes its share of the row's amount, the last one what is left, so they add up to the row's line
      const sum = listed.reduce((s, ch) => s + ch.amount, 0)
      let left = line.amount
      listed.forEach((child, n) => {
        const item = live.find((i) => i.id === child.itemId) ?? null
        const share = n === listed.length - 1 ? left : sum !== 0 ? Math.round(line.amount * (child.amount / sum)) : 0
        left -= share
        if (share === 0 && child.amount === 0) return
        add(row, { ...line, id: child.id, label: child.label, status: child.status, estimate: child.estimate, automatic: false }, item, share,
          line.native ? { amount: child.amount, currency: line.native.currency } : undefined, { itemId: child.itemId, rowLabel: row.name })
      })
    }
  }
  walk(statement.flow.right.lines)

  // ---------- the sums: over what is tracked ----------
  const tracked = payments.filter((p) => p.tracked)
  const loose = payments.filter((p) => !p.tracked)
  const sum = (list: Payment[]) => list.reduce((s, p) => s + p.amount, 0)
  const byOrder = <T extends { order: string }>(a: T, b: T) => (a.order < b.order ? -1 : a.order > b.order ? 1 : 0)
  const rank = (list: string[], id: string | null) => (id == null ? list.length + 1 : list.indexOf(id) === -1 ? list.length : list.indexOf(id))

  const byMethod = new Map<string, PaymentMethodTotal>()
  const byPerson = new Map<string, PaymentPersonTotal>()
  for (const p of tracked) {
    let method = byMethod.get(p.methodId ?? '')
    if (!method) byMethod.set(p.methodId ?? '', (method = { methodId: p.methodId, label: p.methodId ? ctx.methods.get(p.methodId)?.name ?? NO_METHOD : NO_METHOD, total: 0, left: 0, count: 0 }))
    let person = byPerson.get(p.ownerId ?? '')
    if (!person) byPerson.set(p.ownerId ?? '', (person = { ownerId: p.ownerId, label: p.ownerId ? entities.get(p.ownerId)?.name ?? 'Household' : 'Household', total: 0, left: 0, count: 0 }))
    for (const total of [method, person]) {
      total.total += p.amount
      total.count += 1
      if (!p.done) total.left += p.amount
    }
  }
  const methodOrder = [...ctx.methods.values()].sort(byOrder).map((m) => m.id)
  const entityOrder = [...entities.values()].sort(byOrder).map((e) => e.id)

  return {
    month, currency: household.baseCurrency, payments,
    toPay: sum(tracked.filter((p) => !p.done)), paid: sum(tracked.filter((p) => p.done)),
    overdue: payments.filter((p) => p.state === 'overdue').length,
    methods: [...byMethod.values()].sort((a, b) => rank(methodOrder, a.methodId) - rank(methodOrder, b.methodId)),
    people: [...byPerson.values()].sort((a, b) => (a.ownerId == null ? -1 : b.ownerId == null ? 1 : rank(entityOrder, a.ownerId) - rank(entityOrder, b.ownerId))),
    untracked: { count: loose.length, total: sum(loose) },
  }
}
