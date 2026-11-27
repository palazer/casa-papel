import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronRight } from 'lucide-react'
import { InfoTip } from '@/components/InfoTip'
import { PageHeader } from '@/components/PageHeader'
import { Button } from '@/components/ui/button'
import { Chip } from '@/components/ui/chip'
import { Island } from '@/components/ui/island'
import { formatAmount, formatMonth, weekdayOf } from '@/app/format'
import { saveError } from '@/app/saveError'
import { readPref, writePref } from '@/app/prefs'
import { clearHandedPayment, handedOverPayment, keepMonth, keptMonth, useScreen } from '@/app/screens'
import { useStore } from '@/app/store'
import { activeHousehold, defaultMonths, useEngine, useTables } from '@/app/useEngine'
import { NO_METHOD, buildPayments, cellKey, type Payment } from '@/engine'
import { CellEditor } from '@/features/grid/CellEditor'
import { MonthStrip } from '@/features/statement/MonthStrip'
import { nearestMonth } from '@/features/statement/progress'
import { stripMonths } from '@/features/statement/stripMonths'
import { cn } from '@/lib/utils'
import { isPastMonth, isoDateOfToday, monthOfDate, type MonthKey } from '@/model'
import { addPlanYear, setCellDone, setDerivedDone, setItemStatus } from '@/store'
import { GROUP_TITLE, groupPayments, inFilter, type PaymentFilter, type PaymentGroup, type PaymentGroupKey } from './groups'
import { PaymentDialog } from './PaymentDialog'
import { PaymentLine, UntrackedLine } from './PaymentLine'
import { PaymentTotals } from './PaymentTotals'
import { txt } from '@/i18n'

const T = txt.payments.page

const EYEBROW = 'text-[10px] font-semibold uppercase tracking-wider'

/** The page's two lists: what has a day or a method, and what has neither. */
type ListKey = 'tracked' | 'untracked'

let watching = 0

/**
 * After "Payment" was saved, the line may stand under another heading or in the other list, and the button that
 * opened the dialog is gone with it; the closing dialog then hands the focus to whatever had it before. For a moment
 * the keyboard is kept in the list it was in: on the line itself while it is still there, else on the one that stood
 * after it. A key or a press of the pointer ends that: from then on the focus is where its user puts it.
 */
function keepFocus(list: ListKey, id: string, next: string | null) {
  // one save at a time is followed: a later one takes over from an earlier one that is still watching
  const mine = ++watching
  const until = performance.now() + 1200
  let theirs = false
  const taken = () => { theirs = true }
  const events = ['keydown', 'pointerdown'] as const
  for (const e of events) window.addEventListener(e, taken, { capture: true, once: true })
  const find = (pid: string | null) => (pid ? document.querySelector<HTMLElement>(`[data-list="${list}"] [data-payment="${CSS.escape(pid)}"] [data-line-button]`) : null)
  const step = () => {
    if (theirs || mine !== watching || performance.now() > until) {
      for (const e of events) window.removeEventListener(e, taken, { capture: true })
      return
    }
    const at = document.activeElement
    const line = find(id) ?? find(next)
    // not while the dialog is still closing: it would take the focus back
    if (line && at !== line && !at?.closest('[role="dialog"]')) line.focus()
    window.setTimeout(step, 50)
  }
  step()
}

/**
 * Payments (DESIGN.md §12): everything that leaves in a month. What has a day or a method is tracked: it stands day
 * by day with its tick, and beside it what is paid with each method and by whom. What has neither stands below, in a
 * quiet list outside every sum, until "Track…" gives it one. The page exists while the household plans its payments
 * by day and method, and is the month's Statement read another way (`buildPayments`): a tick here is the tick there.
 * In the current month what is late stands first, then today, then what is coming; what has no day and what is done
 * follow.
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
  /** The month of a handed payment, else the one someone picked here or on another screen (`keptMonth`), else today's. */
  const [picked, setPicked] = useState<MonthKey | null>(() => ((handedOverPayment()?.month ?? keptMonth()) as MonthKey | null))
  // handed over for this visit only; the mark goes after a moment, as on the Statement
  useEffect(() => {
    clearHandedPayment()
    if (!handed) return
    keepMonth(handed.month)
    document.querySelector('[data-marked]')?.scrollIntoView({ block: 'center' })
    const timer = window.setTimeout(() => setHanded(null), 2500)
    return () => window.clearTimeout(timer)
  }, [handed])
  /** The total that was pressed: only its payments are listed. */
  const [filter, setFilter] = useState<PaymentFilter | null>(null)
  /** "Done" is folded until it is pressed: what is left to do is what the page is for. */
  const [doneOpen, setDoneOpen] = useState(false)
  /** "Untracked" folds like the sums do, and the device remembers it. */
  const [untrackedFolded, setUntrackedFolded] = useState(() => readPref('payments.fold.untracked', false))
  /** The payment whose day and method are open ("Payment"), and the row whose amount is. */
  const [paying, setPaying] = useState<string | null>(null)
  const [editor, setEditor] = useState<string | null>(null)
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
  const tracked = data.payments.filter((p) => p.tracked)
  const untracked = data.payments.filter((p) => !p.tracked)
  const groups = groupPayments(tracked.filter((p) => inFilter(p, filter)))
  const editing = editor ? engine.rows.find((r) => r.id === editor) : undefined
  const payment = paying ? data.payments.find((p) => p.id === paying) : undefined
  const paymentRow = payment ? engine.rows.find((r) => r.id === payment.rowId) : undefined
  const noMethods = !tables.paymentMethods.some((x) => !x.deletedAt && !x.archived)
  const isMarked = (p: Payment) => !!handed && handed.month === m && p.rowId === handed.rowId && (!handed.itemId || p.itemId === handed.itemId)

  /** A month of its own has totals of its own: a pressed one does not carry over. */
  const setMonth = (next: MonthKey) => {
    setPicked(next)
    keepMonth(next)
    setFilter(null)
    setHanded(null)
  }

  /** The tracked lines in view, top to bottom: what is done only while it is unfolded. */
  const inView = () => groups.filter((g) => g.key !== 'done' || doneOpen || g.payments.some(isMarked)).flatMap((g) => g.payments.map((x) => x.id))
  /** The line that stands after a line of a list (before it, at the list's end): where the keyboard goes when that line leaves. */
  const neighbour = (list: ListKey, id: string): string | null => {
    const ids = list === 'tracked' ? inView() : untracked.map((x) => x.id)
    const at = ids.indexOf(id)
    return ids[at + 1] ?? ids[at - 1] ?? null
  }

  /** One tick: the Statement's own, for the same amount (an item, an amount the app works out, or a row's month). */
  function onTick(p: Payment) {
    const row = engine!.rows.find((r) => r.id === p.rowId)
    const cell = row ? engine!.cells[cellKey(row.id, m!)] : undefined
    if (!row || !cell) return
    const done = !p.done
    focusAfter.current = neighbour('tracked', p.id)
    setBusy(p.id)
    setError(null)
    const run = p.itemId
      ? setItemStatus(store, row.id, m!, p.itemId, done ? 'done' : row.defaultStatus)
      : cell.source === 'derived' ? setDerivedDone(store, row.id, m!, done) : setCellDone(store, row.id, m!, done)
    run.catch((e) => setError(saveError(e, txt.common.actionFailed))).finally(() => setBusy(null))
  }

  /** What a pressed sum is called above the list. */
  const filterLabel = (f: PaymentFilter): string =>
    f.kind === 'person' ? data.people.find((p) => p.ownerId === f.ownerId)?.label ?? txt.common.household : data.methods.find((x) => x.methodId === f.methodId)?.label ?? NO_METHOD

  const heading = (g: PaymentGroup): string => {
    const first = g.payments[0]
    return g.key === 'today' && first.day != null ? T.todayOn(weekdayOf(m, first.day, locale), first.day) : GROUP_TITLE[g.key]
  }
  const HEAD_TONE: Partial<Record<PaymentGroupKey, string>> = { overdue: 'text-rose-700 dark:text-rose-300', today: 'text-foreground' }
  const lines = (g: PaymentGroup) => (
    <ul className="divide-y divide-border/60">
      {g.payments.map((p) => (
        <PaymentLine
          key={p.id} payment={p} month={m} method={p.methodId ? methods.get(p.methodId) ?? null : null} currency={ccy} locale={locale}
          busy={busy === p.id} onTick={() => onTick(p)} onOpen={() => setPaying(p.id)} marked={isMarked(p)}
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
        title={T.payments} subline={household.name} sticky
        above={strip.length > 0 && <MonthStrip months={strip} month={m} today={monthOfDate()} currency={ccy} locale={locale} onChange={setMonth} onAddYear={() => void addPlanYear(store).catch((e) => setError(saveError(e, txt.common.actionFailed)))} />}
        notes={error && <p role="alert" className="text-destructive">{error}</p>}
      >
        <h2 className="text-sm font-semibold leading-5">{formatMonth(m, locale, 'long')}</h2>
        {isPastMonth(m) && <Chip tone="zinc" title={T.thisMonthIsOver}>{T.past}</Chip>}
        {data.payments.length > 0 && (
          <p role="status" className="flex items-center gap-1 text-muted-foreground" data-testid="payments-summary">
            <span>
              {T.toPayAndDone(money(data.toPay), money(data.paid))}
              {data.overdue > 0 && <> · <span className="text-rose-700 dark:text-rose-300">{T.overdue(data.overdue)}</span></>}
              {data.untracked.count > 0 && <> · {T.untracked(data.untracked.count)}</>}
            </span>
            <InfoTip help="payments.toPay" />
          </p>
        )}
      </PageHeader>

      {data.payments.length === 0 ? (
        <Island air title={T.byDay}>
          <p className="text-muted-foreground" data-testid="payments-empty">{T.nothingLeavesInThe(formatMonth(m, locale, 'long'))}</p>
        </Island>
      ) : (
        <div className={cn('grid grid-cols-1 items-start gap-4', tracked.length > 0 && 'lg:grid-cols-[minmax(0,1fr)_22rem]')}>
          <div className="min-w-0 space-y-4">
            <Island
              air title={T.byDay} help="payments.byDay" data-testid="payments-list" data-list="tracked"
              right={filter && (
                <span className="flex items-center gap-1.5" data-testid="payments-filter">
                  <span>{T.only(filterLabel(filter))}</span>
                  <Button size="xs" variant="outline" onClick={() => setFilter(null)}>{T.showAll}</Button>
                </span>
              )}
            >
              <div className="space-y-2">
                {noMethods && (
                  <p className="text-xs text-muted-foreground" data-testid="payments-no-methods">
                    {T.noPaymentMethodsYet}{' '}
                    <Button size="xs" variant="outline" onClick={() => go('household')}>{T.addThemUnderHousehold}</Button>
                  </p>
                )}
                {tracked.length === 0
                  ? <p className="text-muted-foreground" data-testid="payments-none-tracked">{T.nothingIsTrackedIn(formatMonth(m, locale, 'long'))}</p>
                  : groups.length === 0 ? <p className="text-muted-foreground">{T.nothingOfItIn}</p> : groups.map(group)}
              </div>
            </Island>
            {/* outside every sum, so not there while one sum's payments are picked out */}
            {untracked.length > 0 && !filter && (
              <Island
                air title={T.untracked2} help="payments.untracked" data-testid="payments-untracked" data-list="untracked"
                folded={untrackedFolded} onFold={(to) => { setUntrackedFolded(to); writePref('payments.fold.untracked', to) }}
                right={<span>{data.untracked.count} · {money(data.untracked.total)}</span>}
                description={T.whatLeavesInWith(formatMonth(m, locale, 'long'))}
              >
                <ul className="-ml-2 divide-y divide-border/60">
                  {untracked.map((p) => <UntrackedLine key={p.id} payment={p} currency={ccy} locale={locale} onTrack={() => setPaying(p.id)} />)}
                </ul>
              </Island>
            )}
          </div>
          {/* after the lists in the page's order, as it is read from 1024 px; above them below that, where it folds away */}
          {tracked.length > 0 && <PaymentTotals data={data} tables={tables} filter={filter} onFilter={setFilter} locale={locale} className="max-lg:order-first" />}
        </div>
      )}

      {editing && <CellEditor key={`${editing.id}:${m}`} tables={tables} engine={engine} household={household} row={editing} month={m} onClose={() => setEditor(null)} />}
      {payment && paymentRow && (
        <PaymentDialog
          key={`${payment.id}:${m}`} payment={payment} row={paymentRow} month={m} tables={tables} household={household}
          onClose={() => setPaying(null)}
          onSaved={() => { const list: ListKey = payment.tracked ? 'tracked' : 'untracked'; keepFocus(list, payment.id, neighbour(list, payment.id)) }}
          onAmount={() => { setPaying(null); setEditor(payment.rowId) }}
        />
      )}
    </div>
  )
}
