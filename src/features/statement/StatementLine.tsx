import type { ReactNode } from 'react'
import { ArrowDownToLine, ChevronRight, Equal, Repeat, Target, UserRound } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Chip } from '@/components/ui/chip'
import { InfoTip } from '@/components/InfoTip'
import { Tick } from '@/components/Tick'
import { cn } from '@/lib/utils'
import { ESTIMATE_SHADE, ruleText, type DoneState } from '@/app/display'
import { formatAmount, formatPercent, formatShare } from '@/app/format'
import type { HelpKey } from '@/app/help'
import { HUES, type Hue } from '@/app/hues'
import type { GoalProgress, StatementHue, StatementLine as Line } from '@/engine'

/** What every line of a side needs to draw itself. The working parts are optional: a side without them is read-only. */
export interface LineContext {
  locale: string
  /** The household currency. */
  ccy: string
  /** The position's sides carry a change column beside the balance. */
  withChange: boolean
  isOpen: (line: Line) => boolean
  onToggle: (line: Line) => void
  goalText: (g: GoalProgress) => { text: string; cls: string }
  /** A closed month is locked: no ticks, no editor. */
  closed?: boolean
  /** How much of a row or an item is done; null when there is nothing to tick. Leave out for a side without ticks. */
  doneOf?: (line: Line) => { done: number; total: number; state: DoneState } | null
  onTick?: (line: Line, done: boolean) => void
  /** Open a row's dialog: its amount and, where it can carry one, its rule. */
  onEdit?: (rowId: string) => void
  /** The line (or row) a tick is being saved for. */
  busy?: string | null
  /** What sits at the foot of a group or an opened category: the controls that add a row or a category there. */
  footer?: (line: Line) => ReactNode
  /** Set a goal on a line that can have one, or edit the one it has. */
  onGoal?: (line: Line, goal?: GoalProgress) => void
  /** Enter what an account really held at the end of the month. */
  onBalance?: (accountId: string) => void
  /** The same for the line of the current accounts, which takes a balance for each of them. */
  onCurrentBalance?: () => void
  /** Set or change a category's estimate; "Not broken down yet" opens it too. */
  onEstimate?: (categoryId: string) => void
  /** The rule symbol on an account or a virtual account: open the dialog of the row that fills it. Leave out to show the rule without the button. */
  onRule?: (line: Line) => void
  /** Top up a virtual account that is short this month. */
  onTopUp?: (poolId: string) => void
  /** The "…" after a row's name: the Grid's row menu (rename, category, archive or delete, …). */
  rowMenu?: (rowId: string) => ReactNode
  /** The "…" after any other line's name: a category's menu, or the way into an account's or virtual account's dialog. */
  menu?: (line: Line) => ReactNode
}

const HUE: Record<StatementHue, Hue> = { income: HUES.income, expense: HUES.expense, transfer: HUES.transfer, worth: HUES.worth, pool: HUES.pool }

/** Lines that explain themselves behind an (i). */
const TIP: Record<string, HelpKey> = {
  main: 'statement.mainAccount',
  free: 'statement.free',
  'net-worth': 'statement.netWorth',
  'set-aside': 'statement.setAside',
  'from-accounts': 'statement.fromAccounts',
}

/** Left padding by level. A group's lines stay on its level (their chevron slot indents them); anything else opens one level in. */
const INDENT = ['pl-2', 'pl-7', 'pl-12', 'pl-16']
export const CHANGE_COL = 'w-20 shrink-0 text-right tabular-nums md:w-24'
export const AMOUNT_COL = 'w-24 shrink-0 text-right tabular-nums md:w-28'
/**
 * A line's "…": 20 px so the line keeps its height, shown while the line is hovered or the control has the focus, and
 * always (and finger-sized) where the pointer is a finger.
 */
export const LINE_MENU = 'size-5 opacity-0 group-hover/line:opacity-100 focus:opacity-100 focus-visible:opacity-100 data-popup-open:opacity-100 pointer-coarse:size-8 pointer-coarse:opacity-100'
const ROW = 'flex min-h-11 items-center gap-1.5 pr-2 text-sm md:min-h-7 md:text-xs'
/** The name with its tags: one line where there is room, the tags on a second line where there is not. */
const LABEL = 'flex min-w-0 flex-1 flex-wrap items-center gap-x-1.5 gap-y-0.5 py-1'
const CHEVRON_SLOT = 'flex w-3.5 shrink-0 items-center justify-center self-stretch'
const TICK_SLOT = 'size-11 shrink-0 md:size-6'
/** As wide as the tick, with no height of its own: the place a tick would take on a line that has none. */
const TICK_GAP = 'w-11 shrink-0 md:w-6'
/** A control on a line whose own button covers the whole line: it stays above that button. */
const ABOVE = 'relative z-10'

export function changeText(change: number, ccy: string, locale: string): string {
  return change === 0 ? '·' : formatAmount(change, ccy, locale, { sign: 'exceptZero' })
}

export function StatementLines({ lines, level, ctx, parent }: { lines: Line[]; level: number; ctx: LineContext; parent?: Line }) {
  return (
    <ul className="divide-y divide-border/60">
      {lines.map((l) => <StatementLineItem key={l.id} line={l} level={level} ctx={ctx} parent={parent} />)}
    </ul>
  )
}

/**
 * One line of the Statement (DESIGN.md §7). A group is a heading on its hue's tint with its lines always under it; a
 * category, an account or an itemized row opens as an accordion; a row and its items carry a tick and open the row's
 * one dialog; everything else is a name, its tags and its amount. A transfer that feeds an account, and that account,
 * carry the rule symbol.
 */
function StatementLineItem({ line, level, ctx, parent }: { line: Line; level: number; ctx: LineContext; parent?: Line }) {
  const { locale, ccy } = ctx
  const group = line.kind === 'group'
  const item = line.kind === 'item'
  const rowLike = line.kind === 'row' || item
  const foot = (group || line.kind === 'category') ? ctx.footer?.(line) : null
  // a category opens even while it is empty: its first row is added inside it
  const expandable = !group && (line.children.length > 0 || !!line.goals?.length || (line.kind === 'category' && !!foot))
  const canGoal = !!ctx.onGoal && (line.kind === 'pool' || (line.kind === 'account' && !!line.accountId) || line.id === 'net-worth')
  const open = group || (expandable && ctx.isOpen(line))
  const listId = `st-${line.id}`
  const hue = line.hue ? HUE[line.hue] : undefined
  const quiet = line.kind === 'note' || line.memo || line.skipped
  const tip = TIP[line.id]
  const inner = group ? level : level + 1
  const pad = INDENT[Math.min(level, INDENT.length - 1)]
  /** A row shown under its account's name keeps its own name in what its controls are called. */
  const nameOf = (l: Line) => (l.ownName ? `${l.label}, ${l.ownName}` : l.label)
  /** An item is named with its row, so every tick and button on the page has a name of its own. */
  const fullLabel = item && parent ? `${nameOf(parent)}: ${line.label}` : nameOf(line)

  const amountText = line.empty ? '·' : formatAmount(line.amount, line.currency ?? ccy, locale)
  const shaded = !!line.estimate && !line.empty
  const amount = (
    <span
      className={cn(
        AMOUNT_COL,
        group && 'font-medium',
        line.empty && 'text-muted-foreground/40',
        quiet && 'text-muted-foreground',
        line.amount < 0 && !line.empty && line.kind !== 'note' && 'text-expense',
        line.skipped && 'line-through',
      )}
    >
      {/* the negative margin keeps the shaded digits in their column */}
      {shaded ? <span data-estimate className={cn('-mr-1', ESTIMATE_SHADE)}>{amountText}</span> : amountText}
    </span>
  )
  const name = (
    <span className={cn('min-w-0 truncate', group && cn('font-semibold', hue?.text), (line.kind === 'category' || line.kind === 'account' || line.kind === 'source') && 'font-medium', quiet && 'text-muted-foreground', line.skipped && 'line-through')}>
      {line.label}
    </span>
  )
  const tags = (
    <>
      {item && line.scheduled && <Repeat className="size-3 shrink-0 text-muted-foreground" aria-hidden />}
      {line.accountKind && <span className="shrink-0 text-[11px] text-muted-foreground">{line.accountKind}</span>}
      {line.native && (
        <>
          <Chip tone="zinc">{line.native.currency}</Chip>
          <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">{formatAmount(line.native.amount, line.native.currency, locale)}</span>
        </>
      )}
      {line.missingRate && <Chip tone="rose">no rate</Chip>}
      {line.net != null && <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">net {formatAmount(line.net, ccy, locale)}</span>}
      {line.budget != null && <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">estimate {formatAmount(line.budget, ccy, locale)}</span>}
      {line.chip && <Chip tone="zinc">{line.chip}</Chip>}
      {!!line.paidFor?.length && <span className="min-w-0 max-w-64 truncate text-[11px] text-muted-foreground" title={line.paidFor.join(', ')}>for {line.paidFor.join(', ')}</span>}
      {line.ownName && <span className="min-w-0 max-w-64 truncate text-[11px] text-muted-foreground" title={line.ownName}>{line.ownName}</span>}
      {line.note && <span className="min-w-0 max-w-64 truncate text-[11px] text-muted-foreground" title={line.note}>{line.note}</span>}
      {line.short != null && line.kind === 'pool' && <Chip tone="rose">short {formatAmount(line.short, ccy, locale)}</Chip>}
      {line.short != null && line.kind === 'source' && (
        <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">{formatAmount(line.short, ccy, locale)} more than it held{line.shortFrom ? `, taken from ${line.shortFrom}` : ''}</span>
      )}
      {line.adjustment != null && <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">entered, {formatAmount(line.adjustment, ccy, locale, { sign: 'exceptZero' })} against the plan</span>}
      {line.skipped && <Chip tone="zinc">skipped</Chip>}
      {line.goals?.map((g) => <GoalMark key={g.goal.id} goal={g} locale={locale} />)}
    </>
  )
  const below = open && (line.children.length > 0 || !!line.goals?.length || !!foot) && (
    <div id={group ? undefined : listId} className="divide-y divide-border/60 border-t border-border/60">
      {!!line.goals?.length && <GoalDetail goals={line.goals} line={line} level={inner} ctx={ctx} />}
      {line.children.length > 0 && <StatementLines lines={line.children} level={inner} ctx={ctx} parent={line} />}
      {foot && <div className={cn('flex flex-wrap items-center gap-x-1 gap-y-1 py-1 pr-2 text-xs', INDENT[Math.min(inner, INDENT.length - 1)])}>{foot}</div>}
    </div>
  )

  if (rowLike) {
    const working = !ctx.closed && !!ctx.doneOf
    const d = working ? ctx.doneOf!(line) : null
    // one dialog per row: a line the app works out opens it too when a rule does the working out (the dialog then
    // shows the rule); any other automatic line has nothing to change
    const editable = !ctx.closed && !!ctx.onEdit && !!line.rowId && (!line.automatic || !!line.rule)
    // what is left of a category's estimate is worked out, so the line opens the estimate it comes from
    const estimateOf = !ctx.closed && ctx.onEstimate ? line.estimateFor : undefined
    const busy = ctx.busy != null && (ctx.busy === line.id || ctx.busy === line.rowId || ctx.busy.startsWith(`${line.rowId}:`))
    const said = `${fullLabel}: ${line.empty ? 'empty' : amountText}${shaded ? ', an estimate' : ''}`
    // a row carries its menu; what is left of an estimate is not a row of its own, and a closed month changes nothing
    const menu = !ctx.closed && line.kind === 'row' && line.rowId && line.estimateFor == null ? ctx.rowMenu?.(line.rowId) : null
    const press = estimateOf ? () => ctx.onEstimate!(estimateOf) : editable ? () => ctx.onEdit!(line.rowId!) : null
    // A line that opens something can hold more controls: the rule symbol, the menu. So the line's button is its name,
    // stretched over the whole line, and the other controls sit above it. The rule symbol opens the same dialog: it
    // stays a button so that it says the rule when it is pointed at or read out.
    const main = press ? (
      <div className="relative -mr-2 flex min-w-0 flex-1 items-center gap-1.5 self-stretch rounded pr-2 hover:bg-muted">
        <span className={LABEL}>
          <button
            type="button" aria-label={said} onClick={press}
            className={cn('min-w-0 truncate rounded text-left outline-none after:absolute after:inset-0 after:rounded focus-visible:after:ring-2 focus-visible:after:ring-inset focus-visible:after:ring-ring', quiet && 'text-muted-foreground', line.skipped && 'line-through')}
          >
            {line.label}
          </button>
          {tags}
          {line.rule && <RuleMark line={line} ctx={{ ...ctx, onRule: press }} className={ABOVE} />}
          {menu && <span className={cn(ABOVE, 'inline-flex')}>{menu}</span>}
        </span>
        {amount}
      </div>
    ) : (
      <>
        <span className={LABEL}>
          {name}
          {tags}
          {line.rule && <RuleMark line={line} ctx={{ ...ctx, onRule: undefined }} />}
          {menu}
        </span>
        {amount}
      </>
    )
    return (
      <li>
        <div className={cn(ROW, pad, 'group/line', item && 'bg-muted/20')} data-line={line.id}>
          {expandable ? (
            <button
              type="button" aria-label={`Items of ${nameOf(line)}`} aria-expanded={open} aria-controls={listId} onClick={() => ctx.onToggle(line)}
              className={cn(CHEVRON_SLOT, 'rounded outline-none focus-visible:ring-2 focus-visible:ring-ring')}
            >
              <ChevronRight className={cn('size-3.5 shrink-0 text-muted-foreground transition-transform', open && 'rotate-90')} aria-hidden />
            </button>
          ) : <span className={CHEVRON_SLOT} aria-hidden />}
          {working && (d ? (
            <Tick done={d.done} total={d.total} state={d.state} label={`${fullLabel} done`} disabled={busy} onToggle={() => ctx.onTick?.(line, d.state !== 'all')} className={cn(TICK_SLOT, 'md:rounded')} dotClassName="md:size-3" />
          ) : <span className={TICK_SLOT} aria-hidden />)}
          {main}
        </div>
        {below}
      </li>
    )
  }

  // Among rows that carry a tick, a line without one keeps the tick's place, so the names of a group stay in one
  // column; what such a line opens to follows it, so it stays further in than its heading.
  const untickedAmongRows = line.kind === 'source' || line.kind === 'figure' || (line.kind === 'note' && parent?.kind === 'source')
  const tickGap = !ctx.closed && !!ctx.doneOf && untickedAmongRows ? <span className={TICK_GAP} aria-hidden /> : null
  // A line that opens is pressed anywhere: its button is stretched over the whole line (as a row's is), and the other
  // controls on it sit above that.
  const head = expandable ? (
    <button
      type="button" aria-expanded={open} aria-controls={listId} onClick={() => ctx.onToggle(line)}
      className="flex min-w-0 max-w-full items-center gap-1.5 rounded text-left outline-none after:absolute after:inset-0 after:rounded focus-visible:after:ring-2 focus-visible:after:ring-inset focus-visible:after:ring-ring"
    >
      <ChevronRight className={cn('size-3.5 shrink-0 text-muted-foreground transition-transform', open && 'rotate-90')} aria-hidden />
      {tickGap}
      {name}
    </button>
  ) : (
    <span className="flex min-w-0 max-w-full items-center gap-1.5">
      {!group && <span className="w-3.5 shrink-0" aria-hidden />}
      {tickGap}
      {name}
    </span>
  )

  return (
    <li>
      <div className={cn(ROW, pad, 'group/line', group && hue?.tint, expandable && 'relative hover:bg-muted/50')} data-line={line.id}>
        <div className={LABEL}>
          {head}
          {tags}
          {line.rule && <RuleMark line={line} ctx={ctx} className={ABOVE} />}
          {line.short != null && line.poolId && ctx.onTopUp && (
            <Button size="xs" variant="outline" className={ABOVE} aria-label={`Top up ${line.label}`} onClick={() => ctx.onTopUp!(line.poolId!)}>Top up…</Button>
          )}
          {tip && <InfoTip help={tip} className={ABOVE} />}
          {canGoal && !line.goals?.length && (
            <button
              type="button" aria-label={`Set a goal for ${line.label}`} title="Set a goal" onClick={() => ctx.onGoal!(line)}
              className={cn(ABOVE, 'inline-flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground opacity-0 outline-none hover:bg-muted hover:text-foreground focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring group-hover/line:opacity-100 pointer-coarse:size-8 pointer-coarse:opacity-100')}
            >
              <Target className="size-3.5" aria-hidden />
            </button>
          )}
          {!ctx.closed && ctx.menu && <span className={cn(ABOVE, 'inline-flex empty:hidden')}>{ctx.menu(line)}</span>}
        </div>
        {ctx.withChange && <span className={cn(CHANGE_COL, 'text-muted-foreground', group && 'font-medium')}>{line.change != null ? changeText(line.change, ccy, locale) : ''}</span>}
        {(ctx.onBalance && line.accountId) || (ctx.onCurrentBalance && line.currentAccountIds?.length) ? (
          <button
            type="button" aria-label={`${line.label} balance: ${amountText}${line.entered ? ', entered' : ''}`} onClick={() => (line.accountId ? ctx.onBalance!(line.accountId) : ctx.onCurrentBalance!())}
            className={cn(AMOUNT_COL, ABOVE, '-my-1 rounded py-1 outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring', line.amount < 0 && 'text-expense', line.entered && 'underline decoration-dotted underline-offset-4')}
          >
            {amountText}
          </button>
        ) : amount}
      </div>
      {below}
    </li>
  )
}

/**
 * The rule symbol (DESIGN.md §7): how the amount for an account is worked out, on the transfer line and on the account
 * it feeds, and how an adult's pocket money is. An arrow to a line for the rest, the percentage for a share of income,
 * the percentage and a person for a share of the adult's own income, the percentage and the arrow for a share of what
 * is left, an equals sign for a fixed amount (faint where there is no rule yet). A button when the
 * rule can be changed from here (it opens the row's dialog), the bare symbol otherwise; its name says the rule in full.
 */
function RuleMark({ line, ctx, className }: { line: Line; ctx: LineContext; className?: string }) {
  const rule = line.rule
  if (!rule) return null
  const said = rule.kind === 'none' ? `Set a rule for ${line.label}` : `Rule for ${line.label}: ${ruleText(rule, ctx.locale)}`
  const pct = rule.share != null ? <span className="tabular-nums">{formatShare(rule.share, ctx.locale)}</span> : null
  const glyph = rule.kind === 'rest' ? <ArrowDownToLine className="size-3.5" aria-hidden />
    : rule.kind === 'share-of-income' ? pct
    : rule.kind === 'share-of-own-income' ? <>{pct}<UserRound className="size-3" aria-hidden /></>
    : rule.kind === 'share-of-rest' ? <>{pct}<ArrowDownToLine className="size-3" aria-hidden /></>
    : <Equal className="size-3.5" aria-hidden />
  const look = cn(
    'inline-flex h-5 min-w-5 shrink-0 items-center justify-center gap-0.5 rounded px-0.5 text-[11px] text-muted-foreground',
    (rule.kind === 'none' || rule.kind === 'idle') && 'text-muted-foreground/50',
    className,
  )
  if (!ctx.onRule) return <span className={look} title={said} data-rule={rule.kind}>{glyph}<span className="sr-only">{said}</span></span>
  return (
    <button
      type="button" aria-label={said} title={said} data-rule={rule.kind} onClick={() => ctx.onRule!(line)}
      className={cn(look, 'outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring pointer-coarse:h-8 pointer-coarse:min-w-8')}
    >
      {glyph}
    </button>
  )
}

/** The small mark on a line a goal watches: the percentage, coloured only when the goal is late or reached. */
function GoalMark({ goal, locale }: { goal: GoalProgress; locale: string }) {
  const pct = formatPercent(goal.progress, locale)
  const late = goal.status === 'late' || goal.status === 'broken'
  return (
    <span className="inline-flex shrink-0 items-center gap-1" title={goal.goal.name}>
      <span className={cn('inline-flex items-center gap-0.5 text-[11px] tabular-nums text-muted-foreground', goal.status === 'reached' && HUES.income.text)}>
        <Target className={cn('size-3', goal.status !== 'reached' && HUES.goal.text)} aria-hidden />
        <span className="sr-only">Goal {goal.goal.name}:</span>
        {pct}
      </span>
      {late && <Chip tone="rose">{goal.status === 'broken' ? 'broken' : 'late'}</Chip>}
    </span>
  )
}

/** Under an opened line: each goal's name, its bar and the sentence that says how far the plan gets. */
function GoalDetail({ goals, line: owner, level, ctx }: { goals: GoalProgress[]; line: Line; level: number; ctx: LineContext }) {
  return (
    <div className={cn('space-y-2 bg-muted/20 py-2 pr-2 text-xs', INDENT[Math.min(level, INDENT.length - 1)])}>
      {goals.map((g) => {
        const line = ctx.goalText(g)
        const pct = Math.round(g.progress * 100)
        return (
          <div key={g.goal.id} className="max-w-md space-y-1 pl-5">
            <div className="flex items-baseline justify-between gap-3">
              <span className="font-medium">{g.goal.name}</span>
              <span className="flex items-center gap-2">
                <span className={cn('tabular-nums', g.status === 'reached' && HUES.income.text)}>{formatPercent(g.progress, ctx.locale)}</span>
                {ctx.onGoal && <Button size="xs" variant="ghost" aria-label={`Edit goal ${g.goal.name}`} onClick={() => ctx.onGoal!(owner, g)}>Edit</Button>}
              </span>
            </div>
            <div role="progressbar" aria-label={g.goal.name} aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} className="h-2 w-full overflow-hidden rounded-full bg-goal-tint">
              <div className={cn('h-full rounded-full', HUES.goal.fill, g.status === 'reached' && HUES.income.fill)} style={{ width: `${pct}%` }} />
            </div>
            <p className={cn('text-[11px] leading-[15px]', line.cls)}>{line.text}</p>
          </div>
        )
      })}
    </div>
  )
}
