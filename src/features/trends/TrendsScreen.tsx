import { useMemo, useState } from 'react'
import { LineChart, type ChartLine } from '@/components/charts/LineChart'
import { PageHeader } from '@/components/PageHeader'
import { Segmented } from '@/components/Segmented'
import { Island } from '@/components/ui/island'
import { formatAmount, formatAxis, formatMonth } from '@/app/format'
import { writePref } from '@/app/prefs'
import { activeHousehold, useEngine, useTables } from '@/app/useEngine'
import { TREND_SUBJECTS, buildTrends, trendChange, type TrendSubject } from '@/engine'
import { addMonths, compareMonths, currencyExponent, monthOfDate } from '@/model'
import { HORIZONS, projectTables, trendMonths, type Horizon } from '@/store'
import { HORIZON_LABEL, SUBJECTS, rememberedHorizon, rememberedSubjects } from './subjects'
import { TrendTile } from './TrendTile'

/**
 * Trends (DESIGN.md §11): how net worth, income, expenses, accounts and debts move over the months, what was and
 * what the plan says will be. Five tiles say where each stands this month and are the switches that put a subject on
 * the chart; "Amounts" draws the chosen ones as lines on one scale. The figures are the Statement's own, month by
 * month (`buildTrends`), and looking past the plan's end runs the plan's calculation for more months without making
 * the plan longer (`projectTables`). Nothing is edited here.
 */
export function TrendsScreen() {
  const tables = useTables()
  const household = activeHousehold(tables)
  const today = monthOfDate()
  const [horizon, setHorizon] = useState<Horizon>(rememberedHorizon)
  const [on, setOn] = useState<TrendSubject[]>(rememberedSubjects)
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

  const toggle = (s: TrendSubject) => {
    const next = TREND_SUBJECTS.filter((k) => (k === s ? !on.includes(k) : on.includes(k)))
    setOn(next)
    writePref('trends.subjects', next)
  }
  const choose = (h: Horizon) => {
    setHorizon(h)
    setAt(null)
    writePref('trends.horizon', h)
  }

  const lines: ChartLine[] = on.map((s) => ({ id: s, label: SUBJECTS[s].label, color: SUBJECTS[s].color, values: points.map((p) => p.totals[s]) }))
  const moved = (i: number, s: TrendSubject) => {
    const d = trendChange(points, i, s)
    return d == null ? null : d === 0 ? 'no change' : `${formatAmount(d, ccy, locale, { sign: 'always' })} from ${formatMonth(months[i - 1], locale)}`
  }

  return (
    <div className="space-y-4">
      <PageHeader title="Trends" subline={`${household.name} · ${formatMonth(months[0], locale)} – ${formatMonth(months[months.length - 1], locale)}`}>
        <span className="text-muted-foreground">Looks ahead</span>
        <Segmented label="How far ahead" value={String(horizon)} onChange={(v) => choose(HORIZONS.find((h) => String(h) === v) ?? 'plan')} options={HORIZONS.map((h) => ({ value: String(h), label: HORIZON_LABEL[h] }))} />
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
      </Island>

      <Island title="Amounts" help="trends.amounts" data-testid="trend-amounts">
        {lines.length === 0 ? (
          <p className="px-1 py-10 text-center text-xs text-muted-foreground">Press a tile above to put it on the chart.</p>
        ) : (
          <LineChart
            months={months} lines={lines} planFrom={planFrom} now={now} at={at} onAt={setAt} locale={locale}
            unit={10 ** currencyExponent(ccy)} axisText={(v) => formatAxis(v, ccy, locale)}
            label={`${lines.map((l) => l.label).join(', ')} from ${formatMonth(months[0], locale, 'long')} to ${formatMonth(months[months.length - 1], locale, 'long')}. The arrow keys read a month.`}
            tip={(i) => (
              <>
                <p className="mb-1 font-medium">{formatMonth(months[i], locale, 'long')}{i >= planFrom && <span className="font-normal text-muted-foreground"> · {i === now ? 'now' : 'plan'}</span>}</p>
                <ul className="space-y-1">
                  {on.map((s) => (
                    <li key={s} className="grid grid-cols-[auto_1fr] items-baseline gap-x-2">
                      <span className="h-0.5 w-3 self-center rounded-full" style={{ background: SUBJECTS[s].color }} aria-hidden />
                      <span><span className="font-semibold tabular-nums">{money(points[i].totals[s])}</span> <span className="text-muted-foreground">{SUBJECTS[s].label}</span></span>
                      {moved(i, s) && <span className="col-start-2 text-[11px] tabular-nums text-muted-foreground">{moved(i, s)}</span>}
                    </li>
                  ))}
                </ul>
              </>
            )}
          />
        )}
      </Island>
    </div>
  )
}
