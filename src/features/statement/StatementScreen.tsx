import { useCallback, useEffect, useMemo, useRef, useState, type ComponentProps, type ReactNode } from 'react'
import { Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Chip } from '@/components/ui/chip'
import { InfoTip } from '@/components/InfoTip'
import { MarksLegend } from '@/components/MarksLegend'
import { MonthPicker } from '@/components/MonthPicker'
import { PageHeader } from '@/components/PageHeader'
import { doneness, type DoneState } from '@/app/display'
import { formatMonth } from '@/app/format'
import { readPref, writePref } from '@/app/prefs'
import { useStore } from '@/app/store'
import { clearHandedMonth, handPayment, handedOverMonth, useScreen } from '@/app/screens'
import { activeHousehold, defaultMonths, useEngine, useTables } from '@/app/useEngine'
import { useUndoNotice } from '@/app/useUndoNotice'
import { UndoNotice } from '@/components/UndoNotice'
import { buildStatement, cellKey, mainAccountsIn, notSetAside, type GoalProgress, type Statement, type StatementLine, type StatementSide } from '@/engine'
import { accountGroup, isOutsideNetWorth, isPastMonth, isPocketRow, lastDayOfMonth, monthDiff, monthOfDate, resolveRules, type Account, type AccountType, type Goal, type GoalKind, type Money, type MonthKey, type Row, type Section } from '@/model'
import { accountSuggestions, addPayOffRow, addPlanYear, moveAccount, movePool, removeIfFree, ruleRowOf, setCellDone, setDerivedDone, setItemStatus, setupFocus, setupSteps, shownRowSuggestions, stepSuggestions, updateHousehold, type RemovalTarget, type RowSuggestion, type RuleChoice, type RuleTarget, type SetupSide, type SetupStepKey } from '@/store'
import { GoalDialog } from '@/features/goals/GoalDialog'
import { goalStatusLine } from '@/features/goals/goalText'
import { AddRowInline } from '@/features/grid/AddRowInline'
import { BalanceDialog } from '@/features/grid/BalanceDialog'
import { MonthBalancesDialog } from '@/features/grid/MonthBalancesDialog'
import { CurrentBalanceDialog } from '@/features/grid/CurrentBalanceDialog'
import { CellEditor } from '@/features/grid/CellEditor'
import { RowMenu } from '@/features/grid/RowMenu'
import { HouseholdAccountDialog } from '@/features/household/HouseholdAccountDialog'
import { PoolDialog } from '@/features/household/PoolsCard'
import { RemoveDialog } from '@/features/remove/RemoveDialog'
import { RuleDialog } from '@/features/rules/RuleDialog'
import { AccountMenu } from './AccountMenu'
import { AddCategoryInline } from './AddCategoryInline'
import { CategoryMenu } from './CategoryMenu'
import { EstimateDialog } from './EstimateDialog'
import { MonthStrip } from './MonthStrip'
import { PerPerson } from './PerPerson'
import { RateChip } from './RateChip'
import { monthProgress, nearestMonth, progressText } from './progress'
import { SetupGuide } from './SetupGuide'
import { StatementBand } from './StatementBand'
import { stripMonths } from './stripMonths'
import { AccountSuggestionLines, SuggestionLines } from './SuggestionLines'
import { TopUpDialog } from './TopUpDialog'
import { LINE_MENU, type LineContext } from './StatementLine'
import { AddLead } from './AddLead'
import { LEAD_BUTTON, LEAD_PAD } from './lead'
import { cn } from '@/lib/utils'
import { saveError } from '@/app/saveError'

const walk = (lines: StatementLine[]): StatementLine[] => lines.flatMap((l) => [l, ...walk(l.children)])
/** Every top line of both halves, to look a line up in. */
const linesOf = (s: Statement): StatementLine[] => [...s.flow.left.lines, ...s.flow.right.lines, ...s.position.left.lines, ...s.position.right.lines]
/** The ids of the lines a line sits under, outermost first; null when the line is not there. */
function pathTo(lines: StatementLine[], id: string, above: string[] = []): string[] | null {
  for (const l of lines) {
    if (l.id === id) return above
    const found = pathTo(l.children, id, [...above, l.id])
    if (found) return found
  }
  return null
}
/**
 * Bring lines of the Statement into view and mark them for two seconds: what hides them is opened and the page moves
 * to the first of them, to the middle of the window. `gentle` is for a line the user did not ask to be taken to (a
 * row that was just added): the page stays where it is when the line is in view already, and the keyboard stays too.
 */
function reveal(
  ids: string[], all: StatementLine[],
  to: { open: (ids: string[]) => void; mark: (ids: ReadonlySet<string> | null) => void; timer: { current: number | undefined } },
  gentle = false,
) {
  const parents = ids.flatMap((id) => pathTo(all, id) ?? [])
  if (parents.length) to.open(parents)
  to.mark(new Set(ids))
  window.clearTimeout(to.timer.current)
  to.timer.current = window.setTimeout(() => to.mark(null), 2000)
  // once the parents have opened
  requestAnimationFrame(() => {
    const el = document.querySelector<HTMLElement>(`[data-line="${CSS.escape(ids[0])}"]`)
    if (!el) return
    const box = el.getBoundingClientRect()
    // the bar with the month covers the top of the window while it is stuck there, the phone's tab bar the foot
    const bar = document.querySelector<HTMLElement>('[data-sticky-bar][data-stuck="true"]')?.getBoundingClientRect().bottom ?? 0
    const inView = box.top >= bar + 8 && box.bottom <= window.innerHeight - 80
    if (!gentle || !inView) el.scrollIntoView({ block: 'center', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })
    if (!gentle) el.querySelector<HTMLElement>('button')?.focus({ preventScroll: true })
  })
}
/** The part of the page each step of the guided setup is about: where the page goes when the guide moves to it. */
const STEP_PART: Record<SetupStepKey, string> = {
  income: '[data-line="income"]',
  expenses: '[data-line="expenses"]',
  savings: '[data-side="assets"]',
  virtual: '[data-side="assets"]',
  investments: '[data-side="assets"]',
  debts: '[data-side="claims"]',
}
/** The type "Add account" starts on in a step of the guided setup that asks for one kind of account. */
const STEP_ACCOUNT: Partial<Record<SetupStepKey, AccountType>> = { savings: 'savings', investments: 'investment' }
/** Said under "Add row" in an expense place when the row pays a card whose purchases are expense rows: its line shows in another group. */
const PAY_OFF_NOTE = 'It will show under "Moved elsewhere": what was bought with this card is under Expenses already, so the payment only moves money to the card.'
/** What "Add account" offers under Assets, and "Add a card or loan" under Debts. */
const ASSET_TYPES: AccountType[] = ['checking', 'joint', 'savings', 'investment', 'other-asset', 'cash']
const DEBT_TYPES: AccountType[] = ['credit-card', 'loan']
/** The headings that fold (DESIGN.md §7). Which of them are folded is kept on this device, for each household. */
const GROUPS = ['income', 'from-accounts', 'expenses', 'moved', 'set-aside', 'savings-accounts', 'investment-accounts', 'other-assets', 'debts', 'net-worth']
const foldedPref = (householdId: string) => `statement.folded.${householdId}`
const ADD = 'text-muted-foreground'

/**
 * The first screen: one month in accounting form (DESIGN.md §2 and §7). The month on top, money in beside money out,
 * and under it where things stand at the end of it, assets beside debts and net worth. Each half balances; the figures
 * come from `buildStatement`, which reads them off the engine. The month is worked here too: a tick marks a row or an
 * item done, a click on a line opens the cell editor to overwrite the amount or say how sure it is, the progress line
 * counts what is still open, and "Balances…" asks what the accounts really held. No month is locked: one that is
 * over carries the chip "past" and can be changed like any other. With two or more adults, "Per person" closes the page.
 * While a household is new the guided setup leads through it: one part of the page is lit, the rest locked.
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
  /** The household whose folded headings were read into `openLines`. */
  const [foldsFor, setFoldsFor] = useState<string | null>(null)
  /** The row whose dialog is open: its amount and, for a row that can carry one, its rule (which may start on a choice). */
  const [editor, setEditor] = useState<{ rowId: string; start?: RuleChoice['kind'] } | null>(null)
  /** The goal dialog: an existing goal, or a new one starting on the line it was asked from. */
  const [goalEdit, setGoalEdit] = useState<{ goal: Goal | null; preset?: { kind: GoalKind; accountId?: string | null; poolId?: string | null } } | null>(null)
  const [removingGoal, setRemovingGoal] = useState<Goal | null>(null)
  const [balanceFor, setBalanceFor] = useState<string | null>(null)
  /** The real balance of the main account is being typed. */
  const [currentBalance, setCurrentBalance] = useState(false)
  /** "Balances…" was pressed: every account of the month, with the tick that counts the month as done. */
  const [balances, setBalances] = useState(false)
  /** The expense category whose estimate is being typed. */
  const [estimateFor, setEstimateFor] = useState<string | null>(null)
  /** An account or a virtual account that no row fills yet, asked how much goes to it: the short dialog that adds the row. */
  const [ruleFor, setRuleFor] = useState<RuleTarget | null>(null)
  /** For an account added a moment ago: the choice its rule dialog opens on. */
  const [ruleStart, setRuleStart] = useState<RuleChoice['kind'] | undefined>(undefined)
  /** An account being added from the lower half: where it was asked from says which types are on offer. */
  const [accountNew, setAccountNew] = useState<{ name?: string; type?: AccountType; types: AccountType[]; payOff?: boolean } | null>(null)
  const [poolNew, setPoolNew] = useState(false)
  /** An account or a virtual account opened from the "…" on its line. */
  const [accountEdit, setAccountEdit] = useState<string | null>(null)
  const [poolEdit, setPoolEdit] = useState<string | null>(null)
  /** What "Archive or delete…" in one of those dialogs was pressed for. */
  const [removing, setRemoving] = useState<RemovalTarget | null>(null)
  /** What a one-click delete just removed, or what a restore brought back, with the way back: it goes with the next change. */
  const notice = useUndoNotice(store)
  /** The lines a link symbol has just moved the page to, for the two seconds they stay marked. */
  const [marked, setMarked] = useState<ReadonlySet<string> | null>(null)
  const markTimer = useRef<number | undefined>(undefined)
  /** A row that was just added, or moved to another category (`under` is that category's line), until the page has shown where it is. */
  const landing = useRef<{ id: string; under?: string } | null>(null)
  /** The step the guided setup is on, and the household it was worked out for. */
  const [stepAt, setStepAt] = useState<SetupStepKey | null>(null)
  const [stepFor, setStepFor] = useState<string | null>(null)
  useEffect(() => () => window.clearTimeout(markTimer.current), [])
  /** "Suggestions" in the toolbar, once it was pressed; until then they show while the household is being set up. */
  const [suggest, setSuggest] = useState<boolean | null>(null)
  /** The virtual account being topped up. */
  const [topUpFor, setTopUpFor] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const { go } = useScreen()

  const settingUp = household?.setupOpen ?? false
  const month = picked ?? (settingUp && household ? household.startMonth : monthOfDate())
  const m = nearestMonth(months, month)
  const statement = useMemo(() => (tables && engine && m ? buildStatement(tables, engine, m) : null), [tables, engine, m])
  /** Every month of the plan in four figures, for the strip at the top. The guided setup holds the top instead. */
  const strip = useMemo(() => (tables && engine && !settingUp ? stripMonths(tables, engine, months) : []), [tables, engine, months, settingUp])
  /** What each virtual account is short by in the month shown. */
  const shortNow = useMemo(() => {
    const out: Record<string, number> = {}
    if (engine && m) for (const [id, s] of Object.entries(engine.pools)) out[id] = s.months[m]?.short ?? 0
    return out
  }, [engine, m])
  // A virtual account that becomes short while this month is on screen (an expense was just typed, a set-aside lowered)
  // gets its top-up offered straight away. One that was short already when the month came into view only shows its tag.
  const seenShort = useRef<{ month: MonthKey | undefined; short: Record<string, number> }>({ month: undefined, short: {} })
  useEffect(() => {
    const seen = seenShort.current
    seenShort.current = { month: m, short: shortNow }
    if (seen.month !== m) return
    const grown = Object.keys(shortNow).find((id) => shortNow[id] > (seen.short[id] ?? 0))
    if (grown) setTopUpFor(grown)
  }, [m, shortNow])
  // Suggested rows sit where they will appear: under a group, or inside the category they belong to
  const showing = suggest ?? household?.setupOpen ?? false
  // During the guided setup only the step's own are offered, so the lit part is all there is to read. A virtual
  // account is not offered among the expenses: it waits for its step and is offered under Assets, where it will sit.
  const offers = useMemo(() => {
    const all = tables ? shownRowSuggestions(tables) : []
    const ofStep = settingUp && stepAt ? stepSuggestions(stepAt, all) : all
    const byPlace = new Map<string, RowSuggestion[]>()
    for (const s of settingUp ? ofStep.filter((x) => !x.pool) : ofStep) byPlace.set(s.place, [...(byPlace.get(s.place) ?? []), s])
    return { byPlace, pools: settingUp ? ofStep.filter((x) => x.pool) : [] }
  }, [tables, settingUp, stepAt])
  const suggestions = offers.byPlace
  /** A category that has something usual to offer opens by itself, so the offer is seen. */
  const autoOpen = useMemo(() => new Set(showing ? [...suggestions].filter(([, list]) => list.some((s) => s.usual)).map(([place]) => place) : []), [showing, suggestions])
  const isOpen = useCallback((line: StatementLine) => openLines[line.id] ?? ((line.open ?? false) || autoOpen.has(line.id)), [openLines, autoOpen])
  const onToggle = useCallback((line: StatementLine) => setOpenLines((s) => ({ ...s, [line.id]: !(s[line.id] ?? ((line.open ?? false) || autoOpen.has(line.id))) })), [autoOpen])

  const openThese = useCallback((ids: string[]) => setOpenLines((s) => ({ ...s, ...Object.fromEntries(ids.map((id) => [id, true])) })), [])
  // a row added or moved a moment ago: once its dialog is closed and its line is on the page (for a moved row: under
  // its new category, which the page learns a moment after the save), the page shows where it landed
  useEffect(() => {
    const to = landing.current
    if (!to || editor || !statement) return
    const all = linesOf(statement)
    const path = pathTo(all, to.id)
    if (!path || (to.under && !path.includes(to.under))) return
    landing.current = null
    reveal([to.id], all, { open: openThese, mark: setMarked, timer: markTimer }, true)
  }, [editor, statement, openThese])

  // A heading someone folded stays folded on this device: read once the household is known, written as it changes.
  const householdId = household?.id ?? null
  if (householdId && foldsFor !== householdId) {
    setFoldsFor(householdId)
    setOpenLines(Object.fromEntries(readPref<string[]>(foldedPref(householdId), []).map((id) => [id, false])))
  }
  useEffect(() => {
    if (householdId && foldsFor === householdId) writePref(foldedPref(householdId), GROUPS.filter((id) => openLines[id] === false))
  }, [openLines, householdId, foldsFor])

  // The guided setup starts where this household left it, or on the first step that still has nothing. It is fixed
  // once per household, here and not on every render: a step that gets its first row must not move the guide on.
  if (settingUp && household && tables && stepFor !== household.id) {
    const kept = readPref<{ household: string; step: SetupStepKey } | null>('setup.step', null)
    const all = setupSteps(tables)
    setStepFor(household.id)
    setStepAt(kept?.household === household.id && all.some((s) => s.key === kept.step) ? kept.step : all.find((s) => !s.done)?.key ?? all[all.length - 1].key)
  }

  if (!tables || !household || !engine || !statement) return null
  const { locale, baseCurrency: ccy, displayExpensesNegative: neg } = household
  const steps = setupSteps(tables)
  const step: SetupStepKey = stepAt ?? steps[0].key
  // The guided setup lights the part of the page its step is about: whole sides, and single groups. A side with
  // nothing lit is locked as a whole; in a side that is partly lit, the groups that are not are locked one by one.
  const focus = settingUp ? setupFocus(step) : null
  const sideOf: Record<SetupSide, StatementSide> = { in: statement.flow.left, out: statement.flow.right, assets: statement.position.left, claims: statement.position.right }
  const lockedSide = (key: SetupSide) => !!focus && !focus.sides.includes(key) && !sideOf[key].lines.some((l) => focus.lines.includes(l.id))
  const lockedLines = new Set<string>()
  if (focus) {
    for (const key of ['in', 'out', 'assets', 'claims'] as const) {
      if (focus.sides.includes(key) || lockedSide(key)) continue
      for (const l of sideOf[key].lines) if (!focus.lines.includes(l.id)) lockedLines.add(l.id)
    }
  }
  const progress = monthProgress(engine.rows, engine.cells, m)
  // The other currencies this month's page counts in: those of its rows and accounts, and of a main account from before
  // rule B9 behind the first line of the lower half. Each shows its rate for the month as a chip in the toolbar.
  const currencies = [...new Set([
    ...walk(linesOf(statement)).flatMap((l) => (l.native ? [l.native.currency] : [])),
    ...mainAccountsIn(tables.accounts, m).map((a) => a.currency),
  ])].filter((c) => c !== ccy).sort()
  const horizon = engine.months.length ? monthDiff(m, engine.months[engine.months.length - 1]) : 0
  const goalText = (g: GoalProgress) => goalStatusLine(g, locale, horizon)
  const editing = editor ? engine.rows.find((r) => r.id === editor.rowId) : undefined
  const balanceAccount = balanceFor ? tables.accounts.find((a) => a.id === balanceFor) : undefined
  /** An account's amount was pressed. The main account's line opens its own dialog, which covers an old one it replaced. */
  const openBalance = (accountId: string) => {
    const account = tables.accounts.find((a) => a.id === accountId)
    if (account && accountGroup(account) === 'current') setCurrentBalance(true)
    else setBalanceFor(accountId)
  }
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
    run.catch((e) => setError(saveError(e, 'Action failed'))).finally(() => setBusy(null))
  }

  /**
   * A new row opens its category and its dialog for the first amount (and, where it can carry one,
   * its rule). Once the dialog is closed the page shows where the row is, also when that is another group than the
   * one it was added from.
   */
  function onAdded(row: Row) {
    setOpenLines((s) => ({ ...s, [`cat:${row.section}:${row.categoryId ?? 'none'}`]: true }))
    landing.current = { id: row.id }
    setEditor({ rowId: row.id })
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
  /** A step of the guided setup: go to its part of the page, below the guide, with the cursor in the first thing that can be filled. */
  function jump(selector: string) {
    const el = document.querySelector<HTMLElement>(selector)
    if (!el) return
    const part = el.closest('li') ?? el
    const guide = document.querySelector<HTMLElement>('[data-testid="setup-guide"]')?.offsetHeight ?? 0
    window.scrollTo({ top: Math.max(0, part.getBoundingClientRect().top + window.scrollY - guide - 8), behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })
    // the first thing that takes an entry; an (i) explains and is never where the cursor should land
    const act = 'button:not([aria-label^="About "])'
    const first = part.querySelector<HTMLElement>('input') ?? part.querySelector<HTMLElement>(`[data-testid="suggestions"] ${act}, [data-testid^="foot-"] ${act}`)
    first?.focus({ preventScroll: true })
  }
  /** The guide moves to a step: it is remembered for this household, and the page goes to the part the step is about. */
  function onStep(key: SetupStepKey) {
    setStepAt(key)
    writePref('setup.step', { household: household!.id, step: key })
    // a heading the step is about is open when the guide gets to it
    openThese(setupFocus(key).lines)
    // once the step's part is drawn as the lit one
    requestAnimationFrame(() => jump(STEP_PART[key]))
  }
  /** "Finish" and "Leave setup": the guide goes away for good, and the month stays where it is. */
  function leaveSetup() {
    setMonth(m)
    writePref('setup.step', null)
    act(() => updateHousehold(store, { setupOpen: false }))
  }
  /**
   * A suggested row came with its amount, so no editor opens; its category stays open once its suggestions are gone.
   * Pocket money added without an amount asks for its rule instead: an amount, or a percentage.
   */
  function onSuggested(row: Row, amount: number | null) {
    setOpenLines((s) => ({ ...s, [`cat:${row.section}:${row.categoryId ?? 'none'}`]: true }))
    if (isPocketRow(row) && !(amount != null && amount > 0)) setEditor({ rowId: row.id })
  }
  /**
   * Whether the lines an add control stands under carry ticks: rows do. Under a group whose lines are categories
   * nothing is ticked, so its controls stand on the categories' columns instead.
   */
  const tickedUnder = (line: StatementLine) => !line.children.some((c) => c.kind === 'category')
  const suggested = (line: StatementLine) => (showing && m
    ? (
      <SuggestionLines
        suggestions={suggestions.get(line.id) ?? []} label={line.label} month={m} currency={household!.baseCurrency} locale={household!.locale} onAdded={onSuggested} onError={setError}
        ticks={tickedUnder(line)}
        // the account a suggested row needs is made first; the suggestion is the row, so the account brings none
        onNeed={(type) => setAccountNew({ type, types: [type], payOff: false })}
      />
    )
    : null)
  /**
   * A new account that came with its row (a loan or card with its payment) opens that row for the amount. A new
   * savings or investment account is asked straight away how much goes to it; while nothing takes the rest of the
   * month yet, a savings account is offered it.
   */
  function onAccountSaved(account: Account, row?: Row) {
    if (row) return onAdded(row)
    // an account left out of net worth is a person's own: it is not offered the household's rest, nor asked for a rule
    if (isOutsideNetWorth(account) || (account.type !== 'savings' && account.type !== 'investment')) return
    const restTaken = resolveRules(engine!.rows, household!.closingRule).restRowId !== null
    askRule({ accountId: account.id }, account.type === 'savings' && !restTaken ? 'rest' : undefined)
  }
  /**
   * The link symbol: the other end of a linked money flow. What hides it is opened, the page moves there, and the
   * line is marked for two seconds; the keyboard lands on it too.
   */
  function goToLink(line: StatementLine) {
    const ids = line.link?.to ?? []
    if (ids.length) reveal(ids, linesOf(statement!), { open: openThese, mark: setMarked, timer: markTimer })
  }
  /** The open link on a loan or card: the row that pays it off is made, linked, and asks for its amount. */
  function addPayOff(line: StatementLine) {
    if (line.accountId) act(async () => onAdded(await addPayOffRow(store, line.accountId!)))
  }
  /** The rule sits on a row, so its symbol opens that row's dialog; an account or a virtual account that no row feeds yet gets one when the rule is saved. */
  function onRule(line: StatementLine) {
    if (line.rule?.rowId) setEditor({ rowId: line.rule.rowId })
    else if (line.poolId) askRule({ poolId: line.poolId })
    else if (line.accountId) askRule({ accountId: line.accountId })
  }
  const categoriesOf = (section: Section) => tables!.categories.filter((c) => !c.deletedAt && c.section === section)
  // a loan payment belongs with the expenses (the car loan under Transport) and is added there; only the payment to a
  // card whose purchases are expense rows shows elsewhere: the form says so, and the page goes there once it is added
  /** What a savings account holds this month that no virtual account has set aside: said in the form of a new one. */
  const freeOf = (accountId: string): Money | null => notSetAside(tables!, engine!, accountId, m)
  const addRow = (line: StatementLine, section: Section, over: Pick<ComponentProps<typeof AddRowInline>, 'label' | 'defaultCategoryId' | 'only' | 'place'> = {}) => (
    <AddRowInline
      section={section} categories={categoriesOf(section)} tables={tables!} household={household!} onError={setError} onAdded={onAdded}
      month={m} payOffNote={PAY_OFF_NOTE} freeOf={freeOf}
      // on the columns of the lines above it: the "+" where their tick is (or their arrow), the words where their names are
      lead={<AddLead ticks={tickedUnder(line)} />} leadClassName={LEAD_BUTTON} formClassName={cn('min-w-0 basis-full', LEAD_PAD[tickedUnder(line) ? 'ticks' : 'plain'])} {...over}
    />
  )
  /** Things are added where they will appear: at the foot of a group, and inside a category for a row of that category. */
  function footer(line: StatementLine): ReactNode {
    if (line.id === 'income') return <>{suggested(line)}{addRow(line, 'income')}<AddCategoryInline section="income" onError={setError} /></>
    if (line.id === 'expenses') return <>{suggested(line)}{addRow(line, 'expense')}<AddCategoryInline section="expense" onError={setError} estimate={{ month: m, currency: ccy, locale }} /></>
    // what the row is for is asked first; money taken out of an account has a section of its own on the left
    if (line.id === 'set-aside') return <>{suggested(line)}{addRow(line, 'transfer', { place: 'set-aside' })}</>
    if (line.id === 'from-accounts') return addRow(line, 'transfer', { only: ['from-savings', 'from-investment'] })
    if (line.kind === 'category' && line.id.startsWith('cat:')) {
      const [, section, categoryId] = line.id.split(':')
      if (categoryId === 'none') return addRow(line, section as Section, { label: 'Add row without a category' })
      return (
        <>
          {suggested(line)}
          {addRow(line, section as Section, { label: `Add row to ${line.label}`, defaultCategoryId: categoryId })}
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
  const onDeleted = (name: string) => notice.say(`Deleted "${name}".`)
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
    return row ? <RowMenu row={row} tables={tables!} household={household!} onError={setError} onDeleted={onDeleted} onRestored={notice.say} onRule={() => setEditor({ rowId })} triggerClassName={LINE_MENU} /> : null
  }
  /**
   * The lines that stand beside an account or a virtual account under the same heading, in the order on screen: what
   * "Move up" and "Move down" move it among. Accounts stand beside the accounts of their heading, virtual accounts
   * beside those of their savings account.
   */
  const beside = new Map<string, StatementLine[]>()
  const noteBeside = (lines: StatementLine[]) => {
    for (const l of lines) {
      for (const kids of [l.children.filter((c) => c.kind === 'account' && !!c.accountId), l.children.filter((c) => c.kind === 'pool' && !!c.poolId)]) {
        for (const k of kids) beside.set(k.id, kids)
      }
      noteBeside(l.children)
    }
  }
  noteBeside([...statement.position.left.lines, ...statement.position.right.lines])
  /** The "…" after any other line's name: a category's menu, an account's or a virtual account's, each with the way into its dialog. */
  /**
   * The household's main account: the calculated line is that account. One that was archived and replaced stays in the
   * line as its history, so the open one is meant; null where two are open, which only data from before rule B9 has.
   */
  const onlyCurrent = (): Account | null => {
    const counted = (engine!.main?.accountIds ?? []).map((id) => tables!.accounts.find((a) => a.id === id && !a.deletedAt)).filter((a): a is Account => !!a)
    const open = counted.filter((a) => !a.archivedMonth)
    const current = open.length ? open : counted
    return current.length === 1 ? current[0] : null
  }
  /**
   * What pressing a line of the lower half opens: the dialog of the account or virtual account it stands for, the one
   * its "…" calls "Edit…".
   */
  function lineOpen(line: StatementLine): (() => void) | null {
    if (line.kind === 'pool' && line.poolId) {
      const id = line.poolId
      return () => setPoolEdit(id)
    }
    if (line.kind === 'account' && line.accountId) {
      const id = line.accountId
      return () => setAccountEdit(id)
    }
    if (line.id === 'main') {
      const only = onlyCurrent()
      return only ? () => setAccountEdit(only.id) : null
    }
    return null
  }
  function lineMenu(line: StatementLine): ReactNode {
    if (line.kind === 'category' && line.id.startsWith('cat:')) {
      const category = tables!.categories.find((c) => c.id === line.id.split(':')[2] && !c.deletedAt)
      // an expense category's estimate for the month is set from here
      return category ? (
        <CategoryMenu
          category={category} tables={tables!} household={household!} onError={setError} onDeleted={onDeleted} triggerClassName={LINE_MENU}
          onEstimate={category.section === 'expense' ? () => setEstimateFor(category.id) : undefined} hasEstimate={line.budget != null}
        />
      ) : null
    }
    const removeLabel = settingUp ? 'Delete' : 'Archive or delete…'
    if (line.kind === 'pool' && line.poolId) {
      const id = line.poolId
      const among = (beside.get(line.id) ?? [line]).map((l) => l.poolId!)
      return (
        <AccountMenu
          what="Virtual account" name={line.label} at={among.indexOf(id)} count={among.length} removeLabel={removeLabel} triggerClassName={LINE_MENU}
          onEdit={() => setPoolEdit(id)} onMove={(direction) => act(() => movePool(store, id, direction, among))} onRemove={() => removeFrom({ kind: 'pool', id })}
        />
      )
    }
    if (line.kind === 'account' && line.accountId) {
      const id = line.accountId
      const among = (beside.get(line.id) ?? [line]).map((l) => l.accountId!)
      return (
        <AccountMenu
          what="Account" name={line.label} at={among.indexOf(id)} count={among.length} removeLabel={removeLabel} triggerClassName={LINE_MENU}
          onEdit={() => setAccountEdit(id)} onMove={(direction) => act(() => moveAccount(store, id, direction, among))} onRemove={() => removeFrom({ kind: 'account', id })}
        />
      )
    }
    // the calculated line is the main account and carries its menu. Where two are open (data from before rule B9, or
    // the month an old one was replaced), each stands under the line with a menu of its own, so the line has none
    if (line.id === 'main') {
      const only = onlyCurrent()
      if (!only) return null
      return (
        <AccountMenu
          what="Account" name={only.name} at={0} count={1} removeLabel={removeLabel} triggerClassName={LINE_MENU}
          onEdit={() => setAccountEdit(only.id)} onMove={() => undefined} onRemove={() => removeFrom({ kind: 'account', id: only.id })}
        />
      )
    }
    return null
  }
  const accountEditing = accountEdit ? tables.accounts.find((a) => a.id === accountEdit && !a.deletedAt) : undefined
  const poolEditing = poolEdit ? tables.pools.find((p) => p.id === poolEdit && !p.deletedAt) : undefined

  const base = { locale, ccy, isOpen, onToggle, goalText, onRule, onTopUp: setTopUpFor, onLink: goToLink, onLinkOpen: addPayOff, marked, locked: focus ? (line: StatementLine) => lockedLines.has(line.id) : undefined }
  /** A line's day: the month's payments, at that line. */
  const onDay = (line: StatementLine) => {
    if (!line.rowId) return
    handPayment({ month: m, rowId: line.rowId, itemId: line.itemId })
    go('payments')
  }
  const flowCtx: LineContext = { ...base, withChange: false, doneOf, onTick, onDay, onEdit: (rowId) => setEditor({ rowId }), busy, footer, onEstimate: setEstimateFor, rowMenu, menu: lineMenu }
  // the estimate dialog reads the category's line: what the month shows now, and what its rows explain
  const estimateCategory = estimateFor ? tables.categories.find((c) => c.id === estimateFor && !c.deletedAt) : undefined
  const estimateLine = estimateFor ? walk(statement.flow.right.lines).find((l) => l.id === `cat:expense:${estimateFor}`) : undefined
  const estimateRest = estimateLine?.children.find((l) => l.estimateFor != null)?.amount ?? 0
  // a card or a loan is added under Debts; while the household owes nothing, at the foot of that side
  const hasDebts = statement.position.right.lines.some((l) => l.id === 'debts')
  const debtsFoot = <Button variant="ghost" size="sm" className={cn(ADD, LEAD_BUTTON)} onClick={() => setAccountNew({ types: DEBT_TYPES })}><AddLead ticks={false} /> <span data-lead="text">Add a card or loan</span></Button>
  const positionCtx: LineContext = { ...base, withChange: true, onGoal, onBalance: openBalance, onCurrentBalance: () => setCurrentBalance(true), footer: (line) => (line.id === 'debts' ? debtsFoot : null), menu: lineMenu, onOpen: lineOpen }
  const day = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${lastDayOfMonth(m)}T00:00:00Z`))
  const foldable = walk([...statement.flow.left.lines, ...statement.flow.right.lines, ...statement.position.left.lines, ...statement.position.right.lines])
    .filter((l) => l.kind === 'group' || l.children.length > 0 || !!l.goals?.length || autoOpen.has(l.id))
  const setAll = (open: boolean) => setOpenLines(Object.fromEntries(foldable.map((l) => [l.id, open])))
  const act = (fn: () => Promise<unknown>) => void fn().catch((e) => setError(saveError(e, 'Action failed')))
  // Accounts are added where they will show: what the household has under Assets, what it owes under Debts
  const savingsAccounts = tables.accounts.filter((a) => a.type === 'savings' && !a.deletedAt && !a.archivedMonth)
  // step 3 once there is a savings account and nothing takes the rest of the month yet: one press asks the first of them
  const stepAction = step === 'savings' && savingsAccounts.length > 0 && !steps.find((s) => s.key === 'savings')?.done
    ? { label: 'Choose where the rest goes', run: () => askRule({ accountId: savingsAccounts[0].id }, 'rest') }
    : undefined
  const assetsFoot = (
    <>
      {/* during the guided setup the usual accounts belong to the savings step, and the usual virtual accounts to theirs */}
      {showing && (!settingUp || step === 'savings') && <AccountSuggestionLines suggestions={accountSuggestions(tables)} onAdd={(s) => setAccountNew({ name: s.name, type: s.type, types: ASSET_TYPES })} onError={setError} />}
      {showing && offers.pools.length > 0 && (
        <SuggestionLines
          suggestions={offers.pools} label="Virtual accounts" month={m} currency={ccy} locale={locale} onAdded={onSuggested} onError={setError} ticks={false}
          onNeed={(type) => setAccountNew({ type, types: [type], payOff: false })}
        />
      )}
      <Button variant="ghost" size="sm" className={cn(ADD, LEAD_BUTTON)} onClick={() => setAccountNew({ types: ASSET_TYPES, type: settingUp ? STEP_ACCOUNT[step] : undefined })}><AddLead ticks={false} /> <span data-lead="text">Add account</span></Button>
      {savingsAccounts.length > 0 && <Button variant="ghost" size="sm" className={ADD} onClick={() => setPoolNew(true)}><Plus /> Add virtual account</Button>}
    </>
  )
  // the account a rule is asked for may have been saved a moment ago: wait until it is on the page
  const ruleReady = !!ruleFor && (!('accountId' in ruleFor) || tables.accounts.some((a) => a.id === ruleFor.accountId))

  return (
    <div className="space-y-4">
      {/* The strip of months and the line of the month on screen stay in view while the page scrolls. The line reads
          as the pressed month's caption: its name, whether it is over, how much of it is done, "Balances…" and its
          rates. While a household is being set up the guide holds the top of the window instead, and there is no
          strip: the month keeps its arrows there. */}
      <PageHeader
        title="Statement" subline={household.name}
        sticky={!settingUp}
        above={strip.length > 0 && <MonthStrip months={strip} month={m} today={monthOfDate()} currency={ccy} locale={locale} onChange={setMonth} onAddYear={() => act(() => addPlanYear(store))} />}
        // how the page is shown: quiet buttons at the right end, before Undo and Redo
        tools={<>
          <span className="flex items-center gap-1">
            <Button size="xs" variant={showing ? 'default' : 'ghost'} aria-pressed={showing} onClick={() => setSuggest(!showing)}>Suggestions</Button>
            <InfoTip help="statement.suggestions" />
          </span>
          <Button size="xs" variant="ghost" onClick={() => setAll(true)}>Expand all</Button>
          <Button size="xs" variant="ghost" onClick={() => setAll(false)}>Collapse all</Button>
          <MarksLegend neg={neg} />
        </>}
        notes={<>
          {error && <p role="alert" className="text-destructive">{error}</p>}
          {statement.warnings.map((w) => <p key={w} className="text-amber-700">{w}</p>)}
        </>}
      >
        {settingUp
          ? <MonthPicker months={months} month={m} onChange={setMonth} locale={locale} onAddYear={() => act(() => addPlanYear(store))} />
          : <h2 className="text-sm font-semibold leading-5">{formatMonth(m, locale, 'long')}</h2>}
        {isPastMonth(m) && <Chip tone="zinc" title="This month is over. It can still be changed.">past</Chip>}
        {progress.total > 0 && (
          // How much of the month is ticked and what is still open; a month with nothing in it has nothing to count
          <p role="status" className="flex items-center gap-1 text-muted-foreground" data-testid="progress">
            <span>{progressText(progress, ccy, locale)}</span>
            <InfoTip help="statement.progress" />
          </p>
        )}
        {/* what every account really held, and the tick that counts the month as done, beside the count it changes;
            a household that is still being set up has no month to look back on yet */}
        {!settingUp && <Button size="xs" variant="outline" onClick={() => setBalances(true)}>Balances…</Button>}
        {/* What another currency is worth this month: a chip to read, and to press for a rate of one's own */}
        {currencies.length > 0 && (
          <span className="inline-flex flex-wrap items-center gap-1.5" data-testid="month-rates">
            {currencies.map((c) => <RateChip key={`${c}:${m}`} tables={tables} household={household} month={m} currency={c} />)}
          </span>
        )}
      </PageHeader>

      {settingUp && <SetupGuide steps={steps} current={step} action={stepAction} onStep={onStep} onDone={leaveSetup} />}
      <StatementBand title="The month" help="statement.month" band={statement.flow} ctx={flowCtx} totals={['Total in', 'Total out']} locked={[lockedSide('in'), lockedSide('out')]} />
      <StatementBand
        title="At the end of the month" help="statement.position" band={statement.position} ctx={positionCtx} totals={['Total', 'Total']} amountHead={day}
        feet={[assetsFoot, hasDebts ? null : debtsFoot]} locked={[lockedSide('assets'), lockedSide('claims')]}
      />
      <PerPerson household={household} tables={tables} engine={engine} month={m} locked={settingUp} />

      {/* What a one-click delete took away, or what a restore brought back, with the way back (`UndoNotice`). */}
      {notice.notice && <UndoNotice text={notice.notice} onUndo={() => act(() => store.undo())} onDismiss={notice.clear} />}
      {editing && (
        <CellEditor
          key={`${editing.id}:${m}`} tables={tables} engine={engine} household={household} row={editing} month={m} startRule={editor?.start} onClose={() => setEditor(null)}
          // a row saved into another category: once the dialog is closed the page shows where it went, as for a new row
          onMoved={(categoryId) => { landing.current = { id: editing.id, under: `cat:${editing.section}:${categoryId ?? 'none'}` } }}
        />
      )}
      {goalEdit && (
        <GoalDialog
          household={household} tables={tables} goal={goalEdit.goal} preset={goalEdit.preset} onClose={() => setGoalEdit(null)}
          onRemove={goalEdit.goal ? () => { setRemovingGoal(goalEdit.goal); setGoalEdit(null) } : undefined}
        />
      )}
      {balanceAccount && balanceResult && (
        <BalanceDialog key={`${balanceAccount.id}:${m}`} account={balanceAccount} month={m} tables={tables} household={household} onClose={() => setBalanceFor(null)} />
      )}
      {currentBalance && mainLine && engine.main?.months[m] && (
        <CurrentBalanceDialog
          key={m} title={mainLine.label} month={m} tables={tables} household={household} onClose={() => setCurrentBalance(false)}
        />
      )}
      {balances && <MonthBalancesDialog key={m} month={m} tables={tables} engine={engine} household={household} onClose={() => setBalances(false)} />}
      {estimateCategory && (
        <EstimateDialog
          key={`${estimateCategory.id}:${m}`} category={estimateCategory} month={m} tables={tables} engine={engine} household={household}
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
      {poolNew && <PoolDialog pool={null} savings={savingsAccounts} baseCurrency={ccy} locale={locale} fromMonth={m} freeOf={freeOf} onClose={() => setPoolNew(false)} />}
      {topUpFor && <TopUpDialog key={`${topUpFor}:${m}`} tables={tables} engine={engine} household={household} poolId={topUpFor} month={m} onClose={() => setTopUpFor(null)} />}
      {accountEditing && (
        <HouseholdAccountDialog
          key={accountEditing.id} account={accountEditing} entities={tables.entities} baseCurrency={ccy} locale={locale} startMonth={household.startMonth}
          rows={tables.rows} onRowAdded={onAdded}
          onClose={() => setAccountEdit(null)} removeLabel={settingUp ? 'Delete' : undefined}
          onRemove={() => { setAccountEdit(null); removeFrom({ kind: 'account', id: accountEditing.id }) }}
        />
      )}
      {poolEditing && (
        <PoolDialog
          key={poolEditing.id} pool={poolEditing} savings={savingsAccounts} baseCurrency={ccy} locale={locale}
          onClose={() => setPoolEdit(null)} removeLabel={settingUp ? 'Delete' : undefined}
          onRemove={() => { setPoolEdit(null); removeFrom({ kind: 'pool', id: poolEditing.id }) }}
        />
      )}
      {removing && <RemoveDialog target={removing} tables={tables} household={household} onClose={() => setRemoving(null)} />}
      {removingGoal && <RemoveDialog target={{ kind: 'goal', id: removingGoal.id }} tables={tables} household={household} onClose={() => setRemovingGoal(null)} />}
    </div>
  )
}
