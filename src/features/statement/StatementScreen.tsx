import { useCallback, useEffect, useMemo, useRef, useState, type ComponentProps, type ReactNode } from 'react'
import { Lock, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Chip } from '@/components/ui/chip'
import { InfoTip } from '@/components/InfoTip'
import { MonthPicker } from '@/components/MonthPicker'
import { PageHeader } from '@/components/PageHeader'
import { doneness, type DoneState } from '@/app/display'
import { useStore } from '@/app/store'
import { activeHousehold, defaultMonths, useEngine, useTables } from '@/app/useEngine'
import { buildStatement, cellKey, computeMainAccount, type GoalProgress, type StatementLine } from '@/engine'
import { canCarryRule, lastDayOfMonth, monthDiff, monthOfDate, resolveRules, type Account, type AccountType, type Goal, type GoalKind, type MonthKey, type Row, type Section } from '@/model'
import { addPlanYear, setCellDone, setDerivedDone, setItemStatus, type RuleChoice, type RuleTarget } from '@/store'
import { GoalDialog } from '@/features/goals/GoalDialog'
import { goalStatusLine } from '@/features/goals/goalText'
import { AddRowInline } from '@/features/grid/AddRowInline'
import { BalanceDialog } from '@/features/grid/BalanceDialog'
import { CellEditor } from '@/features/grid/CellEditor'
import { HouseholdAccountDialog } from '@/features/household/HouseholdAccountDialog'
import { PoolDialog } from '@/features/household/PoolsCard'
import { RemoveDialog } from '@/features/remove/RemoveDialog'
import { RuleDialog } from '@/features/rules/RuleDialog'
import { AddCategoryInline } from './AddCategoryInline'
import { EstimateDialog } from './EstimateDialog'
import { StatementBand } from './StatementBand'
import { TopUpDialog } from './TopUpDialog'
import { ESTIMATE_SHADE, type LineContext } from './StatementLine'

const walk = (lines: StatementLine[]): StatementLine[] => lines.flatMap((l) => [l, ...walk(l.children)])
/** What "Add account" offers under Assets, and "Add a card or loan" under Debts. */
const ASSET_TYPES: AccountType[] = ['checking', 'joint', 'savings', 'investment', 'other-asset', 'cash']
const DEBT_TYPES: AccountType[] = ['credit-card', 'loan']
const ADD = 'text-muted-foreground'

/**
 * One month in accounting form (DESIGN.md §2 and §7): the month on top, money in beside money out, and under it where
 * things stand at the end of it, assets beside debts and net worth. Each half balances; the figures come from
 * `buildStatement`, which reads them off the engine. The month is worked here too: a tick marks a row or an item done,
 * a click on a line opens the cell editor to overwrite the amount or say how sure it is.
 */
export function StatementScreen() {
  const store = useStore()
  const tables = useTables()
  const household = activeHousehold(tables)
  const months = useMemo(() => (household && tables ? defaultMonths(household, tables) : []), [household, tables])
  const engine = useEngine(tables, months)
  const main = useMemo(() => (tables && engine ? computeMainAccount(tables, engine) : null), [tables, engine])
  const [month, setMonth] = useState<MonthKey>(() => monthOfDate())
  /** Lines someone opened or closed; the rest follow their own default. */
  const [openLines, setOpenLines] = useState<Record<string, boolean>>({})
  const [editorRow, setEditorRow] = useState<string | null>(null)
  /** The goal dialog: an existing goal, or a new one starting on the line it was asked from. */
  const [goalEdit, setGoalEdit] = useState<{ goal: Goal | null; preset?: { kind: GoalKind; accountId?: string | null; poolId?: string | null } } | null>(null)
  const [removingGoal, setRemovingGoal] = useState<Goal | null>(null)
  const [balanceFor, setBalanceFor] = useState<string | null>(null)
  /** The expense category whose estimate is being typed. */
  const [estimateFor, setEstimateFor] = useState<string | null>(null)
  /** The transfer, account or pool account whose rule is being set. */
  const [ruleFor, setRuleFor] = useState<RuleTarget | null>(null)
  /** For an account added a moment ago: the choice its rule dialog opens on. */
  const [ruleStart, setRuleStart] = useState<RuleChoice['kind'] | undefined>(undefined)
  /** An account being added from the lower half: where it was asked from says which types are on offer. */
  const [accountNew, setAccountNew] = useState<{ name?: string; type?: AccountType; types: AccountType[] } | null>(null)
  const [poolNew, setPoolNew] = useState(false)
  /** The pool account being topped up. */
  const [topUpFor, setTopUpFor] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const idx = Math.max(0, months.indexOf(month) === -1 ? months.length - 1 : months.indexOf(month))
  const m = months[idx]
  const statement = useMemo(() => (tables && engine && m ? buildStatement(tables, engine, m, main) : null), [tables, engine, m, main])
  /** What each pool account is short by in the month shown. */
  const shortNow = useMemo(() => {
    const out: Record<string, number> = {}
    if (engine && m) for (const [id, s] of Object.entries(engine.pools)) out[id] = s.months[m]?.short ?? 0
    return out
  }, [engine, m])
  const closedNow = statement?.closed ?? true
  // A pool account that becomes short while this month is on screen (an expense was just typed, a set-aside lowered)
  // gets its top-up offered straight away. One that was short already when the month came into view only shows its tag.
  const seenShort = useRef<{ month: MonthKey | undefined; short: Record<string, number> }>({ month: undefined, short: {} })
  useEffect(() => {
    const seen = seenShort.current
    seenShort.current = { month: m, short: shortNow }
    if (seen.month !== m || closedNow) return
    const grown = Object.keys(shortNow).find((id) => shortNow[id] > (seen.short[id] ?? 0))
    if (grown) setTopUpFor(grown)
  }, [m, shortNow, closedNow])
  const isOpen = useCallback((line: StatementLine) => openLines[line.id] ?? line.open ?? false, [openLines])
  const onToggle = useCallback((line: StatementLine) => setOpenLines((s) => ({ ...s, [line.id]: !(s[line.id] ?? line.open ?? false) })), [])

  if (!tables || !household || !engine || !statement) return null
  const { locale, baseCurrency: ccy } = household
  const horizon = engine.months.length ? monthDiff(m, engine.months[engine.months.length - 1]) : 0
  const goalText = (g: GoalProgress) => goalStatusLine(g, locale, horizon)
  const editing = editorRow ? engine.rows.find((r) => r.id === editorRow) : undefined
  const balanceAccount = balanceFor ? tables.accounts.find((a) => a.id === balanceFor) : undefined
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

  /** A new row opens its category and, in an open month, the editor for its first amount; a transfer to an account asks for its rule. */
  function onAdded(row: Row) {
    setOpenLines((s) => ({ ...s, [`cat:${row.section}:${row.categoryId ?? 'none'}`]: true }))
    if (statement!.closed) return
    if (canCarryRule(row)) setRuleFor({ rowId: row.id })
    else setEditorRow(row.id)
  }
  /**
   * A new savings or investment account is asked straight away how much goes to it. While nothing takes the rest of
   * the month yet, a savings account is offered it.
   */
  function onAccountSaved(account: Account) {
    if (statement!.closed || (account.type !== 'savings' && account.type !== 'investment')) return
    const restTaken = resolveRules(engine!.rows, household!.closingRule).restRowId !== null
    setRuleStart(account.type === 'savings' && !restTaken ? 'rest' : undefined)
    setRuleFor({ accountId: account.id })
  }
  /** The rule sits on a row; an account or a pool account that no row feeds yet gets one when the rule is saved. */
  function onRule(line: StatementLine) {
    if (line.rule?.rowId) setRuleFor({ rowId: line.rule.rowId })
    else if (line.poolId) setRuleFor({ poolId: line.poolId })
    else if (line.accountId) setRuleFor({ accountId: line.accountId })
  }
  const categoriesOf = (section: Section) => tables!.categories.filter((c) => !c.deletedAt && c.section === section)
  const addRow = (section: Section, over: Pick<ComponentProps<typeof AddRowInline>, 'label' | 'defaultCategoryId' | 'only' | 'without'> = {}) => (
    <AddRowInline section={section} categories={categoriesOf(section)} tables={tables!} household={household!} onError={setError} onAdded={onAdded} {...over} />
  )
  /** Things are added where they will appear: at the foot of a group, and inside a category for a row of that category. */
  function footer(line: StatementLine): ReactNode {
    if (line.id === 'income') return <>{addRow('income')}<AddCategoryInline section="income" onError={setError} /></>
    if (line.id === 'expenses') return <>{addRow('expense')}<AddCategoryInline section="expense" onError={setError} estimate={statement!.closed ? undefined : { month: m, currency: ccy, locale }} /></>
    // money taken out of an account has a section of its own on the left, so the right side does not offer it
    if (line.id === 'set-aside') return addRow('transfer', { without: ['from-savings', 'from-investment'] })
    if (line.id === 'from-accounts') return addRow('transfer', { only: ['from-savings', 'from-investment'] })
    if (line.kind === 'category' && line.id.startsWith('cat:')) {
      const [, section, categoryId] = line.id.split(':')
      if (categoryId === 'none') return addRow(section as Section, { label: 'Add row without a category' })
      return (
        <>
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

  /** A goal starts on the line it was asked from: a pool account, an account to grow, a debt to clear, or net worth. */
  function onGoal(line: StatementLine, g?: GoalProgress) {
    if (g) return setGoalEdit({ goal: g.goal })
    if (line.poolId) return setGoalEdit({ goal: null, preset: { kind: 'pool-balance', poolId: line.poolId } })
    if (line.accountId) return setGoalEdit({ goal: null, preset: { kind: engine!.accounts[line.accountId]?.liability ? 'pay-off' : 'account-balance', accountId: line.accountId } })
    setGoalEdit({ goal: null, preset: { kind: 'net-worth' } })
  }

  // a closed month shows its rules and changes none
  const base = { locale, ccy, isOpen, onToggle, goalText, onRule: statement.closed ? undefined : onRule, onTopUp: statement.closed ? undefined : setTopUpFor }
  const flowCtx: LineContext = { ...base, withChange: false, closed: statement.closed, doneOf, onTick, onEdit: setEditorRow, busy, footer, onEstimate: setEstimateFor }
  // the estimate dialog reads the category's line: what the month shows now, and what its rows explain
  const estimateCategory = estimateFor ? tables.categories.find((c) => c.id === estimateFor && !c.deletedAt) : undefined
  const estimateLine = estimateFor ? walk(statement.flow.right.lines).find((l) => l.id === `cat:expense:${estimateFor}`) : undefined
  const estimateRest = estimateLine?.children.find((l) => l.estimateFor != null)?.amount ?? 0
  // a card or a loan is added under Debts; while the household owes nothing, at the foot of that side
  const hasDebts = statement.position.right.lines.some((l) => l.id === 'debts')
  const debtsFoot = <Button variant="ghost" size="sm" className={ADD} onClick={() => setAccountNew({ types: DEBT_TYPES })}><Plus /> Add a card or loan</Button>
  const positionCtx: LineContext = { ...base, withChange: true, onGoal, onBalance: setBalanceFor, footer: (line) => (line.id === 'debts' ? debtsFoot : null) }
  const day = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${lastDayOfMonth(m)}T00:00:00Z`))
  const foldable = walk([...statement.flow.left.lines, ...statement.flow.right.lines, ...statement.position.left.lines, ...statement.position.right.lines])
    .filter((l) => l.kind !== 'group' && (l.children.length > 0 || !!l.goals?.length))
  const setAll = (open: boolean) => setOpenLines(Object.fromEntries(foldable.map((l) => [l.id, open])))
  const act = (fn: () => Promise<unknown>) => void fn().catch((e) => setError(e instanceof Error ? e.message : 'Action failed'))
  // Accounts are added where they will show: what the household has under Assets, what it owes under Debts
  const savingsAccounts = tables.accounts.filter((a) => a.type === 'savings' && !a.deletedAt && !a.archivedMonth)
  const assetsFoot = (
    <>
      <Button variant="ghost" size="sm" className={ADD} onClick={() => setAccountNew({ types: ASSET_TYPES })}><Plus /> Add account</Button>
      {savingsAccounts.length > 0 && <Button variant="ghost" size="sm" className={ADD} onClick={() => setPoolNew(true)}><Plus /> Add pool account</Button>}
    </>
  )
  // the account a rule is asked for may have been saved a moment ago: wait until it is on the page
  const ruleReady = !!ruleFor && (!('accountId' in ruleFor) || tables.accounts.some((a) => a.id === ruleFor.accountId))

  return (
    <div className="space-y-4">
      <PageHeader title="Statement" subline={<>{household.name}{statement.closed && <> · <Chip tone="zinc"><Lock aria-hidden /> closed</Chip></>}</>}>
        <MonthPicker months={months} month={m} onChange={setMonth} locale={locale} onAddYear={() => act(() => addPlanYear(store))} />
        <Button size="xs" variant="outline" onClick={() => setAll(true)}>Open all</Button>
        <Button size="xs" variant="outline" onClick={() => setAll(false)}>Close all</Button>
        {error && <p role="alert" className="basis-full text-destructive">{error}</p>}
        {statement.warnings.map((w) => <p key={w} className="basis-full text-amber-700">{w}</p>)}
      </PageHeader>

      <StatementBand
        title="The month" help="statement.month" band={statement.flow} ctx={flowCtx} totals={['Total in', 'Total out']}
        right={<span className="flex items-center gap-1.5 text-[11px] text-muted-foreground"><span className={ESTIMATE_SHADE}>an estimate</span><InfoTip help="statement.estimate" /></span>}
      />
      <StatementBand title="At the end of the month" help="statement.position" band={statement.position} ctx={positionCtx} totals={['Total', 'Total']} amountHead={day} feet={[assetsFoot, hasDebts ? null : debtsFoot]} />

      {editing && <CellEditor key={`${editing.id}:${m}`} tables={tables} engine={engine} household={household} row={editing} month={m} onClose={() => setEditorRow(null)} />}
      {goalEdit && (
        <GoalDialog
          household={household} tables={tables} goal={goalEdit.goal} preset={goalEdit.preset} onClose={() => setGoalEdit(null)}
          onRemove={goalEdit.goal ? () => { setRemovingGoal(goalEdit.goal); setGoalEdit(null) } : undefined}
        />
      )}
      {balanceAccount && balanceResult && (
        <BalanceDialog key={`${balanceAccount.id}:${m}`} account={balanceAccount} month={m} result={balanceResult} locale={locale} closed={statement.closed} onClose={() => setBalanceFor(null)} />
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
      {removingGoal && <RemoveDialog target={{ kind: 'goal', id: removingGoal.id }} tables={tables} household={household} onClose={() => setRemovingGoal(null)} />}
    </div>
  )
}
