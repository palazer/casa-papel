import { txt } from '@/i18n'
import { cellKey, computeEngine, mainAccountLabel, type EngineOutput } from '@/engine'
import { addMonths, compareMonths, formatMoney, monthOfDate, monthRange, type Money, type MonthKey, type Tables } from '@/model'
import { loadTables } from './actions'
import { applyMutations, monthSpan } from './impact'
import { PastChangeCancelled, type CommitGuard, type Mutation, type Store } from './store'

/**
 * Rule T4: a change that alters a month that is over asks first. The months before the current one are worked out
 * as they are and as the change would leave them; where any figure differs, the question lists the months and what
 * changes in them, and the save waits for the answer. The figures compared are the ones the plan shows for a month:
 * each line's amount (in its currency and in the household's), each account's start, end and real balance, each
 * virtual account's balance and shortfall, the main account, the month's sums and net worth. A name, a category,
 * a goal or who a row belongs to changes none of them, and asks nothing.
 */

/** What a line of the list is about: an amount (a row), a balance, net worth, or only the month's sums. */
export type ChangeKind = 'amount' | 'balance' | 'net-worth' | 'sums'

/** One line of what a change does to the months compared. */
export interface ChangeLine {
  kind: ChangeKind
  /** The row's or the account's name; empty for net worth and the sums. */
  name: string
  /** An amount: a run of months with the same before and after. A balance and net worth: the last month that differs, at its end. The sums: the months they alone change. */
  months: MonthKey[]
  currency: string
  /** null: nothing there (a row without an amount in those months). */
  before: Money | null
  after: Money | null
  /**
   * An amount that changes in more than two runs (what is left, month by month): one line for all of them, with the
   * months it changes in and, where it is the same in each, by how much. `before` and `after` are null then.
   */
  each?: { months: number; by: Money | null }
}

export interface Changes {
  /** Every month compared in which a figure differs. */
  months: MonthKey[]
  lines: ChangeLine[]
  /** Lines left out after the first `cap`. */
  more: number
}

/** A figure of one month, as the list would name it. */
interface Figure {
  kind: ChangeKind
  name: string
  own: Money
  currency: string
  base: Money
  /** Everything compared about it: a difference anywhere counts. */
  says: string
}

const TOTALS = ['income', 'expensesTotal', 'moved', 'movedToAccounts', 'pocket', 'debt', 'allocations', 'toInvestment', 'toSavings', 'leftover', 'fromAccounts'] as const

/** The figures of a month, by what they belong to (`row:<id>`, `account:<id>`, `pool:<id>`, `main`, `net-worth`, `sums`). */
function figuresOf(tables: Tables, engine: EngineOutput, m: MonthKey, home: string): Map<string, Figure> {
  const out = new Map<string, Figure>()
  const named = <T extends { id: string; name: string }>(list: T[], id: string) => list.find((x) => x.id === id)?.name ?? ''
  for (const row of engine.rows) {
    const c = engine.cells[cellKey(row.id, m)]
    // nothing in the month: no amount yet, a typed zero and an archived row all show nothing
    if (!c || (c.value === 0 && c.valueBase === 0)) continue
    out.set(`row:${row.id}`, { kind: 'amount', name: row.name, own: c.value, currency: c.currency, base: c.valueBase, says: `${c.value} ${c.currency} ${c.valueBase}` })
  }
  for (const [id, series] of Object.entries(engine.accounts)) {
    const r = series.months[m]
    if (!r) continue
    out.set(`account:${id}`, { kind: 'balance', name: named(tables.accounts, id), own: r.balance, currency: series.currency, base: r.balanceBase, says: `${r.start} ${r.balance} ${r.balanceBase} ${r.entered ?? ''}` })
  }
  for (const [id, series] of Object.entries(engine.pools)) {
    const r = series.months[m]
    if (!r) continue
    out.set(`pool:${id}`, { kind: 'balance', name: named(tables.pools, id), own: r.balance, currency: series.currency, base: r.balanceBase, says: `${r.balance} ${r.short}` })
  }
  const main = engine.main?.months[m]
  if (engine.main && main) {
    out.set('main', { kind: 'balance', name: mainAccountLabel(engine.main, tables.accounts), own: main.balance, currency: home, base: main.balance, says: `${main.start} ${main.balance} ${main.entered}` })
  }
  if (engine.netWorth[m] != null) out.set('net-worth', { kind: 'net-worth', name: '', own: engine.netWorth[m], currency: home, base: engine.netWorth[m], says: String(engine.netWorth[m]) })
  const t = engine.totals[m]
  if (t) out.set('sums', { kind: 'sums', name: '', own: 0, currency: home, base: 0, says: TOTALS.map((k) => t[k]).join(' ') })
  return out
}

/** The tables and what they work out to. */
export interface Worked {
  tables: Tables
  engine: EngineOutput
}

const ORDER: Record<ChangeKind, number> = { amount: 0, balance: 1, 'net-worth': 2, sums: 3 }

/**
 * What differs between two states over `months`, as lines; null when no figure differs. At most `cap` lines: the
 * amounts first, in the order of the plan's rows, then the balances; an account's line is left out where the main
 * account's line already says it.
 */
export function changesBetween(before: Worked, after: Worked, months: MonthKey[], home: string, cap = 8): Changes | null {
  interface Diff { m: MonthKey; b?: Figure; a?: Figure }
  const byKey = new Map<string, Diff[]>()
  const changed: MonthKey[] = []
  for (const m of months) {
    const fb = figuresOf(before.tables, before.engine, m, home)
    const fa = figuresOf(after.tables, after.engine, m, home)
    let any = false
    for (const key of new Set([...fb.keys(), ...fa.keys()])) {
      const b = fb.get(key)
      const a = fa.get(key)
      if (b?.says === a?.says) continue
      any = true
      if (!byKey.has(key)) byKey.set(key, [])
      byKey.get(key)!.push({ m, b, a })
    }
    if (any) changed.push(m)
  }
  if (changed.length === 0) return null

  // the months an amount or a balance already speaks for: net worth and the sums get a line only elsewhere
  const covered = new Set<MonthKey>()
  for (const [key, diffs] of byKey) if (key !== 'net-worth' && key !== 'sums') for (const d of diffs) covered.add(d.m)
  const mainIds = new Set([...(before.engine.main?.accountIds ?? []), ...(after.engine.main?.accountIds ?? [])])

  // where a line stands: the rows as the plan lists them, then the accounts, the virtual accounts, the main account
  const place = new Map<string, number>()
  for (const r of [...after.engine.rows, ...before.engine.rows]) if (!place.has(`row:${r.id}`)) place.set(`row:${r.id}`, place.size)
  for (const a of [...after.tables.accounts, ...before.tables.accounts]) if (!place.has(`account:${a.id}`)) place.set(`account:${a.id}`, place.size)
  for (const p of [...after.tables.pools, ...before.tables.pools]) if (!place.has(`pool:${p.id}`)) place.set(`pool:${p.id}`, place.size)
  const placed: Array<{ line: ChangeLine; at: number }> = []
  for (const [key, all] of byKey) {
    const at = place.get(key) ?? place.size
    const add = (line: ChangeLine) => placed.push({ line, at })
    if (key.startsWith('account:') && byKey.has('main') && mainIds.has(key.slice('account:'.length))) continue
    const diffs = key === 'net-worth' || key === 'sums' ? all.filter((d) => !covered.has(d.m)) : all
    if (diffs.length === 0) continue
    const first = diffs[0].a ?? diffs[0].b!
    // in its own currency, unless only its worth in the household's moved (a rate)
    const own = diffs.some((d) => d.b?.own !== d.a?.own || d.b?.currency !== d.a?.currency)
    const currency = own ? (diffs.find((d) => d.a)?.a ?? first).currency : home
    const value = (f?: Figure) => (f ? (own ? f.own : f.base) : null)
    if (first.kind === 'amount') {
      const runs: ChangeLine[] = []
      let run: ChangeLine | null = null
      for (const d of diffs) {
        const before = value(d.b)
        const after = value(d.a)
        const next = run && addMonths(run.months[run.months.length - 1], 1) === d.m && run.before === before && run.after === after
        if (run && next) run.months.push(d.m)
        else {
          run = { kind: 'amount', name: (d.a ?? d.b)!.name, months: [d.m], currency, before, after }
          runs.push(run)
        }
      }
      if (runs.length <= 2) runs.forEach(add)
      else {
        const by = diffs.map((d) => (value(d.a) ?? 0) - (value(d.b) ?? 0))
        add({ kind: 'amount', name: runs[0].name, months: diffs.map((d) => d.m), currency, before: null, after: null, each: { months: diffs.length, by: by.every((x) => x === by[0]) ? by[0] : null } })
      }
    } else if (first.kind === 'sums') {
      add({ kind: 'sums', name: '', months: diffs.map((d) => d.m), currency: home, before: null, after: null })
    } else {
      const last = diffs[diffs.length - 1]
      add({ kind: first.kind, name: (last.a ?? last.b)!.name, months: [last.m], currency, before: value(last.b), after: value(last.a) })
    }
  }
  // stable: a row's runs keep their order of months
  const sorted = placed.sort((x, y) => ORDER[x.line.kind] - ORDER[y.line.kind] || x.at - y.at).map((p) => p.line)
  return { months: changed, lines: sorted.slice(0, cap), more: Math.max(0, sorted.length - cap) }
}

/**
 * A line as the list says it. `planEnd`: the last month of the plan, where the list covers all of it (a file): a run
 * of an amount that reaches it reads "from <Month>".
 */
export function changeLineText(line: ChangeLine, locale: string, opts: { planEnd?: MonthKey } = {}): string {
  const say = txt.store.change
  const money = (v: Money | null) => (v == null ? say.nothing : formatMoney(v, line.currency, locale))
  const figures = say.figures(money(line.before), money(line.after))
  const span = monthSpan(line.months, locale)
  switch (line.kind) {
    case 'amount':
      if (line.each) {
        const { months, by } = line.each
        if (by == null || by === 0) return say.amountChanges(line.name, span, months)
        return say.amountEach(line.name, span, formatMoney(Math.abs(by), line.currency, locale), by > 0, months)
      }
      return line.months.length > 1 && line.months[line.months.length - 1] === opts.planEnd
        ? say.amountFrom(line.name, monthSpan([line.months[0]], locale), figures)
        : say.amount(line.name, span, figures)
    case 'balance':
      return say.balance(line.name, span, figures)
    case 'net-worth':
      return say.netWorth(span, figures)
    case 'sums':
      return say.sums(span)
  }
}

/** "and 3 more", for the lines left out. */
export const moreText = (more: number): string | null => (more > 0 ? txt.store.change.andMore(more) : null)

/** The question a save that alters the past waits on. */
export interface PastQuestion {
  changes: Changes
  /** The month "Only from <Month> on" counts from, where the save has such a version and it leaves the past alone. */
  fromNow: MonthKey | null
  locale: string
}

export type PastAnswer = 'save' | 'from-now' | 'cancel'

/** The months the question looks at: from the household's first month (before or after the change) to the month before `today`. */
function pastMonths(before: Tables, after: Tables, today: MonthKey): MonthKey[] {
  const starts = [before, after].map((t) => t.household.find((h) => !h.deletedAt)?.startMonth).filter((m): m is MonthKey => m != null)
  if (starts.length === 0) return []
  const first = starts.sort(compareMonths)[0]
  return compareMonths(first, today) < 0 ? monthRange(first, addMonths(today, -1)) : []
}

/** What a save writes that cannot reach a month that is over: a month's own entries from the current month on, a goal, a category. */
function onlyLater(mutations: Mutation[], today: MonthKey): boolean {
  const monthOf = (m: Mutation): MonthKey | null => {
    if (m.table === 'monthStates') return m.op === 'put' ? (m.record as { month: MonthKey }).month : (m.key as MonthKey)
    if (m.table === 'cells' || m.table === 'accountMonths' || m.table === 'fxRates') return m.op === 'put' ? (m.record as { month: MonthKey }).month : (m.key as [string, MonthKey])[1]
    return null
  }
  return mutations.every((m) => {
    if (m.table === 'goals' || m.table === 'categories') return true
    const month = monthOf(m)
    return month != null && compareMonths(month, today) >= 0
  })
}

const work = (tables: Tables, months: MonthKey[]): Worked => ({ tables, engine: computeEngine({ tables, months }) })

/**
 * The guard the app installs on its store (`store.setGuard`): a save that changes a figure of a month that is over
 * waits for `ask`. "Cancel" throws `PastChangeCancelled` and nothing is written; "Only from <Month> on" writes the
 * save's `fromNow` version, offered only where that version leaves every month that is over as it is.
 */
export function pastGuard(store: Store, ask: (q: PastQuestion) => Promise<PastAnswer>): CommitGuard {
  return async (mutations, opts) => {
    const today = monthOfDate()
    if (onlyLater(mutations, today)) return { mutations, asked: false }
    const tables = await loadTables(store)
    const household = tables.household.find((h) => !h.deletedAt)
    const changed = applyMutations(tables, mutations)
    const months = pastMonths(tables, changed, today)
    if (!household || months.length === 0) return { mutations, asked: false }
    const before = work(tables, months)
    const changes = changesBetween(before, work(changed, months), months, household.baseCurrency)
    if (!changes) return { mutations, asked: false }
    const fromNow = opts.fromNow && !changesBetween(before, work(applyMutations(tables, opts.fromNow), months), months, household.baseCurrency) ? today : null
    const answer = await ask({ changes, fromNow, locale: household.locale })
    if (answer === 'cancel') throw new PastChangeCancelled()
    if (answer === 'from-now' && !(fromNow && opts.fromNow)) throw new Error(txt.errors.onlyMonthNotOfferedChange)
    return { mutations: answer === 'from-now' ? opts.fromNow! : mutations, asked: true }
  }
}
