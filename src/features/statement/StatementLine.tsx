import { ChevronRight, Repeat, Target } from 'lucide-react'
import { Chip } from '@/components/ui/chip'
import { InfoTip } from '@/components/InfoTip'
import { cn } from '@/lib/utils'
import { statusClass } from '@/app/display'
import { formatAmount, formatPercent } from '@/app/format'
import type { HelpKey } from '@/app/help'
import { HUES, type Hue } from '@/app/hues'
import type { GoalProgress, StatementHue, StatementLine as Line } from '@/engine'

/** What every line of a side needs to draw itself. */
export interface LineContext {
  locale: string
  /** The household currency. */
  ccy: string
  /** The position's sides carry a change column beside the balance. */
  withChange: boolean
  isOpen: (line: Line) => boolean
  onToggle: (line: Line) => void
  goalText: (g: GoalProgress) => { text: string; cls: string }
}

const HUE: Record<StatementHue, Hue> = { income: HUES.income, expense: HUES.expense, transfer: HUES.transfer, worth: HUES.worth, pool: HUES.pool }

/** Lines that explain themselves behind an (i). */
const TIP: Record<string, HelpKey> = {
  main: 'statement.mainAccount',
  free: 'statement.free',
  'net-worth': 'statement.netWorth',
  'set-aside': 'statement.setAside',
  sources: 'derived.fromSavings',
}

/** Left padding by level. A group's lines stay on its level (their chevron slot indents them); anything else opens one level in. */
const INDENT = ['pl-2', 'pl-7', 'pl-12', 'pl-16']
export const CHANGE_COL = 'w-20 shrink-0 text-right tabular-nums md:w-24'
export const AMOUNT_COL = 'w-24 shrink-0 text-right tabular-nums md:w-28'
const ROW = 'flex min-h-11 items-center gap-1.5 pr-2 text-sm md:min-h-7 md:text-xs'
/** The name with its tags: one line where there is room, the tags on a second line where there is not. */
const LABEL = 'flex min-w-0 flex-1 flex-wrap items-center gap-x-1.5 gap-y-0.5 py-1'

export function changeText(change: number, ccy: string, locale: string): string {
  return change === 0 ? '·' : formatAmount(change, ccy, locale, { sign: 'exceptZero' })
}

export function StatementLines({ lines, level, ctx }: { lines: Line[]; level: number; ctx: LineContext }) {
  return (
    <ul className="divide-y divide-border/60">
      {lines.map((l) => <StatementLineItem key={l.id} line={l} level={level} ctx={ctx} />)}
    </ul>
  )
}

/**
 * One line of the Statement (DESIGN.md §7). A group is a heading on its hue's tint with its lines always under it; a
 * category, an account or an itemized row opens as an accordion; everything else is a name, its tags and its amount.
 */
function StatementLineItem({ line, level, ctx }: { line: Line; level: number; ctx: LineContext }) {
  const { locale, ccy } = ctx
  const group = line.kind === 'group'
  const expandable = !group && (line.children.length > 0 || !!line.goals?.length)
  const open = group || (expandable && ctx.isOpen(line))
  const listId = `st-${line.id}`
  const hue = line.hue ? HUE[line.hue] : undefined
  const item = line.kind === 'item'
  const quiet = line.kind === 'note' || line.memo || line.skipped
  const tip = TIP[line.id]
  const inner = group ? level : level + 1
  const pad = (l: number) => INDENT[Math.min(l, INDENT.length - 1)]

  const amountText = line.empty ? '·' : formatAmount(line.amount, line.currency ?? ccy, locale)
  const amount = (
    <span
      className={cn(
        AMOUNT_COL,
        group && 'font-medium',
        line.empty && 'text-muted-foreground/40',
        quiet && 'text-muted-foreground',
        !line.empty && line.status && (line.kind === 'row' || item) && statusClass[line.status],
        line.amount < 0 && !line.empty && line.kind !== 'note' && 'text-expense',
        line.skipped && 'line-through',
      )}
    >
      {amountText}
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
      {line.native && (
        <>
          <Chip tone="zinc">{line.native.currency}</Chip>
          <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">{formatAmount(line.native.amount, line.native.currency, locale)}</span>
        </>
      )}
      {line.missingRate && <Chip tone="rose">no rate</Chip>}
      {line.net != null && <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">net {formatAmount(line.net, ccy, locale)}</span>}
      {line.chip && <Chip tone="zinc">{line.chip}</Chip>}
      {line.skipped && <Chip tone="zinc">skipped</Chip>}
      {line.goals?.map((g) => <GoalMark key={g.goal.id} goal={g} locale={locale} />)}
    </>
  )
  const head = expandable ? (
    <button
      type="button" aria-expanded={open} aria-controls={listId} onClick={() => ctx.onToggle(line)}
      className="flex min-w-0 max-w-full items-center gap-1.5 rounded text-left outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
    >
      <ChevronRight className={cn('size-3.5 shrink-0 text-muted-foreground transition-transform', open && 'rotate-90')} aria-hidden />
      {name}
    </button>
  ) : (
    <span className="flex min-w-0 max-w-full items-center gap-1.5">
      {!group && <span className="w-3.5 shrink-0" aria-hidden />}
      {name}
    </span>
  )

  return (
    <li>
      <div className={cn(ROW, pad(level), group && hue?.tint, item && 'bg-muted/20')} data-line={line.id}>
        <div className={LABEL}>
          {head}
          {tags}
          {tip && <InfoTip help={tip} />}
        </div>
        {ctx.withChange && <span className={cn(CHANGE_COL, 'text-muted-foreground', group && 'font-medium')}>{line.change != null ? changeText(line.change, ccy, locale) : ''}</span>}
        {amount}
      </div>
      {open && (line.children.length > 0 || !!line.goals?.length) && (
        <div id={group ? undefined : listId} className="border-t border-border/60">
          {!!line.goals?.length && <GoalDetail goals={line.goals} level={inner} ctx={ctx} />}
          {line.children.length > 0 && <StatementLines lines={line.children} level={inner} ctx={ctx} />}
        </div>
      )}
    </li>
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

/** Under an opened line: each goal's name, its bar and the sentence the Goals card uses. */
function GoalDetail({ goals, level, ctx }: { goals: GoalProgress[]; level: number; ctx: LineContext }) {
  return (
    <div className={cn('space-y-2 bg-muted/20 py-2 pr-2 text-xs', INDENT[Math.min(level, INDENT.length - 1)])}>
      {goals.map((g) => {
        const line = ctx.goalText(g)
        const pct = Math.round(g.progress * 100)
        return (
          <div key={g.goal.id} className="max-w-md space-y-1 pl-5">
            <div className="flex items-baseline justify-between gap-3">
              <span className="font-medium">{g.goal.name}</span>
              <span className={cn('tabular-nums', g.status === 'reached' && HUES.income.text)}>{formatPercent(g.progress, ctx.locale)}</span>
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
