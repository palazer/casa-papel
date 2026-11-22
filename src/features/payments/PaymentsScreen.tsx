import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronRight } from 'lucide-react'
import { InfoTip } from '@/components/InfoTip'
import { PageHeader } from '@/components/PageHeader'
import { Button } from '@/components/ui/button'
import { Chip } from '@/components/ui/chip'
import { Island } from '@/components/ui/island'
import { formatAmount, formatMonth, weekdayOf } from '@/app/format'
import { saveError } from '@/app/saveError'
import { clearHandedPayment, handedOverPayment, useScreen } from '@/app/screens'
import { useStore } from '@/app/store'
import { activeHousehold, defaultMonths, useEngine, useTables } from '@/app/useEngine'
import { buildPayments, cellKey, type Payment, type PaymentState } from '@/engine'
import { CellEditor } from '@/features/grid/CellEditor'
import { RowPaidDialog } from '@/features/grid/RowDialogs'
import { MonthStrip } from '@/features/statement/MonthStrip'
import { nearestMonth } from '@/features/statement/progress'
import { stripMonths } from '@/features/statement/stripMonths'
import { cn } from '@/lib/utils'
import { isPastMonth, isoDateOfToday, monthOfDate, type MonthKey } from '@/model'
import { addPlanYear, setCellDone, setDerivedDone, setItemStatus } from '@/store'
import { GROUP_TITLE, groupPayments, inFilter, type PaymentFilter, type PaymentGroup } from './groups'
import { PaymentLine } from './PaymentLine'
import { PaymentTotals } from './PaymentTotals'

const EYEBROW = 'text-[10px] font-semibold uppercase tracking-wider'

/**
 * Payments (DESIGN.md §12): a month's amounts that leave, day by day, each with the method it is paid with, and
 * beside them what each account has to carry and who pays. It exists while the household plans its payments by day
 * and method. The list is the month's Statement read another way (`buildPayments`): a tick here is the tick there,
 * and a line opens the same dialog. In the current month what is late stands first, then today, then what is coming;
 * what has no day and what is done follow.
 */
export function PaymentsScreen() {
  const store = useStore()
  const tables = useTables()
  const household = activeHousehold(tables)
  const { go } = useScreen()
  const months = useMemo(() => (household && tables ? defaultMonths(household, tables) : []), [household, tables])
  const engine = useEngine(tables, months)
  /** A line of the Statement whose day was pressed: the page opens on its month, with its payments marked. */
  const [handed, setHanded] = useState(handedOverPayment)
  /** The month someone picked; until then, the handed one, or today's. */
  const [picked, setPicked] = useState<MonthKey | null>(() => (handedOverPayment()?.month as MonthKey | undefined) ?? null)
  // handed over for this visit only; the mark goes after a moment, as on the Statement
  useEffect(() => {
    clearHandedPayment()
    if (!handed) return
    document.querySelector('[data-marked]')?.scrollIntoView({ block: 'center' })
    const timer = window.setTimeout(() => setHanded(null), 2500)
    return () => window.clearTimeout(timer)
  }, [handed])
  /** The total that was pressed: only its payments are listed. */
  const [filter, setFilter] = useState<PaymentFilter | null>(null)
  /** "Done" is folded until it is pressed: what is left to do is what the page is for. */
  const [doneOpen, setDoneOpen] = useState(false)
  /** The row whose amount is open, and the row whose usual day and method are. */
  const [editor, setEditor] = useState<string | null>(null)
  const [paidFor, setPaidFor] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  /**
   * A ticked line moves under another heading, and takes the keyboard's place with it: the line that stood after it
   * (before it, at the end of the list) gets the focus once the tick is saved, if nothing else has it by then.
   */
  const focusAfter = useRef<string | null>(null)
  useEffect(() => {
    const id = focusAfter.current
    if (!id || busy) return
    focusAfter.current = null
    const at = document.activeElement
    if (at && at !== document.body && !(at as HTMLButtonElement).disabled && document.contains(at)) return
    document.querySelector<HTMLElement>(`[data-payment="${CSS.escape(id)}"] [role="checkbox"]`)?.focus()
  })

  const today = isoDateOfToday()
  const m = months.length ? nearestMonth(months, picked ?? monthOfDate()) : null
  const data = useMemo(() => (tables && engine && m ? buildPayments(tables, engine, m, today) : null), [tables, engine, m, today])
  const strip = useMemo(() => (tables && engine ? stripMonths(tables, engine, months) : []), [tables, engine, months])

  if (!tables || !household || !engine || !m || !data) return null
  const { baseCurrency: ccy, locale } = household
  const money = (v: number) => formatAmount(v, ccy, locale)
  const methods = new Map(tables.paymentMethods.filter((x) => !x.deletedAt).map((x) => [x.id, x]))
  const shown = data.payments.filter((p) => inFilter(p, filter))
  const groups = groupPayments(shown)
  const editing = editor ? engine.rows.find((r) => r.id === editor) : undefined
  const paying = paidFor ? engine.rows.find((r) => r.id === paidFor) : undefined
  const noMethods = !tables.paymentMethods.some((x) => !x.deletedAt && !x.archived)
  const isMarked = (p: Payment) => !!handed && handed.month === m && p.rowId === handed.rowId && (!handed.itemId || p.itemId === handed.itemId)

  /** A month of its own has totals of its own: a pressed one does not carry over. */
  const setMonth = (next: MonthKey) => {
    setPicked(next)
    setFilter(null)
    setHanded(null)
  }

  /** One tick: the Statement's own, for the same amount (an item, an amount the app works out, or a row's month). */
  function onTick(p: Payment) {
    const row = engine!.rows.find((r) => r.id === p.rowId)
    const cell = row ? engine!.cells[cellKey(row.id, m!)] : undefined
    if (!row || !cell) return
    const done = !p.done
    // the lines in view, top to bottom: what is done only while it is unfolded
    const inView = groups.filter((g) => g.key !== 'done' || doneOpen || g.payments.some(isMarked)).flatMap((g) => g.payments.map((x) => x.id))
    const at = inView.indexOf(p.id)
    focusAfter.current = inView[at + 1] ?? inView[at - 1] ?? null
    setBusy(p.id)
    setError(null)
    const run = p.itemId
      ? setItemStatus(store, row.id, m!, p.itemId, done ? 'done' : row.defaultStatus)
      : cell.source === 'derived' ? setDerivedDone(store, row.id, m!, done) : setCellDone(store, row.id, m!, done)
    run.catch((e) => setError(saveError(e, 'Action failed'))).finally(() => setBusy(null))
  }

  /** What a pressed total is called above the list. */
  const filterLabel = (f: PaymentFilter): string => {
    if (f.kind === 'person') return data.people.find((p) => p.ownerId === f.ownerId)?.label ?? 'Household'
    const account = data.accounts.find((a) => a.accountId === f.accountId)
    if (f.kind === 'account') return account?.label ?? 'No account'
    return `${account?.methods.find((x) => x.methodId === f.methodId)?.label ?? 'No method yet'} on ${account?.label ?? 'no account'}`
  }

  const heading = (g: PaymentGroup): string => {
    const first = g.payments[0]
    return g.key === 'today' && first.day != null ? `Today, ${weekdayOf(m, first.day, locale)} ${first.day}` : GROUP_TITLE[g.key]
  }
  const HEAD_TONE: Partial<Record<PaymentState, string>> = { overdue: 'text-rose-700 dark:text-rose-300', today: 'text-foreground' }
  const lines = (g: PaymentGroup) => (
    <ul className="divide-y divide-border/60">
      {g.payments.map((p) => (
        <PaymentLine
          key={p.id} payment={p} month={m} method={p.methodId ? methods.get(p.methodId) ?? null : null} currency={ccy} locale={locale}
          busy={busy === p.id} onTick={() => onTick(p)} onOpen={() => setEditor(p.rowId)} marked={isMarked(p)}
          // one item of several says its own day in the amount's dialog; anything else takes the row's usual one
          onSet={p.state === 'no-day' && !p.itemId ? () => setPaidFor(p.rowId) : undefined}
        />
      ))}
    </ul>
  )
  const group = (g: PaymentGroup) => {
    const count = <span className="font-normal normal-case tracking-normal text-muted-foreground">{g.payments.length} · {money(g.total)}</span>
    if (g.key === 'done') {
      // a payment the Statement pointed at is shown, also when it is done
      const doneShown = doneOpen || g.payments.some(isMarked)
      return (
        <section key={g.key} data-group={g.key}>
          <h4 className={cn(EYEBROW, 'text-muted-foreground')}>
            <button
              type="button" aria-expanded={doneShown} aria-controls="payments-done" onClick={() => setDoneOpen(!doneShown)}
              className="flex min-h-11 w-full items-center gap-1.5 rounded uppercase outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring md:min-h-7"
            >
              <ChevronRight className={cn('size-3.5 shrink-0 transition-transform', doneShown && 'rotate-90')} aria-hidden />
              <span>{heading(g)}</span>
              {count}
            </button>
          </h4>
          {doneShown && <div id="payments-done">{lines(g)}</div>}
        </section>
      )
    }
    return (
      <section key={g.key} data-group={g.key}>
        <h4 className={cn(EYEBROW, 'flex min-h-7 items-center gap-1.5', HEAD_TONE[g.key] ?? 'text-muted-foreground')}>
          <span>{heading(g)}</span>
          {count}
        </h4>
        {lines(g)}
      </section>
    )
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Payments" subline={household.name} sticky
        above={strip.length > 0 && <MonthStrip months={strip} month={m} today={monthOfDate()} currency={ccy} locale={locale} onChange={setMonth} onAddYear={() => void addPlanYear(store).catch((e) => setError(saveError(e, 'Action failed')))} />}
        notes={error && <p role="alert" className="text-destructive">{error}</p>}
      >
        <h2 className="text-sm font-semibold leading-5">{formatMonth(m, locale, 'long')}</h2>
        {isPastMonth(m) && <Chip tone="zinc" title="This month is over. It can still be changed.">past</Chip>}
        {data.payments.length > 0 && (
          <p role="status" className="flex items-center gap-1 text-muted-foreground" data-testid="payments-summary">
            <span>
              {money(data.toPay)} to pay · {money(data.paid)} done
              {data.overdue > 0 && <> · <span className="text-rose-700 dark:text-rose-300">{data.overdue} overdue</span></>}
            </span>
            <InfoTip help="payments.toPay" />
          </p>
        )}
      </PageHeader>

      {data.payments.length === 0 ? (
        <Island air title="By day">
          <p className="text-muted-foreground" data-testid="payments-empty">Nothing leaves in {formatMonth(m, locale, 'long')}: the month's Statement has no amount under "Money out".</p>
        </Island>
      ) : (
        <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
          <Island
            air title="By day" help="payments.byDay" data-testid="payments-list"
            right={filter && (
              <span className="flex items-center gap-1.5" data-testid="payments-filter">
                <span>Only {filterLabel(filter)}</span>
                <Button size="xs" variant="outline" onClick={() => setFilter(null)}>Show all</Button>
              </span>
            )}
          >
            <div className="space-y-2">
              {noMethods && (
                <p className="text-xs text-muted-foreground" data-testid="payments-no-methods">
                  No payment methods yet, so nothing says how an amount leaves.{' '}
                  <Button size="xs" variant="outline" onClick={() => go('household')}>Add them under Household</Button>
                </p>
              )}
              {groups.length === 0 ? <p className="text-muted-foreground">Nothing of it in this month.</p> : groups.map(group)}
            </div>
          </Island>
          {/* after the list in the page's order, as it is read from 1024 px; above it below that, where it folds away */}
          <PaymentTotals data={data} filter={filter} onFilter={setFilter} locale={locale} className="max-lg:order-first" />
        </div>
      )}

      {editing && <CellEditor key={`${editing.id}:${m}`} tables={tables} engine={engine} household={household} row={editing} month={m} onClose={() => setEditor(null)} />}
      {paying && <RowPaidDialog key={paying.id} row={paying} tables={tables} household={household} onClose={() => setPaidFor(null)} />}
    </div>
  )
}
