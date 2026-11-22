import {
  accountIdOf, buysOnCard, cardIsItemized, compareMonths, methodOf, payContext, payDayOf, paymentKindInfo, paysExpenses, poolIdOf,
  type Account, type CellItem, type FundedBy, type Money, type MonthKey, type PaymentAsk, type PaymentMethod, type Row, type Tables,
} from '@/model'
import { mainAccountsIn } from './mainAccount'
import { buildStatement, type StatementLine } from './statement'
import { cellKey, type CellStatus, type EngineOutput } from './types'

/**
 * Where a payment stands. In the current month a payment with a day is overdue, due today or still coming; in any
 * other month it is simply open, listed by its day. One without a day cannot be placed, and one that is ticked is done.
 */
export type PaymentState = 'overdue' | 'today' | 'coming' | 'open' | 'no-day' | 'done'

/** One amount that leaves in a month: a line of the Statement's "Money out", or one of its items. */
export interface Payment {
  /** The Statement line's id: the row's, or `<row>:<item>`. */
  id: string
  rowId: string
  /** The item it is, where the row's month is a list of items and this is one of them. */
  itemId?: string
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
  methodId: string | null
  /** What the method asks of the household; null without a method. */
  ask: PaymentAsk | null
  /** The account or card it leaves: the one "Comes out of" or the row's card names; null where there is none (no main account yet). */
  accountId: string | null
  /** Who pays: the method's owner, else the owner of the account it leaves; null = the household. */
  ownerId: string | null
  /** It is bought on a credit card: owed there, and no money leaves an account until the card is paid. */
  onCard: boolean
  /** Shown on the Statement for the record and in none of its sums: the payment of a card whose purchases are recorded. Real money all the same. */
  memo: boolean
  status: CellStatus
  done: boolean
  /** Worked out by the app (a share, the rest of the month): it can still move while the month runs. */
  automatic: boolean
  estimate: boolean
  state: PaymentState
}

export interface PaymentMethodTotal {
  /** null: what leaves the account with no method named. */
  methodId: string | null
  label: string
  total: Money
  /** Not ticked yet. */
  left: Money
  count: number
}

export interface PaymentAccountTotal {
  /** null: what leaves no account the household has. */
  accountId: string | null
  label: string
  /** A credit card: `total` is what was bought on it this month. */
  card: boolean
  total: Money
  left: Money
  methods: PaymentMethodTotal[]
  /** A card or a loan that the plan follows: what is owed at the end of the month, in its own currency. */
  owed?: { amount: Money; currency: string }
  /** A card: the payments made to it this month (their ids in `payments`), none where no row pays it off. */
  paidBy?: string[]
}

export interface PaymentPersonTotal {
  /** null: the household. */
  ownerId: string | null
  label: string
  total: Money
  left: Money
}

export interface Payments {
  month: MonthKey
  currency: string
  /** In the Statement's order. */
  payments: Payment[]
  /** What leaves accounts that hold money and is not ticked yet. What is bought on a card is not in it: the card's payment is. */
  toPay: Money
  /** The same, ticked. */
  paid: Money
  overdue: number
  accounts: PaymentAccountTotal[]
  people: PaymentPersonTotal[]
}

const NO_METHOD = 'No method yet'

/**
 * A month's payments, read from its Statement (`buildStatement`): every row of "Money out" that has an amount, and
 * the items of a row that lists them. So the list never says something else than the Statement of its month, and a
 * tick on one is a tick on the other.
 *
 * `today` is an ISO date (YYYY-MM-DD): the calculation does not read the clock.
 */
export function buildPayments(tables: Tables, engine: EngineOutput, month: MonthKey, today: string): Payments | null {
  const statement = buildStatement(tables, engine, month)
  const household = tables.household.find((h) => !h.deletedAt)
  if (!statement || !household) return null
  const ctx = payContext(tables)
  const accountsById = new Map(tables.accounts.filter((a) => !a.deletedAt).map((a) => [a.id, a]))
  const rowsById = new Map(engine.rows.map((r) => [r.id, r]))
  const poolsById = new Map(tables.pools.filter((p) => !p.deletedAt).map((p) => [p.id, p]))
  const entities = new Map(tables.entities.filter((e) => !e.deletedAt).map((e) => [e.id, e]))
  const mainId = mainAccountsIn(tables.accounts.filter((a) => !a.deletedAt), month)[0]?.id ?? null
  const thisMonth = today.slice(0, 7)
  const todayDay = Number(today.slice(8, 10))
  const current = compareMonths(month, thisMonth) === 0

  /** The account "Comes out of" names: the main account for the month's income. */
  const sourceAccount = (f: FundedBy): string | null => {
    const poolId = poolIdOf(f)
    if (poolId) return poolsById.get(poolId)?.accountId ?? mainId
    if (f === 'savings') return engine.primarySavingsId ?? mainId
    const id = accountIdOf(f)
    const account = id ? accountsById.get(id) : undefined
    return account && paysExpenses(account) ? account.id : mainId
  }
  /** Where an amount leaves when no method says: the card it is bought on, the account it comes out of, else the main account. */
  const leaves = (row: Row, item: CellItem | null): string | null => {
    if (!buysOnCard(row)) return mainId
    const card = row.accountId ? accountsById.get(row.accountId) : undefined
    if (card?.type === 'credit-card') return card.id
    return sourceAccount(item?.fundedBy ?? row.defaultFundedBy)
  }
  const stateOf = (done: boolean, day: number | null): PaymentState => {
    if (done) return 'done'
    if (day == null) return 'no-day'
    if (!current) return 'open'
    return day < todayDay ? 'overdue' : day === todayDay ? 'today' : 'coming'
  }

  const payments: Payment[] = []
  const add = (row: Row, line: StatementLine, item: CellItem | null, amount: Money, native: Payment['native'], over: Partial<Payment>) => {
    const method: PaymentMethod | null = methodOf(item, row, ctx)
    // a method is a label: where an amount leaves is what "Comes out of" and the row's card say
    const accountId = leaves(row, item)
    const account: Account | undefined = accountId ? accountsById.get(accountId) : undefined
    const day = payDayOf(item, row, month, ctx)
    const done = (over.status ?? line.status) === 'done'
    payments.push({
      id: line.id, rowId: row.id, label: line.label, amount, native, day,
      methodId: method?.id ?? null, ask: method ? paymentKindInfo(method.kind).ask : null,
      accountId: account ? account.id : null,
      ownerId: (method ? method.ownerEntityId : account?.ownerEntityId) ?? null,
      onCard: account?.type === 'credit-card' && buysOnCard(row),
      memo: !!line.memo, status: line.status ?? 'projected', done, automatic: !!line.automatic, estimate: !!line.estimate,
      state: stateOf(done, day), ...over,
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
        add(row, line, live.length === 1 ? live[0] : null, line.amount, line.native, {})
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

  // ---------- the totals ----------
  const counts = (p: Payment) => !p.onCard
  let toPay: Money = 0
  let paid: Money = 0
  for (const p of payments) {
    if (!counts(p)) continue
    if (p.done) paid += p.amount
    else toPay += p.amount
  }

  const byAccount = new Map<string, PaymentAccountTotal>()
  const accountOrder = [...accountsById.values()].sort((a, b) => (a.type === 'checking' ? 0 : 1) - (b.type === 'checking' ? 0 : 1) || (a.order < b.order ? -1 : a.order > b.order ? 1 : 0)).map((a) => a.id)
  for (const p of payments) {
    const key = p.accountId ?? ''
    const account = p.accountId ? accountsById.get(p.accountId) : undefined
    let total = byAccount.get(key)
    if (!total) byAccount.set(key, (total = { accountId: p.accountId, label: account?.name ?? 'No account', card: account?.type === 'credit-card', total: 0, left: 0, methods: [] }))
    total.total += p.amount
    if (!p.done) total.left += p.amount
    let method = total.methods.find((m) => m.methodId === p.methodId)
    if (!method) total.methods.push((method = { methodId: p.methodId, label: p.methodId ? ctx.methods.get(p.methodId)?.name ?? NO_METHOD : NO_METHOD, total: 0, left: 0, count: 0 }))
    method.total += p.amount
    method.count += 1
    if (!p.done) method.left += p.amount
  }
  // a card the plan follows stands in the list also in a month nothing was bought on it: what is owed, and what pays it
  for (const account of accountsById.values()) {
    if (account.type !== 'credit-card' || (account.archivedMonth && compareMonths(month, account.archivedMonth) >= 0)) continue
    const series = engine.accounts[account.id]?.months[month]
    if (!series && !byAccount.has(account.id)) continue
    const total = byAccount.get(account.id) ?? { accountId: account.id, label: account.name, card: true, total: 0, left: 0, methods: [] }
    if (series) total.owed = { amount: series.balance, currency: account.currency }
    total.paidBy = payments.filter((p) => rowsById.get(p.rowId)?.kind === 'card-payment' && rowsById.get(p.rowId)?.accountId === account.id).map((p) => p.id)
    if (!cardIsItemized(account) && total.total === 0 && total.paidBy.length === 0 && !byAccount.has(account.id)) continue
    byAccount.set(account.id, total)
  }
  const methodOrder = [...ctx.methods.values()].sort((a, b) => (a.order < b.order ? -1 : a.order > b.order ? 1 : 0)).map((m) => m.id)
  const rank = (list: string[], id: string | null) => (id == null ? list.length + 1 : list.indexOf(id) === -1 ? list.length : list.indexOf(id))
  const accounts = [...byAccount.values()].sort((a, b) => rank(accountOrder, a.accountId) - rank(accountOrder, b.accountId))
  for (const a of accounts) a.methods.sort((x, y) => rank(methodOrder, x.methodId) - rank(methodOrder, y.methodId))

  const byPerson = new Map<string, PaymentPersonTotal>()
  for (const p of payments) {
    const key = p.ownerId ?? ''
    let total = byPerson.get(key)
    if (!total) byPerson.set(key, (total = { ownerId: p.ownerId, label: p.ownerId ? entities.get(p.ownerId)?.name ?? 'Household' : 'Household', total: 0, left: 0 }))
    total.total += p.amount
    if (!p.done) total.left += p.amount
  }
  const entityOrder = [...entities.values()].sort((a, b) => (a.order < b.order ? -1 : a.order > b.order ? 1 : 0)).map((e) => e.id)
  const people = [...byPerson.values()].sort((a, b) => (a.ownerId == null ? -1 : b.ownerId == null ? 1 : rank(entityOrder, a.ownerId) - rank(entityOrder, b.ownerId)))

  return {
    month, currency: household.baseCurrency, payments, toPay, paid,
    overdue: payments.filter((p) => p.state === 'overdue').length, accounts, people,
  }
}
