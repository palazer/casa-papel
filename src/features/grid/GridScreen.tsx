import { useMemo, useState, type KeyboardEvent, type ReactNode } from 'react'
import { ChevronDown, ChevronRight, Lock } from 'lucide-react'
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
import { handMonth, useScreen } from '@/app/screens'
import { useStore } from '@/app/store'
import { activeHousehold, defaultMonths, useEngine, useTables } from '@/app/useEngine'
import { cellKey, currentAccountsIn, groupRowsByCategory, mainAccountLabel, type EngineOutput } from '@/engine'
import { isOldPocketShare, isShareRule, monthOfDate, parseMonth, resolveRules, type Household, type Money, type MonthKey, type Row, type RuleState, type Section, type Tables } from '@/model'
import { addPlanYear, closeMonth, derivedRowReason, reopenMonth } from '@/store'
import { AddRowInline } from './AddRowInline'
import { BalanceDialog } from './BalanceDialog'
import { CurrentBalanceDialog } from './CurrentBalanceDialog'
import { CellEditor } from './CellEditor'
import { RowMenu } from './RowMenu'
import { amountDisplay, doneLabel, doneness, flowOf, ruleText, statusClass, toneClass, type Flow } from '@/app/display'
import { DoneDot } from '@/components/DoneDot'

const SECTIONS: Array<{ key: Section; title: string }> = [
  { key: 'income', title: 'Income' },
  { key: 'expense', title: 'Expenses' },
  { key: 'transfer', title: 'Transfers' },
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
  const [error, setError] = useState<string | null>(null)
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

  const act = (fn: () => Promise<unknown>) => void fn().catch((err) => setError(err instanceof Error ? err.message : 'Action failed'))

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
        if (v == null) return <td key={m} className={cn('p-0', engine.totals[m]?.closed && 'bg-muted/60')} />
        const d = amountDisplay(v, flow, opts.currency ?? ccy, locale, neg)
        const text = opts.format ? opts.format(v, m) : d.text
        const marked = opts.mark?.(m) ?? false
        // a balance that needs attention (a virtual account that was asked for more than it held) takes the expense hue and says why
        const warning = opts.warn?.(m) ?? null
        return (
          <td key={m} title={warning ?? undefined} className={cn('p-0 text-right tabular-nums', toneClass[d.tone], warning && 'text-expense', opts.muted && 'text-[11px]', opts.sub && 'text-muted-foreground', engine.totals[m]?.closed && 'bg-muted/60')}>
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
      <PageHeader title="Grid" subline={`${household.name} · ${formatMonth(months[0], locale)} – ${formatMonth(months[months.length - 1], locale)}`}>
        {earlier > 0 && (
          <Button size="xs" variant={showEarlier ? 'default' : 'outline'} aria-pressed={showEarlier} title={showEarlier ? 'Start at the current month again' : 'Show the months before the current one'} onClick={toggleEarlier}>
            Earlier months ({earlier})
          </Button>
        )}
        <Button size="xs" variant="outline" onClick={() => act(() => addPlanYear(store))}>Add {parseMonth(months[months.length - 1]).year + 1}</Button>
        <span className="text-muted-foreground">Click a cell to edit · arrows move · Enter opens · click a month name to open it in the Statement, or to close or reopen it</span>
        <MarksLegend neg={neg} />
        {engine.warnings.length > 0 && <p role="alert" className="basis-full text-amber-700 dark:text-amber-400">{engine.warnings.join(' · ')}</p>}
        {error && (
          <p role="alert" className="flex basis-full items-center gap-2 text-destructive">
            <span>{error}</span>
            <Button size="xs" variant="outline" onClick={() => setError(null)}>Dismiss</Button>
          </p>
        )}
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
                        render={<button className="inline-flex w-full items-center justify-end gap-1 rounded px-1 py-0.5 hover:bg-muted" aria-label={`${formatMonth(m, locale)}${t?.closed ? ', closed' : ''}`} />}
                      >
                        {t?.closed && <Lock className="size-3 text-muted-foreground" aria-hidden />}
                        <span className={cn(isToday ? 'font-semibold text-foreground' : 'text-muted-foreground')}>{formatMonth(m, locale)}</span>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuGroup>
                          <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
                            Income {formatAmount(t?.income ?? 0, ccy, locale, { compact: true })} · Expenses {formatAmount(t?.expensesTotal ?? 0, ccy, locale, { compact: true })}
                          </DropdownMenuLabel>
                        </DropdownMenuGroup>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem onClick={() => { handMonth(m); go('statement') }}>Open in the Statement</DropdownMenuItem>
                        {t?.closed ? (
                          <DropdownMenuItem onClick={() => act(() => reopenMonth(store, m))}>Reopen month</DropdownMenuItem>
                        ) : (
                          <DropdownMenuItem onClick={() => act(() => closeMonth(store, m))}>Close month</DropdownMenuItem>
                        )}
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
                      <td className={cn('sticky left-0 z-10 px-2 pb-0 pt-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground', bandOf(g.band) ?? 'bg-card')}>{g.category?.name ?? 'No category'}</td>
                      <td colSpan={months.length} />
                    </tr>
                  ),
                  ...g.rows.map((row) => <GridRow key={row.id} row={row} band={bandOf(g.band)} rIndex={editableIndex++} months={months} engine={engine} tables={tables} household={household} ccy={ccy} locale={locale} neg={neg} rule={rules?.byRow.get(row.id)} onSelect={(m) => setSelected({ rowId: row.id, month: m })} onError={setError} />),
                ])),
                !isCollapsed && (
                  <tr key={`${key}-add`}>
                    <td className="sticky left-0 z-10 bg-card px-1 py-0.5"><AddRowInline section={key} categories={sectionCategories} tables={tables} household={household} onError={setError} /></td>
                    <td colSpan={months.length} />
                  </tr>
                ),
                key === 'income' && derivedRow('Income total', 'in', (m) => engine.totals[m].income, { strong: true, hue: HUES.income, band: true, help: 'derived.incomeTotal' }),
                key === 'expense' && derivedRow('Expenses total', 'out', (m) => engine.totals[m].expensesTotal, { strong: true, hue: HUES.expense, band: true, help: 'derived.expensesTotal' }),
                key === 'expense' && months.some((m) => engine.totals[m].fromSavingsDerived !== 0) && derivedRow('of which from savings & virtual accounts', 'in', (m) => engine.totals[m].fromSavingsDerived, { muted: true, hue: HUES.pool, help: 'derived.fromSavings' }),
                key === 'transfer' && derivedRow(household.closingRule === 'savings-plug' ? 'Kept in account' : 'Leftover', 'in', (m) => engine.totals[m].leftover, { strong: true, hue: HUES.transfer, band: true, help: household.closingRule === 'savings-plug' ? 'derived.keptInAccount' : 'derived.leftover' }),
              ]
            })}

            {(mainShown || accountSeries.length > 0 || poolSeries.length > 0) && (
              <tr>
                <th scope="row" className={cn('sticky left-0 z-10 border-t bg-card px-2 py-1.5 text-left text-xs font-semibold', HUES.worth.text)}>Balances</th>
                <td colSpan={months.length} className="border-t" />
              </tr>
            )}
            {main && mainShown && derivedRow(mainAccountLabel(main, tables.accounts), 'in', (m) => main.months[m]?.balance ?? null, {
              strong: true, hue: HUES.worth, help: 'statement.mainAccount', mark: (m) => main.months[m]?.entered ?? false,
              // a month takes real balances once a current account exists in it
              onClick: (m) => { if (currentAccountsIn(tables.accounts, m).length > 0) setCurrentSel(m) },
            })}
            {accountSeries.flatMap((s) => {
              const acc = tables.accounts.find((a) => a.id === s.accountId)
              if (!acc) return []
              const open = (m: MonthKey) => { if (s.months[m]) setBalanceSel({ accountId: acc.id, month: m }) }
              const marked = (m: MonthKey) => (s.months[m]?.adjustment ?? 0) !== 0 || s.months[m]?.projected === false
              if (acc.type === 'investment') {
                return [
                  derivedRow(`${acc.name} · value`, 'in', (m) => s.months[m]?.balance ?? null, { strong: true, currency: s.currency, onClick: open, mark: marked, hue: HUES.worth, help: 'balance.investmentValue' }),
                  ...(s.currency !== ccy ? [derivedRow(`in ${ccy}`, 'in', (m) => s.months[m]?.balanceBase ?? null, { muted: true, sub: acc.name, help: 'balance.inBase' })] : []),
                  derivedRow('Deposited', 'in', (m) => s.months[m]?.capital ?? null, { muted: true, sub: acc.name, currency: s.currency, help: 'balance.deposited' }),
                  derivedRow('Return', 'in', (m) => (s.months[m] ? Math.round((s.months[m].totalReturn ?? 0) * 10000) : null), { muted: true, sub: acc.name, format: (v) => (v === 0 ? '' : formatPercent(v / 10000, locale)), help: 'balance.return' }),
                ]
              }
              const label = acc.type === 'credit-card' ? `${acc.name} · owed` : acc.type === 'loan' ? `${acc.name} · outstanding` : acc.name
              return [
                derivedRow(label, s.liability ? 'out' : 'in', (m) => s.months[m]?.balance ?? null, { strong: true, currency: s.currency, onClick: open, mark: marked, hue: HUES.worth, help: balanceHelp(acc.type) }),
                ...(s.currency !== ccy ? [derivedRow(`in ${ccy}`, s.liability ? 'out' : 'in', (m) => s.months[m]?.balanceBase ?? null, { muted: true, sub: acc.name, help: 'balance.inBase' })] : []),
              ]
            })}
            {poolSeries.map((p) => {
              const pool = tables.pools.find((x) => x.id === p.poolId)
              return derivedRow(`Virtual account · ${pool?.name ?? ''}`, 'in', (m) => p.months[m]?.balance ?? null, {
                hue: HUES.pool, help: 'balance.pool',
                warn: (m) => (p.months[m]?.short ? `Short by ${formatAmount(p.months[m].short, ccy, locale)}: more came out of it than it held. Top it up on the Statement.` : null),
              })
            })}
            {(accountSeries.length > 0 || mainShown) && derivedRow('Net worth', 'in', (m) => (engine.netWorth[m] != null && (engine.main?.months[m] || accountSeries.some((s) => s.months[m])) ? engine.netWorth[m] : null), { strong: true, hue: HUES.worth, band: true, help: 'derived.netWorth' })}
          </tbody>
        </table>
      </div>

      {balanceSel && (() => {
        const acc = tables.accounts.find((a) => a.id === balanceSel.accountId)
        const res = engine.accounts[balanceSel.accountId]?.months[balanceSel.month]
        return acc && res ? <BalanceDialog key={`${acc.id}:${balanceSel.month}`} account={acc} month={balanceSel.month} result={res} locale={locale} closed={engine.totals[balanceSel.month]?.closed ?? false} onClose={() => setBalanceSel(null)} /> : null
      })()}
      {currentSel && main?.months[currentSel] && (
        <CurrentBalanceDialog
          key={currentSel} title={mainAccountLabel(main, tables.accounts)} accounts={currentAccountsIn(tables.accounts, currentSel)} month={currentSel} result={main.months[currentSel]}
          actuals={tables.accountMonths} baseCurrency={ccy} locale={locale} closed={engine.totals[currentSel]?.closed ?? false} onClose={() => setCurrentSel(null)}
        />
      )}
      {selected && selectedRow && (
        <CellEditor key={`${selectedRow.id}:${selected.month}`} tables={tables} engine={engine} household={household} row={selectedRow} month={selected.month} onClose={() => setSelected(null)} />
      )}
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
}

function GridRow({ row, band, rIndex, months, engine, tables, household, ccy, locale, neg, rule, onSelect, onError }: GridRowProps) {
  const totals = engine.rowTotals[row.id]
  const flow = flowOf(row)
  const followed = row.followsRowId ? tables.rows.find((r) => r.id === row.followsRowId) : undefined
  /** The code after the name: this row's own currency, or the followed row's (a follower takes its target's). */
  const tagCcy = row.currency ?? followed?.currency ?? null
  const deductedFrom = row.deductedFromRowId ? tables.rows.find((r) => r.id === row.deductedFromRowId) : undefined
  const shareTag = row.followShare != null && row.followShare !== 1 ? `${formatPercent(row.followShare, locale)} of ` : ''
  const automatic = derivedRowReason(row, household.closingRule) !== null
  // "Rule…" opens the row's dialog in a month that can still change: this month when it is shown and open, else the first open one
  const thisMonth = monthOfDate()
  const openMonth = (m: MonthKey) => !engine.totals[m]?.closed
  const ruleMonth = months.find((m) => m === thisMonth && openMonth(m)) ?? months.find((m) => m > thisMonth && openMonth(m)) ?? months.find(openMonth) ?? months[0]
  /** A row a rule works out says which, the way a follower names its row. */
  const ruleTag = rule && rule.kind !== 'idle' ? ruleText({ ...rule, of: rule.ofRowId ? tables.rows.find((r) => r.id === rule.ofRowId && !r.deletedAt)?.name : undefined }, locale) : null
  return (
    <tr className={cn('group', band)}>
      <th scope="row" className={cn('sticky left-0 z-10 px-2 py-0.5 text-left font-normal', band ?? 'bg-card')}>
        <div className="flex items-center gap-1">
          <div className="min-w-0 flex-1">
            <div className="truncate text-xs font-medium">
              {row.name}{tagCcy && tagCcy !== ccy ? <span className="ml-1 text-[10px] font-normal text-muted-foreground">{tagCcy}</span> : null}
              {followed ? <span className="ml-1 text-[10px] font-normal text-muted-foreground" title={`${shareTag ? `${shareTag}the amount of` : 'Same amount as'} ${followed.name}`}>= {shareTag}{followed.name}</span> : null}
              {deductedFrom ? <span className="ml-1 text-[10px] font-normal text-muted-foreground" title={`Deducted from ${deductedFrom.name}`}>out of {deductedFrom.name}</span> : null}
              {ruleTag ? <span className="ml-1 text-[10px] font-normal text-muted-foreground" title={`Rule: ${ruleTag}`}>= {ruleTag}</span> : null}
            </div>
            <div className="truncate text-[10px] leading-3 text-muted-foreground tabular-nums">
              Σ {formatAmount(totals?.total ?? 0, ccy, locale, { compact: true })}{row.section !== 'income' && totals?.shareOfIncome ? ` · ${formatPercent(totals.shareOfIncome, locale)} of income` : ''}
            </div>
          </div>
          {followed && <InfoTip help="row.follows" text={`${shareTag ? `${shareTag}the amount of` : 'Same amount as'} "${followed.name}" every month. Edit that row; this one has no amount of its own.`} />}
          {deductedFrom && <InfoTip help="row.deductedFrom" />}
          {automatic && (isOldPocketShare(row)
            ? <InfoTip help="row.rule" text={'A share of the pocket money total the household had before. Give it an amount or a rule of its own: row menu, "Rule…".'} />
            : <InfoTip help={row.kind === 'category-estimate' ? 'row.categoryEstimate' : row.kind === 'to-savings' && !isShareRule(rule?.kind) ? 'row.toSavingsPlug' : 'row.rule'} />)}
          <RowMenu row={row} tables={tables} household={household} onError={onError} onRule={() => onSelect(ruleMonth)} />
        </div>
      </th>
      {months.map((m, c) => {
        const cell = engine.cells[cellKey(row.id, m)]
        if (!cell) return <td key={m} />
        const today = monthOfDate()
        const closed = engine.totals[m]?.closed
        const isDerived = cell.source === 'derived'
        const isEmpty = cell.source === 'empty' || (cell.source === 'items' && cell.items.every((i) => i.skipped))
        const d = amountDisplay(cell.value, flow, cell.currency, locale, neg)
        // a second, muted line: the household-currency value of an amount typed in another currency
        const about = !isEmpty && cell.currency !== ccy ? formatAmount(cell.valueBase, ccy, locale, { compact: true }) : null
        // an income with deductions shows what is left instead
        const net = row.section === 'income' && cell.deductionsBase > 0 ? formatAmount(cell.netBase, ccy, locale, { compact: true }) : null
        const sub = net ? { text: `net ${net}`, label: `net ${net}` } : about ? { text: `≈ ${about}`, label: `about ${about}` } : null
        // One mark only: a green dot for done in any month; the current month also shows red (nothing yet) and amber (partly).
        const dot = !isEmpty && (!isDerived || cell.value !== 0) && ((m === today && !closed) || cell.status === 'done') ? doneness(cell) : null
        return (
          <td key={m} className={cn('p-0', closed && 'bg-muted/60')}>
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
                aria-label={`${row.name} ${formatMonth(m, locale)}: ${isEmpty ? 'empty' : d.text}${sub ? `, ${sub.label}` : ''}${dot ? `, ${doneLabel(dot)}` : ''}`}
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
