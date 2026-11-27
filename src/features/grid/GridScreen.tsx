import { useMemo, useState, type KeyboardEvent, type ReactNode } from 'react'
import { ChevronDown, ChevronRight, Repeat } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { InfoTip } from '@/components/InfoTip'
import { MarksLegend } from '@/components/MarksLegend'
import { PageHeader } from '@/components/PageHeader'
import { cn } from '@/lib/utils'
import { formatAmount, formatMonth, formatPercent } from '@/app/format'
import { balanceHelp, type HelpKey } from '@/app/help'
import { HUES, SECTION_HUE, type Hue } from '@/app/hues'
import { readPref, writePref } from '@/app/prefs'
import { keepMonth, useScreen } from '@/app/screens'
import { useStore } from '@/app/store'
import { activeHousehold, defaultMonths, useEngine, useTables } from '@/app/useEngine'
import { useUndoNotice } from '@/app/useUndoNotice'
import { UndoNotice } from '@/components/UndoNotice'
import { cellKey, mainAccountsIn, groupRowsByCategory, mainAccountLabel, type EngineOutput } from '@/engine'
import { isOldPocketShare, isPastMonth, isShareRule, monthOfDate, parseMonth, repeatsText, resolveRules, runningSchedules, type Household, type Money, type MonthKey, type Row, type RuleState, type Section, type Tables } from '@/model'
import { addPlanYear, derivedRowReason } from '@/store'
import { AddRowInline } from './AddRowInline'
import { BalanceDialog } from './BalanceDialog'
import { MonthBalancesDialog } from './MonthBalancesDialog'
import { CurrentBalanceDialog } from './CurrentBalanceDialog'
import { CellEditor } from './CellEditor'
import { RowMenu } from './RowMenu'
import { amountDisplay, doneLabel, doneness, flowOf, ruleText, statusClass, toneClass, type Flow } from '@/app/display'
import { DoneDot } from '@/components/DoneDot'
import { saveError } from '@/app/saveError'
import { txt } from '@/i18n'

const T = txt.grid.page

const SECTIONS: Array<{ key: Section; title: string }> = [
  { key: 'income', title: txt.common.income },
  { key: 'expense', title: txt.common.expenses },
  { key: 'transfer', title: txt.common.transfers },
]

export function GridScreen() {
  const store = useStore()
  const tables = useTables()
  const household = activeHousehold(tables)
  /** Every month of the plan: the engine counts them all, whichever the table shows. */
  const allMonths = useMemo(() => (household && tables ? defaultMonths(household, tables) : []), [household, tables])
  const engine = useEngine(tables, allMonths)
  const { go } = useScreen()
  /** The Grid is for the months ahead: it starts at the current month, and the months before it are one button away. */
  const [showEarlier, setShowEarlier] = useState(() => readPref('grid.earlier', false))
  const [collapsed, setCollapsed] = useState<Set<Section>>(() => new Set())
  const [selected, setSelected] = useState<{ rowId: string; month: MonthKey } | null>(null)
  const [balanceSel, setBalanceSel] = useState<{ accountId: string; month: MonthKey } | null>(null)
  /** The month whose real balances of the current accounts are being typed. */
  const [currentSel, setCurrentSel] = useState<MonthKey | null>(null)
  /** The month "Balances for <Month>…" was pressed for: every account of it, with the tick that counts it as done. */
  const [balancesFor, setBalancesFor] = useState<MonthKey | null>(null)
  const [error, setError] = useState<string | null>(null)
  /** What a restore from a row's menu brought back, with the way back: it goes with the next change. */
  const notice = useUndoNotice(store)
  /** Which rows a rule works out, read the way the engine reads them. */
  const rules = useMemo(() => (engine && household ? resolveRules(engine.rows, household.closingRule) : null), [engine, household])

  if (!tables || !household || !engine) return null
  const { locale, baseCurrency: ccy, displayExpensesNegative: neg } = household
  const today = monthOfDate()
  // the current month, or the nearest month the plan has when today lies outside it
  const firstShown = today < allMonths[0] ? allMonths[0] : today > allMonths[allMonths.length - 1] ? allMonths[allMonths.length - 1] : today
  const earlier = allMonths.filter((m) => m < firstShown).length
  const months = showEarlier ? allMonths : allMonths.slice(earlier)
  const toggleEarlier = () => {
    writePref('grid.earlier', !showEarlier)
    setShowEarlier(!showEarlier)
  }

  const rowsBySection = (s: Section) => engine.rows.filter((r) => r.section === s && !(r.archivedMonth && r.archivedMonth <= months[0]))
  let editableIndex = 0

  function toggle(s: Section) {
    setCollapsed((prev) => {
      const n = new Set(prev)
      if (n.has(s)) n.delete(s)
      else n.add(s)
      return n
    })
  }

  function onKeyDown(e: KeyboardEvent<HTMLTableElement>) {
    const el = e.target as HTMLElement
    const pos = el.dataset.cell
    if (!pos) return
    const [r, c] = pos.split(',').map(Number)
    const move = (dr: number, dc: number) => {
      const t = e.currentTarget.querySelector<HTMLElement>(`[data-cell="${r + dr},${c + dc}"]`)
      if (t) {
        t.focus()
        e.preventDefault()
      }
    }
    if (e.key === 'ArrowRight') move(0, 1)
    else if (e.key === 'ArrowLeft') move(0, -1)
    else if (e.key === 'ArrowDown') move(1, 0)
    else if (e.key === 'ArrowUp') move(-1, 0)
    else if (e.key === 'Enter' || e.key === ' ') {
      el.click()
      e.preventDefault()
    }
  }

  const act = (fn: () => Promise<unknown>) => void fn().catch((err) => setError(saveError(err, txt.common.actionFailed)))

  /** Balance series that still reach into the shown months; an account archived before them has nothing to show. */
  const accountSeries = Object.values(engine.accounts).filter((s) => Object.keys(s.months).length > 0)
  const poolSeries = Object.values(engine.pools).filter((p) => Object.keys(p.months).length > 0)
  /** What stays in the current accounts counts in net worth, so it has a row: once there is such an account, or money in it. */
  const main = engine.main
  const mainShown = !!main && (main.accountIds.length > 0 || months.some((m) => (main.months[m]?.balance ?? 0) !== 0))

  const derivedRow = (
    /** `pick` returns null for a month the series does not reach (an archived account or virtual account): the cell stays blank. */
    label: string, flow: Flow, pick: (m: MonthKey) => Money | null,
    /** `sub`: a detail line under the named parent row; indented and faded, with the parent's name read out but not shown. */
    opts: { strong?: boolean; muted?: boolean; currency?: string; hue?: Hue; band?: boolean; sub?: string; help?: HelpKey; format?: (v: Money, m: MonthKey) => string; onClick?: (m: MonthKey) => void; mark?: (m: MonthKey) => boolean; warn?: (m: MonthKey) => string | null } = {},
  ): ReactNode => (
    <tr key={opts.sub ? `${opts.sub} · ${label}` : label} className={cn(opts.band && (opts.hue ? opts.hue.tint : 'bg-muted/40'), opts.strong && 'font-medium')}>
      <th scope="row" className={cn('sticky left-0 z-10 px-2 py-0.5 text-left', opts.band ? (opts.hue ? opts.hue.tint : 'bg-muted') : 'bg-card', opts.hue && !opts.sub ? opts.hue.text : 'text-muted-foreground', opts.muted && 'text-[11px]', opts.sub && 'pl-6 font-normal')}>
        {opts.sub && <span className="sr-only">{opts.sub} · </span>}
        {label}
        {opts.help && <InfoTip help={opts.help} className="ml-1" />}
      </th>
      {months.map((m) => {
        const v = pick(m)
        if (v == null) return <td key={m} className={cn('p-0', isPastMonth(m, today) && 'bg-muted/60')} />
        const d = amountDisplay(v, flow, opts.currency ?? ccy, locale, neg)
        const text = opts.format ? opts.format(v, m) : d.text
        const marked = opts.mark?.(m) ?? false
        // a balance that needs attention (a virtual account that was asked for more than it held) takes the expense hue and says why
        const warning = opts.warn?.(m) ?? null
        return (
          <td key={m} title={warning ?? undefined} className={cn('p-0 text-right tabular-nums', toneClass[d.tone], warning && 'text-expense', opts.muted && 'text-[11px]', opts.sub && 'text-muted-foreground', isPastMonth(m, today) && 'bg-muted/60')}>
            {opts.onClick ? (
              <button type="button" aria-label={`${label} ${formatMonth(m, locale)}: ${text}`} onClick={() => opts.onClick!(m)} className={cn('w-full px-1.5 py-0.5 text-right hover:bg-muted', marked && 'underline decoration-dotted underline-offset-4')}>
                {text}
              </button>
            ) : (
              <span className="block px-1.5 py-0.5">{v === 0 && opts.muted ? '' : text}</span>
            )}
          </td>
        )
      })}
    </tr>
  )

  const selectedRow = selected ? engine.rows.find((r) => r.id === selected.rowId) : undefined

  return (
    <div className="space-y-4">
      <PageHeader
        title={T.grid} subline={`${household.name} · ${formatMonth(months[0], locale)} – ${formatMonth(months[months.length - 1], locale)}`}
        tools={<MarksLegend neg={neg} />}
        notes={<>
          {engine.warnings.length > 0 && <p role="alert" className="text-amber-700 dark:text-amber-400">{engine.warnings.join(' · ')}</p>}
          {error && (
            <p role="alert" className="flex items-center gap-2 text-destructive">
              <span>{error}</span>
              <Button size="xs" variant="outline" onClick={() => setError(null)}>{txt.common.dismiss}</Button>
            </p>
          )}
        </>}
      >
        {earlier > 0 && (
          <Button size="xs" variant={showEarlier ? 'default' : 'outline'} aria-pressed={showEarlier} title={showEarlier ? T.startAtTheCurrent : T.showTheMonthsBefore} onClick={toggleEarlier}>
            {T.earlierMonths(earlier)}
          </Button>
        )}
        <Button size="xs" variant="outline" onClick={() => act(() => addPlanYear(store))}>{T.addYear(parseMonth(months[months.length - 1]).year)}</Button>
        <span className="text-muted-foreground">{T.clickACellTo}</span>
      </PageHeader>

      <div className="relative isolate max-h-[calc(100dvh-var(--page-chrome))] overflow-auto rounded-lg border bg-card">
        <table className="border-separate border-spacing-0 text-xs" onKeyDown={onKeyDown}>
          <thead>
            <tr>
              <th className="sticky top-0 left-0 z-30 min-w-[200px] border-b bg-card px-2 py-1.5 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                {household.name}
              </th>
              {months.map((m) => {
                const t = engine.totals[m]
                const isToday = m === today
                return (
                  <th key={m} className={cn('sticky top-0 z-20 min-w-24 border-b px-1 py-1 text-right font-medium', isToday ? 'bg-muted' : 'bg-card')}>
                    <DropdownMenu>
                      <DropdownMenuTrigger
                        render={<button className="inline-flex w-full items-center justify-end gap-1 rounded px-1 py-0.5 hover:bg-muted" aria-label={T.monthSaid(formatMonth(m, locale), isPastMonth(m, today))} />}
                      >
                        <span className={cn(isToday ? 'font-semibold text-foreground' : 'text-muted-foreground')}>{formatMonth(m, locale)}</span>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuGroup>
                          <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
                            {T.incomeExpenses(formatAmount(t?.income ?? 0, ccy, locale, { compact: true }), formatAmount(t?.expensesTotal ?? 0, ccy, locale, { compact: true }))}
                          </DropdownMenuLabel>
                        </DropdownMenuGroup>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem onClick={() => { keepMonth(m); go('statement') }}>{T.openInTheStatement}</DropdownMenuItem>
                        <DropdownMenuItem onClick={() => setBalancesFor(m)}>{T.balancesFor(formatMonth(m, locale))}</DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {SECTIONS.map(({ key, title }) => {
              const rows = rowsBySection(key)
              const isCollapsed = collapsed.has(key)
              const sectionCategories = tables.categories.filter((c) => !c.deletedAt && c.section === key)
              const groups = groupRowsByCategory(rows, tables.categories)
              const bandOf = (band: boolean) => (band ? SECTION_HUE[key].band : undefined)
              return [
                <tr key={`${key}-head`} className="bg-card">
                  <th scope="row" className="sticky left-0 z-10 border-t bg-card px-2 py-1.5 text-left">
                    <button className={cn('inline-flex items-center gap-1 text-xs font-semibold', SECTION_HUE[key].text)} onClick={() => toggle(key)} aria-expanded={!isCollapsed}>
                      {isCollapsed ? <ChevronRight className="size-3" aria-hidden /> : <ChevronDown className="size-3" aria-hidden />}
                      {title}
                    </button>
                    <InfoTip help={`section.${key}`} className="ml-1" />
                  </th>
                  <td colSpan={months.length} className="border-t" />
                </tr>,
                ...(isCollapsed ? [] : groups.flatMap((g) => [
                  sectionCategories.length > 0 && (
                    <tr key={`${key}-label-${g.category?.id ?? 'none'}`} className={bandOf(g.band)}>
                      <td className={cn('sticky left-0 z-10 px-2 pb-0 pt-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground', bandOf(g.band) ?? 'bg-card')}>{g.category?.name ?? txt.common.noCategory}</td>
                      <td colSpan={months.length} />
                    </tr>
                  ),
                  ...g.rows.map((row) => <GridRow key={row.id} row={row} band={bandOf(g.band)} rIndex={editableIndex++} months={months} engine={engine} tables={tables} household={household} ccy={ccy} locale={locale} neg={neg} rule={rules?.byRow.get(row.id)} onSelect={(m) => setSelected({ rowId: row.id, month: m })} onError={setError} onRestored={notice.say} />),
                ])),
                !isCollapsed && (
                  <tr key={`${key}-add`}>
                    <td className="sticky left-0 z-10 bg-card px-1 py-0.5"><AddRowInline section={key} categories={sectionCategories} tables={tables} household={household} onError={setError} /></td>
                    <td colSpan={months.length} />
                  </tr>
                ),
                key === 'income' && derivedRow(T.incomeTotal, 'in', (m) => engine.totals[m].income, { strong: true, hue: HUES.income, band: true, help: 'derived.incomeTotal' }),
                key === 'expense' && derivedRow(T.expensesTotal, 'out', (m) => engine.totals[m].expensesTotal, { strong: true, hue: HUES.expense, band: true, help: 'derived.expensesTotal' }),
                key === 'expense' && months.some((m) => engine.totals[m].fromSavingsDerived !== 0) && derivedRow(T.ofWhichPaidFrom, 'in', (m) => engine.totals[m].fromSavingsDerived, { muted: true, hue: HUES.pool, help: 'derived.fromSavings' }),
                key === 'transfer' && derivedRow(household.closingRule === 'savings-plug' ? T.keptInAccount : T.leftover, 'in', (m) => engine.totals[m].leftover, { strong: true, hue: HUES.transfer, band: true, help: household.closingRule === 'savings-plug' ? 'derived.keptInAccount' : 'derived.leftover' }),
              ]
            })}

            {(mainShown || accountSeries.length > 0 || poolSeries.length > 0) && (
              <tr>
                <th scope="row" className={cn('sticky left-0 z-10 border-t bg-card px-2 py-1.5 text-left text-xs font-semibold', HUES.worth.text)}>{T.balances}</th>
                <td colSpan={months.length} className="border-t" />
              </tr>
            )}
            {main && mainShown && derivedRow(mainAccountLabel(main, tables.accounts), 'in', (m) => main.months[m]?.balance ?? null, {
              strong: true, hue: HUES.worth, help: 'statement.mainAccount', mark: (m) => main.months[m]?.entered ?? false,
              // a month takes a real balance once the main account exists in it
              onClick: (m) => { if (mainAccountsIn(tables.accounts, m).length > 0) setCurrentSel(m) },
            })}
            {accountSeries.flatMap((s) => {
              const acc = tables.accounts.find((a) => a.id === s.accountId)
              if (!acc) return []
              const open = (m: MonthKey) => { if (s.months[m]) setBalanceSel({ accountId: acc.id, month: m }) }
              const marked = (m: MonthKey) => s.months[m]?.entered ?? false
              // an account left out of net worth says so after its name: the "Net worth" row does not count its balance
              if (acc.type === 'investment') {
                return [
                  derivedRow(T.valueLine(acc.name, !!s.outside), 'in', (m) => s.months[m]?.balance ?? null, { strong: true, currency: s.currency, onClick: open, mark: marked, hue: HUES.worth, help: 'balance.investmentValue' }),
                  ...(s.currency !== ccy ? [derivedRow(T.inCurrency(ccy), 'in', (m) => s.months[m]?.balanceBase ?? null, { muted: true, sub: acc.name, help: 'balance.inBase' })] : []),
                  derivedRow(T.deposited, 'in', (m) => s.months[m]?.capital ?? null, { muted: true, sub: acc.name, currency: s.currency, help: 'balance.deposited' }),
                  derivedRow(T.return, 'in', (m) => (s.months[m] ? Math.round((s.months[m].totalReturn ?? 0) * 10000) : null), { muted: true, sub: acc.name, format: (v) => (v === 0 ? '' : formatPercent(v / 10000, locale)), help: 'balance.return' }),
                ]
              }
              const label = acc.type === 'credit-card' ? T.owed(acc.name) : acc.type === 'loan' ? T.outstanding(acc.name) : T.accountLine(acc.name, !!s.outside)
              return [
                derivedRow(label, s.liability ? 'out' : 'in', (m) => s.months[m]?.balance ?? null, { strong: true, currency: s.currency, onClick: open, mark: marked, hue: HUES.worth, help: balanceHelp(acc.type) }),
                ...(s.currency !== ccy ? [derivedRow(T.inCurrency(ccy), s.liability ? 'out' : 'in', (m) => s.months[m]?.balanceBase ?? null, { muted: true, sub: acc.name, help: 'balance.inBase' })] : []),
              ]
            })}
            {poolSeries.flatMap((p) => {
              const pool = tables.pools.find((x) => x.id === p.poolId)
              // kept in the currency of the savings account that holds it (rule X14), with its worth in the household's beneath
              return [
                derivedRow(T.virtualAccount(pool?.name), 'in', (m) => p.months[m]?.balance ?? null, {
                  hue: HUES.pool, help: 'balance.pool', currency: p.currency,
                  warn: (m) => (p.months[m]?.short ? T.shortByMoreCame(formatAmount(p.months[m].short, p.currency, locale)) : null),
                }),
                ...(p.currency !== ccy ? [derivedRow(T.inCurrency(ccy), 'in', (m) => p.months[m]?.balanceBase ?? null, { muted: true, sub: T.virtualAccount(pool?.name), help: 'balance.inBase' })] : []),
              ]
            })}
            {(accountSeries.length > 0 || mainShown) && derivedRow(txt.common.netWorth, 'in', (m) => (engine.netWorth[m] != null && (engine.main?.months[m] || accountSeries.some((s) => s.months[m])) ? engine.netWorth[m] : null), { strong: true, hue: HUES.worth, band: true, help: 'derived.netWorth' })}
          </tbody>
        </table>
      </div>

      {balanceSel && (() => {
        const acc = tables.accounts.find((a) => a.id === balanceSel.accountId)
        const res = engine.accounts[balanceSel.accountId]?.months[balanceSel.month]
        return acc && res ? <BalanceDialog key={`${acc.id}:${balanceSel.month}`} account={acc} month={balanceSel.month} tables={tables} household={household} onClose={() => setBalanceSel(null)} /> : null
      })()}
      {currentSel && main?.months[currentSel] && (
        <CurrentBalanceDialog
          key={currentSel} title={mainAccountLabel(main, tables.accounts)} month={currentSel} tables={tables} household={household}
          onClose={() => setCurrentSel(null)}
        />
      )}
      {balancesFor && <MonthBalancesDialog key={balancesFor} month={balancesFor} tables={tables} engine={engine} household={household} onClose={() => setBalancesFor(null)} />}
      {selected && selectedRow && (
        <CellEditor key={`${selectedRow.id}:${selected.month}`} tables={tables} engine={engine} household={household} row={selectedRow} month={selected.month} onClose={() => setSelected(null)} />
      )}
      {notice.notice && <UndoNotice text={notice.notice} onUndo={() => act(() => store.undo())} onDismiss={notice.clear} />}
    </div>
  )
}

interface GridRowProps {
  row: Row
  /** The category group's faint fill (a hue's `band` class), on every other named group. */
  band?: string
  rIndex: number
  months: MonthKey[]
  engine: EngineOutput
  tables: Tables
  household: Household
  ccy: string
  locale: string
  neg: boolean
  /** The rule that works the row out, when it has one. */
  rule?: RuleState
  onSelect: (m: MonthKey) => void
  onError: (msg: string) => void
  /** The row menu restored an archived row: the sentence that says what came back. */
  onRestored: (text: string) => void
}

function GridRow({ row, band, rIndex, months, engine, tables, household, ccy, locale, neg, rule, onSelect, onError, onRestored }: GridRowProps) {
  const totals = engine.rowTotals[row.id]
  const flow = flowOf(row)
  const followed = row.followsRowId ? tables.rows.find((r) => r.id === row.followsRowId) : undefined
  /** The code after the name: this row's own currency, or the followed row's (a follower takes its target's). */
  const tagCcy = row.currency ?? followed?.currency ?? null
  const deductedFrom = row.deductedFromRowId ? tables.rows.find((r) => r.id === row.deductedFromRowId) : undefined
  const followShare = row.followShare != null && row.followShare !== 1 ? formatPercent(row.followShare, locale) : null
  const automatic = derivedRowReason(row, household.closingRule) !== null
  // "Rule…" opens the row's dialog in this month when it is shown, else in the shown month nearest to it
  const thisMonth = monthOfDate()
  const ruleMonth = months.find((m) => m >= thisMonth) ?? months[months.length - 1]
  /** A row a rule works out says which, the way a follower names its row. */
  const ruleTag = rule && rule.kind !== 'idle' ? ruleText({ ...rule, of: rule.ofRowId ? tables.rows.find((r) => r.id === rule.ofRowId && !r.deletedAt)?.name : undefined }, locale) : null
  /** On a schedule that has not ended: the Statement's repeat symbol, beside the name. */
  const running = runningSchedules(tables.recurringItems, row.id, thisMonth)
  const repeats = running.length ? T.repeats(repeatsText(running, locale)) : null
  return (
    <tr className={cn('group', band)}>
      <th scope="row" className={cn('sticky left-0 z-10 px-2 py-0.5 text-left font-normal', band ?? 'bg-card')}>
        <div className="flex items-center gap-1">
          <div className="min-w-0 flex-1">
            <div className="truncate text-xs font-medium">
              {row.name}{tagCcy && tagCcy !== ccy ? <span className="ml-1 text-[10px] font-normal text-muted-foreground">{tagCcy}</span> : null}
              {repeats ? <span role="img" aria-label={repeats} title={repeats} className="ml-1 inline-flex align-[-1px]" data-repeats><Repeat className="size-3 text-muted-foreground" aria-hidden /></span> : null}
              {followed ? <span className="ml-1 text-[10px] font-normal text-muted-foreground" title={T.followsTitle(followShare, followed.name)}>{T.followsTag(followShare, followed.name)}</span> : null}
              {deductedFrom ? <span className="ml-1 text-[10px] font-normal text-muted-foreground" title={T.deductedFrom(deductedFrom.name)}>{T.outOf(deductedFrom.name)}</span> : null}
              {ruleTag ? <span className="ml-1 text-[10px] font-normal text-muted-foreground" title={T.rule(ruleTag)}>= {ruleTag}</span> : null}
            </div>
            <div className="truncate text-[10px] leading-3 text-muted-foreground tabular-nums">
              {T.rowSum(formatAmount(totals?.total ?? 0, ccy, locale, { compact: true }), row.section !== 'income' && totals?.shareOfIncome ? formatPercent(totals.shareOfIncome, locale) : null)}
            </div>
          </div>
          {followed && <InfoTip help="row.follows" text={T.followsHelp(followShare, followed.name)} />}
          {deductedFrom && <InfoTip help="row.deductedFrom" />}
          {automatic && (isOldPocketShare(row)
            ? <InfoTip help="row.rule" text={T.aShareOfThe} />
            : <InfoTip help={row.kind === 'category-estimate' ? 'row.categoryEstimate' : row.kind === 'to-savings' && !isShareRule(rule?.kind) ? 'row.toSavingsPlug' : 'row.rule'} />)}
          <RowMenu row={row} tables={tables} household={household} onError={onError} onRestored={onRestored} onRule={() => onSelect(ruleMonth)} />
        </div>
      </th>
      {months.map((m, c) => {
        const cell = engine.cells[cellKey(row.id, m)]
        if (!cell) return <td key={m} />
        const past = isPastMonth(m, thisMonth)
        const isDerived = cell.source === 'derived'
        const isEmpty = cell.source === 'empty' || (cell.source === 'items' && cell.items.every((i) => i.skipped))
        const d = amountDisplay(cell.value, flow, cell.currency, locale, neg)
        // a second, muted line: the household-currency value of an amount typed in another currency
        const about = !isEmpty && cell.currency !== ccy ? formatAmount(cell.valueBase, ccy, locale, { compact: true }) : null
        // an income with deductions shows what is left instead
        const net = row.section === 'income' && cell.deductionsBase > 0 ? formatAmount(cell.netBase, ccy, locale, { compact: true }) : null
        // all of it recorded as converted (rule X10): what it came to, not what it is about
        const recorded = cell.recorded != null && cell.recorded.reduce((sum, p) => sum + p.amount, 0) === cell.value
        const sub = net ? { text: T.net(net), label: T.net(net) } : about ? (recorded ? { text: `= ${about}`, label: T.recordedAs(about) } : { text: `≈ ${about}`, label: T.about(about) }) : null
        // One mark only: a green dot for done in any month; the current month also shows red (nothing yet) and amber (partly).
        const dot = !isEmpty && (!isDerived || cell.value !== 0) && (m === thisMonth || cell.status === 'done') ? doneness(cell) : null
        return (
          <td key={m} className={cn('p-0', past && 'bg-muted/60')}>
            {cell.source === 'archived' ? null : isDerived ? (
              <div className={cn('relative flex flex-col items-end px-1.5 py-0.5 text-right tabular-nums', dot && 'pr-3', toneClass[d.tone])}>
                {dot && <DoneDot {...dot} className="absolute right-0.5 top-0.5" />}
                <span className={statusClass.derived}>{d.text}</span>
                {sub && <span className="whitespace-nowrap text-[10px] font-normal leading-3 text-muted-foreground">{sub.text}</span>}
              </div>
            ) : (
              <button
                type="button"
                data-cell={`${rIndex},${c}`}
                tabIndex={rIndex === 0 && c === 0 ? 0 : -1}
                aria-label={T.cellSaid(row.name, formatMonth(m, locale), isEmpty ? null : d.text, sub ? sub.label : null, dot ? doneLabel(dot) : null)}
                onClick={() => onSelect(m)}
                className={cn(
                  'relative flex w-full justify-end px-1.5 py-0.5 text-right tabular-nums outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
                  sub ? 'flex-col items-end' : 'items-center gap-1',
                  dot && 'pr-3',
                  isEmpty ? 'text-muted-foreground/40' : toneClass[d.tone],
                )}
              >
                {dot && <DoneDot {...dot} className="absolute right-0.5 top-0.5" />}
                <span className={cn(!isEmpty && statusClass[cell.status])}>{isEmpty ? '·' : d.text}</span>
                {sub && <span className="whitespace-nowrap text-[10px] font-normal leading-3 text-muted-foreground">{sub.text}</span>}
              </button>
            )}
          </td>
        )
      })}
    </tr>
  )
}
