import { useCallback, useEffect, useMemo, useRef, useState, type ComponentProps, type ReactNode } from 'react'
import { Lock, MoreHorizontal, Plus, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Chip } from '@/components/ui/chip'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { InfoTip } from '@/components/InfoTip'
import { MarksLegend } from '@/components/MarksLegend'
import { MonthPicker } from '@/components/MonthPicker'
import { PageHeader } from '@/components/PageHeader'
import { doneness, type DoneState } from '@/app/display'
import { formatMonth } from '@/app/format'
import { useStore } from '@/app/store'
import { clearHandedMonth, handedOverMonth } from '@/app/screens'
import { activeHousehold, defaultMonths, useEngine, useTables } from '@/app/useEngine'
import { useStoreVersion } from '@/app/useStoreVersion'
import { buildStatement, cellKey, currentAccountsIn, type GoalProgress, type StatementLine } from '@/engine'
import { isPocketRow, lastDayOfMonth, monthDiff, monthOfDate, resolveRules, type Account, type AccountType, type Goal, type GoalKind, type MonthKey, type Row, type Section } from '@/model'
import { accountSuggestions, addPlanYear, closeMonth, removeIfFree, reopenMonth, rowSuggestions, ruleRowOf, setCellDone, setDerivedDone, setItemStatus, setupSteps, updateHousehold, type RemovalTarget, type RowSuggestion, type RuleChoice, type RuleTarget, type SetupStepKey } from '@/store'
import { GoalDialog } from '@/features/goals/GoalDialog'
import { goalStatusLine } from '@/features/goals/goalText'
import { AddRowInline } from '@/features/grid/AddRowInline'
import { BalanceDialog } from '@/features/grid/BalanceDialog'
import { CurrentBalanceDialog } from '@/features/grid/CurrentBalanceDialog'
import { CellEditor } from '@/features/grid/CellEditor'
import { RowMenu } from '@/features/grid/RowMenu'
import { HouseholdAccountDialog } from '@/features/household/HouseholdAccountDialog'
import { PoolDialog } from '@/features/household/PoolsCard'
import { RemoveDialog } from '@/features/remove/RemoveDialog'
import { RuleDialog } from '@/features/rules/RuleDialog'
import { AddCategoryInline } from './AddCategoryInline'
import { CategoryMenu } from './CategoryMenu'
import { EstimateDialog } from './EstimateDialog'
import { PerPerson } from './PerPerson'
import { monthProgress, progressText } from './progress'
import { SetupStrip } from './SetupStrip'
import { StatementBand } from './StatementBand'
import { AccountSuggestionLines, SuggestionLines } from './SuggestionLines'
import { TopUpDialog } from './TopUpDialog'
import { LINE_MENU, type LineContext } from './StatementLine'

const walk = (lines: StatementLine[]): StatementLine[] => lines.flatMap((l) => [l, ...walk(l.children)])
/** What "Add account" offers under Assets, and "Add a card or loan" under Debts. */
const ASSET_TYPES: AccountType[] = ['checking', 'joint', 'savings', 'investment', 'other-asset', 'cash']
const DEBT_TYPES: AccountType[] = ['credit-card', 'loan']
const ADD = 'text-muted-foreground'

/**
 * The first screen: one month in accounting form (DESIGN.md §2 and §7). The month on top, money in beside money out,
 * and under it where things stand at the end of it, assets beside debts and net worth. Each half balances; the figures
 * come from `buildStatement`, which reads them off the engine. The month is worked here too: a tick marks a row or an
 * item done, a click on a line opens the cell editor to overwrite the amount or say how sure it is, the progress line
 * counts what is still open, and "Close month" locks it. With two or more adults, "Per person" closes the page.
 */
export function StatementScreen() {
  const store = useStore()
  const tables = useTables()
  const household = activeHousehold(tables)
  const months = useMemo(() => (household && tables ? defaultMonths(household, tables) : []), [household, tables])
  const engine = useEngine(tables, months)
  /** The month someone picked. Until then: today's month, or the first month while the household is being set up. */
  const [picked, setMonth] = useState<MonthKey | null>(() => handedOverMonth() as MonthKey | null)
  // a month handed over by the Grid ("Open in the Statement") is for this visit only
  useEffect(() => clearHandedMonth(), [])
  /** Lines someone opened or closed; the rest follow their own default. */
  const [openLines, setOpenLines] = useState<Record<string, boolean>>({})
  /** The row whose dialog is open: its amount and, for a row that can carry one, its rule (which may start on a choice). */
  const [editor, setEditor] = useState<{ rowId: string; start?: RuleChoice['kind'] } | null>(null)
  /** The goal dialog: an existing goal, or a new one starting on the line it was asked from. */
  const [goalEdit, setGoalEdit] = useState<{ goal: Goal | null; preset?: { kind: GoalKind; accountId?: string | null; poolId?: string | null } } | null>(null)
  const [removingGoal, setRemovingGoal] = useState<Goal | null>(null)
  const [balanceFor, setBalanceFor] = useState<string | null>(null)
  /** The real balances of the current accounts are being typed. */
  const [currentBalance, setCurrentBalance] = useState(false)
  /** The expense category whose estimate is being typed. */
  const [estimateFor, setEstimateFor] = useState<string | null>(null)
  /** An account or a virtual account that no row fills yet, asked how much goes to it: the short dialog that adds the row. */
  const [ruleFor, setRuleFor] = useState<RuleTarget | null>(null)
  /** For an account added a moment ago: the choice its rule dialog opens on. */
  const [ruleStart, setRuleStart] = useState<RuleChoice['kind'] | undefined>(undefined)
  /** An account being added from the lower half: where it was asked from says which types are on offer. */
  const [accountNew, setAccountNew] = useState<{ name?: string; type?: AccountType; types: AccountType[] } | null>(null)
  const [poolNew, setPoolNew] = useState(false)
  /** An account or a virtual account opened from the "…" on its line. */
  const [accountEdit, setAccountEdit] = useState<string | null>(null)
  const [poolEdit, setPoolEdit] = useState<string | null>(null)
  /** What "Archive or delete…" in one of those dialogs was pressed for. */
  const [removing, setRemoving] = useState<RemovalTarget | null>(null)
  /** What a one-click delete just removed, and the store's version right after it: the message goes with the next change. */
  const [deleted, setDeleted] = useState<{ name: string; version: number } | null>(null)
  const version = useStoreVersion(store)
  /** "Suggestions" in the toolbar, once it was pressed; until then they show while the household is being set up. */
  const [suggest, setSuggest] = useState<boolean | null>(null)
  /** The virtual account being topped up. */
  const [topUpFor, setTopUpFor] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const settingUp = household?.setupOpen ?? false
  const month = picked ?? (settingUp && household ? household.startMonth : monthOfDate())
  const idx = Math.max(0, months.indexOf(month) === -1 ? months.length - 1 : months.indexOf(month))
  const m = months[idx]
  const statement = useMemo(() => (tables && engine && m ? buildStatement(tables, engine, m) : null), [tables, engine, m])
  /** What each virtual account is short by in the month shown. */
  const shortNow = useMemo(() => {
    const out: Record<string, number> = {}
    if (engine && m) for (const [id, s] of Object.entries(engine.pools)) out[id] = s.months[m]?.short ?? 0
    return out
  }, [engine, m])
  const closedNow = statement?.closed ?? true
  // A virtual account that becomes short while this month is on screen (an expense was just typed, a set-aside lowered)
  // gets its top-up offered straight away. One that was short already when the month came into view only shows its tag.
  const seenShort = useRef<{ month: MonthKey | undefined; short: Record<string, number> }>({ month: undefined, short: {} })
  useEffect(() => {
    const seen = seenShort.current
    seenShort.current = { month: m, short: shortNow }
    if (seen.month !== m || closedNow) return
    const grown = Object.keys(shortNow).find((id) => shortNow[id] > (seen.short[id] ?? 0))
    if (grown) setTopUpFor(grown)
  }, [m, shortNow, closedNow])
  // Suggested rows sit where they will appear: under a group, or inside the category they belong to
  const showing = (suggest ?? household?.setupOpen ?? false) && !closedNow
  const suggestions = useMemo(() => {
    const byPlace = new Map<string, RowSuggestion[]>()
    if (tables) for (const s of rowSuggestions(tables)) byPlace.set(s.place, [...(byPlace.get(s.place) ?? []), s])
    return byPlace
  }, [tables])
  /** A category that has something usual to offer opens by itself, so the offer is seen. */
  const autoOpen = useMemo(() => new Set(showing ? [...suggestions].filter(([, list]) => list.some((s) => s.usual)).map(([place]) => place) : []), [showing, suggestions])
  const isOpen = useCallback((line: StatementLine) => openLines[line.id] ?? ((line.open ?? false) || autoOpen.has(line.id)), [openLines, autoOpen])
  const onToggle = useCallback((line: StatementLine) => setOpenLines((s) => ({ ...s, [line.id]: !(s[line.id] ?? ((line.open ?? false) || autoOpen.has(line.id))) })), [autoOpen])

  if (!tables || !household || !engine || !statement) return null
  const { locale, baseCurrency: ccy, displayExpensesNegative: neg } = household
  const progress = monthProgress(engine.rows, engine.cells, m)
  const horizon = engine.months.length ? monthDiff(m, engine.months[engine.months.length - 1]) : 0
  const goalText = (g: GoalProgress) => goalStatusLine(g, locale, horizon)
  const editing = editor ? engine.rows.find((r) => r.id === editor.rowId) : undefined
  const balanceAccount = balanceFor ? tables.accounts.find((a) => a.id === balanceFor) : undefined
  const mainLine = statement.position.left.lines.find((l) => l.id === 'main')
  const balanceResult = balanceFor ? engine.accounts[balanceFor]?.months[m] : undefined

  /** A row counts its items; an item is done or not; an empty line has nothing to tick. */
  function doneOf(line: StatementLine): { done: number; total: number; state: DoneState } | null {
    const cell = line.rowId ? engine!.cells[cellKey(line.rowId, m)] : undefined
    if (!cell) return null
    if (line.itemId) {
      if (line.skipped) return null
      const done = line.status === 'done' ? 1 : 0
      return { done, total: 1, state: done ? 'all' : 'none' }
    }
    return line.empty || cell.value === 0 ? null : doneness(cell)
  }

  /** One tick: a row, one of its items, or an automatic row's "moved" flag. */
  function onTick(line: StatementLine, done: boolean) {
    const row = engine!.rows.find((r) => r.id === line.rowId)
    const cell = row ? engine!.cells[cellKey(row.id, m)] : undefined
    if (!row || !cell) return
    setBusy(line.id)
    setError(null)
    const run = line.itemId
      ? setItemStatus(store, row.id, m, line.itemId, done ? 'done' : row.defaultStatus)
      : cell.source === 'derived' ? setDerivedDone(store, row.id, m, done) : setCellDone(store, row.id, m, done)
    run.catch((e) => setError(e instanceof Error ? e.message : 'Action failed')).finally(() => setBusy(null))
  }

  /** A new row opens its category and, in an open month, its dialog for the first amount (and, where it can carry one, its rule). */
  function onAdded(row: Row) {
    setOpenLines((s) => ({ ...s, [row.kind === 'pocket-money' ? 'pocket' : `cat:${row.section}:${row.categoryId ?? 'none'}`]: true }))
    if (!statement!.closed) setEditor({ rowId: row.id })
  }
  /** How much goes to an account: the dialog of the row that fills it, or the short one while nothing does. */
  function askRule(target: RuleTarget, start?: RuleChoice['kind']) {
    let row: Row | null = null
    try {
      row = ruleRowOf(tables!, target)
    } catch {
      // an account saved a moment ago is not in the tables yet, and one that cannot have a rule says so in the short dialog
    }
    if (row) return setEditor({ rowId: row.id, start })
    setRuleStart(start)
    setRuleFor(target)
  }
  /** A step of the setup strip: go to its part of the page, with the cursor in the first thing that can be filled. */
  function jump(selector: string) {
    const el = document.querySelector<HTMLElement>(selector)
    if (!el) return
    const part = el.closest('li') ?? el
    part.scrollIntoView({ block: 'start', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })
    part.querySelector<HTMLElement>('input, [data-testid="suggestions"] button, [data-testid^="foot-"] button')?.focus({ preventScroll: true })
  }
  function onStep(key: SetupStepKey) {
    if (key === 'income') return jump('[data-line="income"]')
    if (key === 'expenses') return jump('[data-line="expenses"]')
    if (key === 'accounts' || key === 'goals') return jump('[data-testid="band-assets"]')
    // where the rest goes: the row that takes it, or the first savings account; without one, a savings account first
    const restRowId = resolveRules(engine!.rows, household!.closingRule).restRowId
    const savings = tables!.accounts.find((a) => a.type === 'savings' && !a.deletedAt && !a.archivedMonth)
    if (statement!.closed) return jump('[data-testid="band-assets"]')
    if (restRowId) return setEditor({ rowId: restRowId })
    if (!savings) return setAccountNew({ name: 'Savings', type: 'savings', types: ASSET_TYPES })
    askRule({ accountId: savings.id }, 'rest')
  }
  /**
   * A suggested row came with its amount, so no editor opens; its category stays open once its suggestions are gone.
   * Pocket money added without an amount asks for its rule instead: an amount, or a percentage.
   */
  function onSuggested(row: Row, amount: number | null) {
    setOpenLines((s) => ({ ...s, [row.kind === 'pocket-money' ? 'pocket' : `cat:${row.section}:${row.categoryId ?? 'none'}`]: true }))
    if (isPocketRow(row) && !(amount != null && amount > 0) && !statement!.closed) setEditor({ rowId: row.id })
  }
  const suggested = (line: StatementLine) => (showing && m
    ? <SuggestionLines suggestions={suggestions.get(line.id) ?? []} label={line.label} month={m} currency={household!.baseCurrency} locale={household!.locale} onAdded={onSuggested} onError={setError} />
    : null)
  /**
   * A new savings or investment account is asked straight away how much goes to it. While nothing takes the rest of
   * the month yet, a savings account is offered it.
   */
  function onAccountSaved(account: Account) {
    if (statement!.closed || (account.type !== 'savings' && account.type !== 'investment')) return
    const restTaken = resolveRules(engine!.rows, household!.closingRule).restRowId !== null
    askRule({ accountId: account.id }, account.type === 'savings' && !restTaken ? 'rest' : undefined)
  }
  /** The rule sits on a row, so its symbol opens that row's dialog; an account or a virtual account that no row feeds yet gets one when the rule is saved. */
  function onRule(line: StatementLine) {
    if (line.rule?.rowId) setEditor({ rowId: line.rule.rowId })
    else if (line.poolId) askRule({ poolId: line.poolId })
    else if (line.accountId) askRule({ accountId: line.accountId })
  }
  const categoriesOf = (section: Section) => tables!.categories.filter((c) => !c.deletedAt && c.section === section)
  const addRow = (section: Section, over: Pick<ComponentProps<typeof AddRowInline>, 'label' | 'defaultCategoryId' | 'only' | 'without'> = {}) => (
    <AddRowInline section={section} categories={categoriesOf(section)} tables={tables!} household={household!} onError={setError} onAdded={onAdded} {...over} />
  )
  /** Things are added where they will appear: at the foot of a group, and inside a category for a row of that category. */
  function footer(line: StatementLine): ReactNode {
    if (line.id === 'income') return <>{suggested(line)}{addRow('income')}<AddCategoryInline section="income" onError={setError} /></>
    if (line.id === 'expenses') return <>{suggested(line)}{addRow('expense')}<AddCategoryInline section="expense" onError={setError} estimate={statement!.closed ? undefined : { month: m, currency: ccy, locale }} /></>
    // money taken out of an account has a section of its own on the left, so the right side does not offer it
    if (line.id === 'set-aside') return <>{suggested(line)}{addRow('transfer', { without: ['from-savings', 'from-investment'] })}</>
    if (line.id === 'from-accounts') return addRow('transfer', { only: ['from-savings', 'from-investment'] })
    if (line.kind === 'category' && line.id.startsWith('cat:')) {
      const [, section, categoryId] = line.id.split(':')
      if (categoryId === 'none') return addRow(section as Section, { label: 'Add row without a category' })
      return (
        <>
          {suggested(line)}
          {addRow(section as Section, { label: `Add row to ${line.label}`, defaultCategoryId: categoryId })}
          {section === 'expense' && !statement!.closed && (
            <Button variant="ghost" size="sm" className="text-muted-foreground" aria-label={`${line.budget != null ? 'Change' : 'Set'} estimate for ${line.label}`} onClick={() => setEstimateFor(categoryId)}>
              {line.budget != null ? 'Change estimate' : 'Set estimate'}
            </Button>
          )}
        </>
      )
    }
    return null
  }

  /** A goal starts on the line it was asked from: a virtual account, an account to grow, a debt to clear, or net worth. */
  function onGoal(line: StatementLine, g?: GoalProgress) {
    if (g) return setGoalEdit({ goal: g.goal })
    if (line.poolId) return setGoalEdit({ goal: null, preset: { kind: 'pool-balance', poolId: line.poolId } })
    if (line.accountId) return setGoalEdit({ goal: null, preset: { kind: engine!.accounts[line.accountId]?.liability ? 'pay-off' : 'account-balance', accountId: line.accountId } })
    setGoalEdit({ goal: null, preset: { kind: 'net-worth' } })
  }

  /** A one-click delete went through: say what is gone, with the way back, until something else changes. */
  const onDeleted = (name: string) => setDeleted({ name, version: store.getVersion() })
  /**
   * Removing from an account's or a virtual account's dialog. While the household is being set up it is one click, unless
   * more than the thing itself would change; then, and always afterwards, the remove dialog asks.
   */
  function removeFrom(target: RemovalTarget) {
    if (!settingUp) return setRemoving(target)
    act(async () => {
      const name = await removeIfFree(store, target)
      if (name == null) setRemoving(target)
      else onDeleted(name)
    })
  }
  /** The "…" after a row's name: the Grid's own row menu. */
  function rowMenu(rowId: string): ReactNode {
    const row = engine!.rows.find((r) => r.id === rowId)
    return row ? <RowMenu row={row} tables={tables!} household={household!} onError={setError} onDeleted={onDeleted} onRule={() => setEditor({ rowId })} triggerClassName={LINE_MENU} /> : null
  }
  const editButton = (label: string, onClick: () => void) => (
    <Button variant="ghost" size="icon" className={LINE_MENU} aria-label={`Edit ${label}`} title="Edit" onClick={onClick}><MoreHorizontal /></Button>
  )
  /** The "…" after any other line's name: a category's menu, or the way into an account's or a virtual account's dialog. */
  function lineMenu(line: StatementLine): ReactNode {
    if (statement!.closed) return null
    if (line.kind === 'category' && line.id.startsWith('cat:')) {
      const category = tables!.categories.find((c) => c.id === line.id.split(':')[2] && !c.deletedAt)
      return category ? <CategoryMenu category={category} tables={tables!} household={household!} onError={setError} onDeleted={onDeleted} triggerClassName={LINE_MENU} /> : null
    }
    if (line.kind === 'pool' && line.poolId) return editButton(line.label, () => setPoolEdit(line.poolId!))
    if (line.kind === 'account' && line.accountId) return editButton(line.label, () => setAccountEdit(line.accountId!))
    // the calculated line stands for the current accounts: one opens straight away, several are listed
    if (line.id === 'main') {
      const current = (engine!.main?.accountIds ?? []).map((id) => tables!.accounts.find((a) => a.id === id && !a.deletedAt)).filter((a): a is Account => !!a)
      if (current.length === 0) return null
      if (current.length === 1) return editButton(current[0].name, () => setAccountEdit(current[0].id))
      return (
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button variant="ghost" size="icon" className={LINE_MENU} aria-label="Edit a current account" />}><MoreHorizontal /></DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-max">
            {current.map((a) => <DropdownMenuItem key={a.id} onClick={() => setAccountEdit(a.id)}>Edit {a.name}…</DropdownMenuItem>)}
          </DropdownMenuContent>
        </DropdownMenu>
      )
    }
    return null
  }
  const accountEditing = accountEdit ? tables.accounts.find((a) => a.id === accountEdit && !a.deletedAt) : undefined
  const poolEditing = poolEdit ? tables.pools.find((p) => p.id === poolEdit && !p.deletedAt) : undefined

  // a closed month shows its rules and changes none
  const base = { locale, ccy, isOpen, onToggle, goalText, onRule: statement.closed ? undefined : onRule, onTopUp: statement.closed ? undefined : setTopUpFor }
  const flowCtx: LineContext = { ...base, withChange: false, closed: statement.closed, doneOf, onTick, onEdit: (rowId) => setEditor({ rowId }), busy, footer, onEstimate: setEstimateFor, rowMenu, menu: lineMenu }
  // the estimate dialog reads the category's line: what the month shows now, and what its rows explain
  const estimateCategory = estimateFor ? tables.categories.find((c) => c.id === estimateFor && !c.deletedAt) : undefined
  const estimateLine = estimateFor ? walk(statement.flow.right.lines).find((l) => l.id === `cat:expense:${estimateFor}`) : undefined
  const estimateRest = estimateLine?.children.find((l) => l.estimateFor != null)?.amount ?? 0
  // a card or a loan is added under Debts; while the household owes nothing, at the foot of that side
  const hasDebts = statement.position.right.lines.some((l) => l.id === 'debts')
  const debtsFoot = <Button variant="ghost" size="sm" className={ADD} onClick={() => setAccountNew({ types: DEBT_TYPES })}><Plus /> Add a card or loan</Button>
  const positionCtx: LineContext = { ...base, withChange: true, onGoal, onBalance: setBalanceFor, onCurrentBalance: () => setCurrentBalance(true), footer: (line) => (line.id === 'debts' ? debtsFoot : null), menu: lineMenu }
  const day = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${lastDayOfMonth(m)}T00:00:00Z`))
  const foldable = walk([...statement.flow.left.lines, ...statement.flow.right.lines, ...statement.position.left.lines, ...statement.position.right.lines])
    .filter((l) => l.kind !== 'group' && (l.children.length > 0 || !!l.goals?.length || autoOpen.has(l.id)))
  const setAll = (open: boolean) => setOpenLines(Object.fromEntries(foldable.map((l) => [l.id, open])))
  const act = (fn: () => Promise<unknown>) => void fn().catch((e) => setError(e instanceof Error ? e.message : 'Action failed'))
  // Accounts are added where they will show: what the household has under Assets, what it owes under Debts
  const savingsAccounts = tables.accounts.filter((a) => a.type === 'savings' && !a.deletedAt && !a.archivedMonth)
  const assetsFoot = (
    <>
      {showing && <AccountSuggestionLines suggestions={accountSuggestions(tables)} onAdd={(s) => setAccountNew({ name: s.name, type: s.type, types: ASSET_TYPES })} onError={setError} />}
      <Button variant="ghost" size="sm" className={ADD} onClick={() => setAccountNew({ types: ASSET_TYPES })}><Plus /> Add account</Button>
      {savingsAccounts.length > 0 && <Button variant="ghost" size="sm" className={ADD} onClick={() => setPoolNew(true)}><Plus /> Add virtual account</Button>}
    </>
  )
  // the account a rule is asked for may have been saved a moment ago: wait until it is on the page
  const ruleReady = !!ruleFor && (!('accountId' in ruleFor) || tables.accounts.some((a) => a.id === ruleFor.accountId))

  return (
    <div className="space-y-4">
      <PageHeader title="Statement" subline={<>{household.name}{statement.closed && <> · <Chip tone="zinc"><Lock aria-hidden /> closed</Chip></>}</>}>
        <MonthPicker months={months} month={m} onChange={setMonth} locale={locale} onAddYear={() => act(() => addPlanYear(store))} />
        <Button size="xs" variant="outline" onClick={() => setAll(true)}>Expand all</Button>
        <Button size="xs" variant="outline" onClick={() => setAll(false)}>Collapse all</Button>
        <span className="flex items-center gap-1">
          <Button size="xs" variant={showing ? 'default' : 'outline'} aria-pressed={showing} disabled={statement.closed} title={statement.closed ? 'A closed month takes no new rows.' : undefined} onClick={() => setSuggest(!showing)}>Suggestions</Button>
          <InfoTip help="statement.suggestions" />
        </span>
        <MarksLegend neg={neg} />
        {/* a household that is still being set up has nothing to close yet; a closed month can always be reopened */}
        {statement.closed ? (
          <Button size="sm" variant="outline" onClick={() => act(() => reopenMonth(store, m))}>Reopen month</Button>
        ) : !settingUp && (
          <Button size="sm" onClick={() => act(() => closeMonth(store, m))}>Close month</Button>
        )}
        {error && <p role="alert" className="basis-full text-destructive">{error}</p>}
        {statement.warnings.map((w) => <p key={w} className="basis-full text-amber-700">{w}</p>)}
      </PageHeader>

      {/* How much of the month is ticked and what is still open; a month with nothing in it has nothing to count */}
      {(statement.closed || progress.total > 0) && (
        <p role="status" className="flex items-center gap-1 text-xs text-muted-foreground" data-testid="progress">
          <span>{progressText(progress, statement.closed, ccy, locale)}</span>
          <InfoTip help="statement.progress" />
        </p>
      )}

      {settingUp && (
        <SetupStrip
          steps={setupSteps(tables)} monthName={formatMonth(m, locale, 'long')} first={m === household.startMonth} noSavings={savingsAccounts.length === 0}
          onStep={onStep}
          // the month stays where it is once the strip is gone
          onDone={() => { setMonth(m); act(() => updateHousehold(store, { setupOpen: false })) }}
        />
      )}
      <StatementBand title="The month" help="statement.month" band={statement.flow} ctx={flowCtx} totals={['Total in', 'Total out']} />
      <StatementBand title="At the end of the month" help="statement.position" band={statement.position} ctx={positionCtx} totals={['Total', 'Total']} amountHead={day} feet={[assetsFoot, hasDebts ? null : debtsFoot]} />
      <PerPerson household={household} tables={tables} engine={engine} month={m} />

      {/* What a one-click delete took away, with the way back. It floats at the foot of the window, because the thing
          that was deleted can be anywhere on a long page; it goes with the next change. */}
      {deleted && deleted.version === version && (
        <div role="status" className="fixed bottom-20 left-1/2 z-40 flex max-w-[calc(100vw-2rem)] -translate-x-1/2 items-center gap-2 rounded-lg border bg-card py-1.5 pl-3 pr-1.5 text-xs shadow-md md:bottom-6">
          <span className="min-w-0 truncate">Deleted "{deleted.name}".</span>
          <Button size="xs" variant="outline" onClick={() => act(() => store.undo())}>Undo</Button>
          <button
            type="button" aria-label="Dismiss" onClick={() => setDeleted(null)}
            className="inline-flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring pointer-coarse:size-8"
          >
            <X className="size-3.5" aria-hidden />
          </button>
        </div>
      )}
      {editing && <CellEditor key={`${editing.id}:${m}`} tables={tables} engine={engine} household={household} row={editing} month={m} startRule={editor?.start} onClose={() => setEditor(null)} />}
      {goalEdit && (
        <GoalDialog
          household={household} tables={tables} goal={goalEdit.goal} preset={goalEdit.preset} onClose={() => setGoalEdit(null)}
          onRemove={goalEdit.goal ? () => { setRemovingGoal(goalEdit.goal); setGoalEdit(null) } : undefined}
        />
      )}
      {balanceAccount && balanceResult && (
        <BalanceDialog key={`${balanceAccount.id}:${m}`} account={balanceAccount} month={m} result={balanceResult} locale={locale} closed={statement.closed} onClose={() => setBalanceFor(null)} />
      )}
      {currentBalance && mainLine && engine.main?.months[m] && (
        <CurrentBalanceDialog
          key={m} title={mainLine.label} accounts={currentAccountsIn(tables.accounts, m)} month={m} result={engine.main.months[m]} actuals={tables.accountMonths}
          baseCurrency={ccy} locale={locale} closed={statement.closed} onClose={() => setCurrentBalance(false)}
        />
      )}
      {estimateCategory && (
        <EstimateDialog
          key={`${estimateCategory.id}:${m}`} category={estimateCategory} month={m} household={household} closed={statement.closed}
          current={estimateLine?.budget ?? 0} rows={(estimateLine?.amount ?? 0) - estimateRest} onClose={() => setEstimateFor(null)}
        />
      )}
      {ruleFor && ruleReady && <RuleDialog key={JSON.stringify(ruleFor)} tables={tables} household={household} target={ruleFor} month={m} start={ruleStart} onClose={() => { setRuleFor(null); setRuleStart(undefined) }} />}
      {accountNew && (
        <HouseholdAccountDialog
          account={null} entities={tables.entities} baseCurrency={ccy} locale={locale} startMonth={household.startMonth} preset={accountNew}
          onClose={() => setAccountNew(null)} onSaved={onAccountSaved}
        />
      )}
      {poolNew && <PoolDialog pool={null} savings={savingsAccounts} baseCurrency={ccy} locale={locale} fromMonth={statement.closed ? undefined : m} onClose={() => setPoolNew(false)} onError={setError} />}
      {topUpFor && <TopUpDialog key={`${topUpFor}:${m}`} tables={tables} engine={engine} household={household} poolId={topUpFor} month={m} onClose={() => setTopUpFor(null)} />}
      {accountEditing && (
        <HouseholdAccountDialog
          key={accountEditing.id} account={accountEditing} entities={tables.entities} baseCurrency={ccy} locale={locale} startMonth={household.startMonth}
          onClose={() => setAccountEdit(null)} removeLabel={settingUp ? 'Delete' : undefined}
          onRemove={() => { setAccountEdit(null); removeFrom({ kind: 'account', id: accountEditing.id }) }}
        />
      )}
      {poolEditing && (
        <PoolDialog
          key={poolEditing.id} pool={poolEditing} savings={savingsAccounts} baseCurrency={ccy} locale={locale} onError={setError}
          onClose={() => setPoolEdit(null)} removeLabel={settingUp ? 'Delete' : undefined}
          onRemove={() => { setPoolEdit(null); removeFrom({ kind: 'pool', id: poolEditing.id }) }}
        />
      )}
      {removing && <RemoveDialog target={removing} tables={tables} household={household} onClose={() => setRemoving(null)} />}
      {removingGoal && <RemoveDialog target={{ kind: 'goal', id: removingGoal.id }} tables={tables} household={household} onClose={() => setRemovingGoal(null)} />}
    </div>
  )
}
