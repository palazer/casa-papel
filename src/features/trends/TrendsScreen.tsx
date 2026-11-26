import { useMemo, useState } from 'react'
import { Target } from 'lucide-react'
import { DeltaBars, type DeltaRow } from '@/components/charts/DeltaBars'
import { LineChart, type ChartLine } from '@/components/charts/LineChart'
import { StackedColumns, type StackColumn, type StackPart } from '@/components/charts/StackedColumns'
import { InfoTip } from '@/components/InfoTip'
import { PageHeader } from '@/components/PageHeader'
import { Segmented } from '@/components/Segmented'
import { Island } from '@/components/ui/island'
import { ViewToggle } from '@/components/ui/view-toggle'
import { formatAmount, formatAxis, formatMonth, formatPercent } from '@/app/format'
import { readPref, writePref } from '@/app/prefs'
import { activeHousehold, useEngine, useTables } from '@/app/useEngine'
import { OTHER_PART, TREND_SUBJECTS, buildTrends, byYear, computeGoals, foldParts, isFlow, topParts, trendChange, type TrendPoint, type TrendSubject } from '@/engine'
import { goalStatusLine } from '@/features/goals/goalText'
import { cn } from '@/lib/utils'
import { addMonths, compareMonths, currencyExponent, monthDiff, monthOfDate, parseMonth } from '@/model'
import { HORIZONS, planEnd, projectTables, trendMonths, type Horizon } from '@/store'
import { FiguresTable, type FigureColumn } from './FiguresTable'
import { NET_WORTH_LINE, goalMarks, type GoalMark } from './goalMarks'
import { HORIZON_LABEL, OTHER_COLOR, PART_COLORS, SUBJECTS, rememberedHorizon, rememberedSubjects } from './subjects'
import { TrendTile } from './TrendTile'
import { txt } from '@/i18n'

const T = txt.trends.page

/**
 * Trends (DESIGN.md §11): how net worth, income, expenses, accounts and debts move over the months, what was and
 * what the plan says will be. Five tiles say where each stands this month and are the switches that put a subject on
 * the charts; "Amounts" draws the chosen ones as lines on one scale, and under it "Change from the month before"
 * draws how each moved, as a row of bars per subject on the same months. With one subject on, "Breakdown" turns its
 * line into columns stacked from its parts. A goal is a chip under the tiles: on, a net worth goal is drawn on the
 * net worth line and any other goal brings the balance it watches as a line, each with its amount across the chart,
 * a flag at the month it is due and a dot where the plan gets there. The figures are the Statement's own, month
 * by month (`buildTrends`), and looking past the plan's end runs the plan's calculation for more months without
 * making the plan longer (`projectTables`). Nothing is edited here.
 */
/** More months than this cannot be read as bars: they are drawn by year. */
const MONTHLY_BARS = 48

/** A bar's worth of months: one month, or the months of a year that are in view, with where they stand on the axis. */
interface Bucket extends TrendPoint {
  from: number
  to: number
}
export function TrendsScreen() {
  const tables = useTables()
  const household = activeHousehold(tables)
  const today = monthOfDate()
  const [horizon, setHorizon] = useState<Horizon>(rememberedHorizon)
  const [on, setOn] = useState<TrendSubject[]>(rememberedSubjects)
  /** One subject alone can be shown as its parts. */
  const [showParts, setShowParts] = useState(() => readPref('trends.breakdown', false))
  /** The goals that are on the chart; null until one is pressed: the net worth goals are on then. */
  const [goalIds, setGoalIds] = useState<string[] | null>(() => readPref<string[] | null>('trends.goals', null))
  /** "Figures as a table" is open. */
  const [figures, setFigures] = useState(false)
  /** The month pointed at, in every chart of the page. */
  const [at, setAt] = useState<number | null>(null)

  const months = useMemo(() => (household && tables ? trendMonths(household, tables, horizon, today) : []), [household, tables, horizon, today])
  const projected = useMemo(() => (tables ? projectTables(tables, months, today) : undefined), [tables, months, today])
  const engine = useEngine(projected, months)
  const trends = useMemo(() => (projected && engine ? buildTrends(projected, engine, months) : null), [projected, engine, months])

  if (!tables || !household || !engine || !trends) return null
  const { baseCurrency: ccy, locale } = household
  const { points } = trends
  const money = (v: number) => formatAmount(v, ccy, locale)
  const whole = (v: number) => formatAmount(v, ccy, locale, { compact: true })

  /** The current month in view; a plan that ended before today has none, and is all past. */
  const nowAt = months.indexOf(today)
  const now = nowAt >= 0 ? nowAt : null
  const planFrom = now ?? (compareMonths(today, months[0]) < 0 ? 0 : months.length)
  /** The month the tiles speak of: the current one, or the last in view. */
  const tileAt = now ?? months.length - 1

  const put = (next: TrendSubject[]) => {
    setOn(next)
    writePref('trends.subjects', next)
  }
  const toggle = (s: TrendSubject) => put(TREND_SUBJECTS.filter((k) => (k === s ? !on.includes(k) : on.includes(k))))
  const choose = (h: Horizon) => {
    setHorizon(h)
    setAt(null)
    writePref('trends.horizon', h)
  }

  /** The goals, read in the current month over the months in view: a longer look ahead can find the month a goal is reached. */
  const marks = goalMarks(computeGoals(projected ?? tables, engine, months[tileAt]), projected ?? tables, engine, months, locale)
  const chosen = (m: GoalMark) => (goalIds ? goalIds.includes(m.progress.goal.id) : m.progress.goal.kind === 'net-worth')
  /** A net worth goal is drawn on the net worth line, so it is on only while that line is. */
  const goalOn = (m: GoalMark) => chosen(m) && (m.line != null || m.undrawn != null || on.includes('netWorth'))
  const toggleGoal = (m: GoalMark) => {
    const turnOn = !goalOn(m)
    const next = marks.filter((x) => (x === m ? turnOn : chosen(x))).map((x) => x.progress.goal.id)
    setGoalIds(next)
    writePref('trends.goals', next)
    if (turnOn && !m.line && !m.undrawn && !on.includes('netWorth')) put(TREND_SUBJECTS.filter((k) => k === 'netWorth' || on.includes(k)))
  }
  const drawn = marks.filter((m) => goalOn(m) && !m.undrawn)
  const goalLines = drawn.flatMap((m) => (m.line ? [m.line] : []))
  const targets = drawn.flatMap((m) => (m.target && (m.target.line !== NET_WORTH_LINE || on.includes('netWorth')) ? [m.target] : []))
  const ahead = monthDiff(months[tileAt], months[months.length - 1])

  const lines: ChartLine[] = [...on.map((s) => ({ id: s, label: SUBJECTS[s].label, color: SUBJECTS[s].color, values: points.map((p) => p.totals[s]) })), ...goalLines]
  const unit = 10 ** currencyExponent(ccy)
  const axisText = (v: number) => formatAxis(v, ccy, locale)
  const span = T.fromTo(formatMonth(months[0], locale, 'long'), formatMonth(months[months.length - 1], locale, 'long'))

  /** The bars: a month each, or a year each on a long range. */
  const yearly = months.length > MONTHLY_BARS
  const buckets = (yearly ? byYear(points) : points).reduce<Bucket[]>((list, p) => {
    const from = list.length ? list[list.length - 1].to + 1 : 0
    return [...list, { ...p, from, to: from + p.span - 1 }]
  }, [])
  const bucketAt = (i: number) => buckets.findIndex((b) => i >= b.from && i <= b.to)
  /** A year of which only some months are in view (the household's first) moved less than a whole one: it is not compared. */
  const partial = (b: Bucket) => yearly && b.span < 12
  const changeOf = (k: number, s: TrendSubject) => (isFlow(s) && k > 0 && (partial(buckets[k]) || partial(buckets[k - 1])) ? null : trendChange(buckets, k, s))
  const bucketName = (b: Bucket) => (yearly ? `${parseMonth(b.month).year}${partial(b) ? T.partYear(b.span) : ''}` : formatMonth(b.month, locale, 'long'))

  /** One subject as its parts: the six largest over the plan's months keep their name and colour, whatever range is in view. */
  const one = on.length === 1 && goalLines.length === 0 ? on[0] : null
  const broken = one != null && showParts
  const planLast = planEnd(household, tables, today)
  const picked = one ? topParts(trends, one, (m) => compareMonths(m, planLast) <= 0) : { shown: [], other: false }
  const stack: StackPart[] = [
    ...picked.shown.map((p, k) => ({ id: p.id, label: p.label, color: PART_COLORS[k] })),
    ...(picked.other ? [{ id: OTHER_PART, label: T.other, color: OTHER_COLOR }] : []),
  ]
  const columns: StackColumn[] = one ? buckets.map((b) => ({ from: b.from, to: b.to, parts: foldParts(b, one, picked.shown) })) : []
  const choosePartsView = (v: 'total' | 'parts') => {
    setShowParts(v === 'parts')
    writePref('trends.breakdown', v === 'parts')
  }

  const rows: DeltaRow[] = on.map((s) => ({ id: s, label: SUBJECTS[s].label, color: SUBJECTS[s].color, bars: buckets.map((b, k) => ({ from: b.from, to: b.to, value: changeOf(k, s) })) }))
  const moved = (i: number, values: number[]) => {
    if (i === 0) return null
    const d = values[i] - values[i - 1]
    return d === 0 ? T.noChange : T.changeFrom(formatAmount(d, ccy, locale, { sign: 'always' }), formatMonth(months[i - 1], locale))
  }

  /** What "Amounts" draws, as a table: the lines month by month, or the one subject and its parts column by column. */
  const planNote = (from: number, to: number) => (now != null && now >= from && now <= to ? T.now : to >= planFrom ? T.plan : undefined)
  const figureRows = broken
    ? buckets.map((b) => ({ key: b.month, label: bucketName(b), note: planNote(b.from, b.to) }))
    : months.map((m, i) => ({ key: m, label: formatMonth(m, locale), note: planNote(i, i) }))
  const figureColumns: FigureColumn[] = broken && one
    ? [
        { id: one, label: SUBJECTS[one].label, values: buckets.map((b) => b.totals[one]), changes: buckets.map((_, k) => changeOf(k, one)) },
        ...stack.map((p) => ({ id: p.id, label: p.label, values: columns.map((c) => c.parts[p.id] ?? 0) })),
      ]
    : lines.map((l) => ({ id: l.id, label: l.label, values: l.values, changes: l.values.map((v, i) => (i > 0 ? v - l.values[i - 1] : null)) }))

  return (
    <div className="space-y-4">
      <PageHeader title={T.trends} subline={`${household.name} · ${formatMonth(months[0], locale)} – ${formatMonth(months[months.length - 1], locale)}`}>
        <span className="text-muted-foreground">{T.looksAhead}</span>
        <Segmented label={T.howFarAhead} value={String(horizon)} onChange={(v) => choose(HORIZONS.find((h) => String(h) === v) ?? 'plan')} options={HORIZONS.map((h) => ({ value: String(h), label: HORIZON_LABEL[h] }))} />
      </PageHeader>

      <Island title={formatMonth(months[tileAt], locale, 'long')} help="trends.tiles" data-testid="trend-tiles">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
          {TREND_SUBJECTS.map((s) => {
            const change = trendChange(points, tileAt, s)
            return (
              <TrendTile
                key={s} label={SUBJECTS[s].label} color={SUBJECTS[s].color} on={on.includes(s)} onToggle={() => toggle(s)}
                value={whole(points[tileAt].totals[s])} change={change} changeText={change == null ? '' : whole(Math.abs(change))}
                since={tileAt > 0 ? formatMonth(addMonths(months[tileAt], -1), locale, 'long') : ''}
                values={points.map((p) => p.totals[s])} planFrom={planFrom}
              />
            )
          })}
        </div>
        {marks.length > 0 && (
          <div className="mt-2 px-0.5" data-testid="trend-goals">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{T.goals} <InfoTip help="trends.goals" /></span>
              {marks.map((m) => (
                <button
                  key={m.progress.goal.id} type="button" aria-pressed={goalOn(m)} onClick={() => toggleGoal(m)} title={goalStatusLine(m.progress, locale, ahead).text}
                  className={cn('inline-flex items-center gap-1 rounded-md border bg-card px-2 py-0.5 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring', goalOn(m) ? 'border-primary shadow-[inset_0_0_0_1px_var(--color-primary)]' : 'hover:bg-muted/50')}
                >
                  <Target className="size-3 text-goal" aria-hidden />
                  {m.progress.goal.name}
                  <span className="tabular-nums text-muted-foreground">{formatPercent(m.progress.progress, locale)}</span>
                </button>
              ))}
            </div>
            {/* what the plan says of every goal that is on, in the Statement's own sentence */}
            {marks.some(goalOn) && (
              <ul className="mt-1.5 space-y-0.5 text-xs" aria-label={T.goalsOnTheChart}>
                {marks.filter(goalOn).map((m) => {
                  const said = goalStatusLine(m.progress, locale, ahead)
                  return (
                    <li key={m.progress.goal.id}>
                      <span className="font-medium">{m.progress.goal.name}:</span> <span className={said.cls}>{said.text}</span>
                      {m.undrawn && !m.progress.problem && <span className="text-muted-foreground"> {m.undrawn}</span>}
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        )}
      </Island>

      <Island
        title={T.amounts} help="trends.amounts" data-testid="trend-amounts"
        // one subject alone can be read as its parts
        right={one && (
          <span className="flex items-center gap-1">
            <ViewToggle value={showParts ? 'parts' : 'total'} options={['total', 'parts'] as const} labels={{ total: txt.common.total, parts: T.breakdown }} onChange={choosePartsView} ariaLabel={T.shownAs(SUBJECTS[one].label)} />
            <InfoTip help="trends.breakdown" />
          </span>
        )}
      >
        {lines.length === 0 ? (
          <p className="px-1 py-10 text-center text-xs text-muted-foreground">{T.pressATileAbove}</p>
        ) : broken && one ? (
          <StackedColumns
            months={months} columns={columns} parts={stack} planFrom={planFrom} now={now} at={at} onAt={setAt} locale={locale} unit={unit} axisText={axisText}
            // net worth is not the height of its columns: what is owed stands below zero, and the line says what is left
            across={one === 'netWorth' ? { label: SUBJECTS.netWorth.label, color: SUBJECTS.netWorth.color, values: buckets.map((b) => b.totals.netWorth) } : undefined}
            label={T.breakdownSummary(SUBJECTS[one].label, stack.map((p) => p.label).join(', '), span, yearly)}
            tip={(i) => {
              const k = bucketAt(i)
              const b = buckets[k]
              return (
                <>
                  <p className="mb-1 font-medium">{bucketName(b)}{b.to >= planFrom && <span className="font-normal text-muted-foreground"> · {now != null && now >= b.from && now <= b.to ? T.now : T.plan}</span>}</p>
                  <p className="mb-1"><span className="font-semibold tabular-nums">{money(b.totals[one])}</span> <span className="text-muted-foreground">{SUBJECTS[one].label}</span></p>
                  <ul className="space-y-0.5 border-t pt-1">
                    {/* from the top of the column down */}
                    {[...stack].reverse().filter((p) => (columns[k].parts[p.id] ?? 0) !== 0).map((p) => (
                      <li key={p.id} className="grid grid-cols-[auto_1fr] items-baseline gap-x-2">
                        <span className="size-2 self-center rounded-[2px]" style={{ background: p.color }} aria-hidden />
                        <span><span className="font-medium tabular-nums">{money(columns[k].parts[p.id])}</span> <span className="text-muted-foreground">{p.label}</span></span>
                      </li>
                    ))}
                  </ul>
                </>
              )
            }}
          />
        ) : (
          <LineChart
            months={months} lines={lines} targets={targets} planFrom={planFrom} now={now} at={at} onAt={setAt} locale={locale} unit={unit} axisText={axisText}
            label={T.linesSummary(lines.map((l) => l.label).join(', '), span, targets.length, targets.map((t) => t.label).join(', '))}
            tip={(i) => (
              <>
                <p className="mb-1 font-medium">{formatMonth(months[i], locale, 'long')}{i >= planFrom && <span className="font-normal text-muted-foreground"> · {i === now ? T.now : T.plan}</span>}</p>
                <ul className="space-y-1">
                  {lines.map((l) => (
                    <li key={l.id} className="grid grid-cols-[auto_1fr] items-baseline gap-x-2">
                      <span className="h-0.5 w-3 self-center rounded-full" style={{ background: l.color }} aria-hidden />
                      <span><span className="font-semibold tabular-nums">{money(l.values[i])}</span> <span className="text-muted-foreground">{l.label}</span></span>
                      {moved(i, l.values) && <span className="col-start-2 text-[11px] tabular-nums text-muted-foreground">{moved(i, l.values)}</span>}
                    </li>
                  ))}
                </ul>
              </>
            )}
          />
        )}
      </Island>

      {rows.length > 0 && (
        <Island title={yearly ? T.changeFromTheYear : T.changeFromTheMonth} help="trends.changes" data-testid="trend-changes">
          <DeltaBars
            months={months} rows={rows} planFrom={planFrom} now={now} at={at} onAt={setAt} locale={locale} unit={unit} axisText={axisText}
            label={T.changesSummary(rows.map((r) => r.label).join(', '), yearly, span)}
            tip={(i) => {
              const k = bucketAt(i)
              const b = buckets[k]
              return (
                <>
                  <p className="mb-1 font-medium">{bucketName(b)}{b.to >= planFrom && <span className="font-normal text-muted-foreground"> · {now != null && now >= b.from && now <= b.to ? T.now : T.plan}</span>}</p>
                  <ul className="space-y-1">
                    {on.map((s) => {
                      const d = changeOf(k, s)
                      return (
                        <li key={s} className="grid grid-cols-[auto_1fr] items-baseline gap-x-2">
                          <span className="size-2 self-center rounded-[2px]" style={{ background: SUBJECTS[s].color }} aria-hidden />
                          <span><span className="font-semibold tabular-nums">{d == null ? '–' : d === 0 ? T.noChange : formatAmount(d, ccy, locale, { sign: 'always' })}</span> <span className="text-muted-foreground">{SUBJECTS[s].label}</span></span>
                          <span className="col-start-2 text-[11px] tabular-nums text-muted-foreground">
                            {d == null ? (k === 0 ? T.nothingBeforeItTo : T.aYearThatIs) : T.amountWhen(money(b.totals[s]), isFlow(s), yearly)}
                          </span>
                        </li>
                      )
                    })}
                  </ul>
                </>
              )
            }}
          />
        </Island>
      )}

      {/* the same figures without a chart: for a screen reader, for copying, for reading a month without pointing at it */}
      {lines.length > 0 && (
        <Island title={T.figuresAsATable} folded={!figures} onFold={(f) => setFigures(!f)} data-testid="trend-table">
          <FiguresTable
            rows={figureRows} columns={figureColumns} amount={money} change={(v) => formatAmount(v, ccy, locale, { sign: 'always' })}
            caption={T.tableCaption(figureColumns.map((c) => c.label).join(', '), span, broken, yearly)}
          />
        </Island>
      )}
    </div>
  )
}
