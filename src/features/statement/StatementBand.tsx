import type { ReactNode } from 'react'
import { Island } from '@/components/ui/island'
import { cn } from '@/lib/utils'
import { formatAmount } from '@/app/format'
import type { HelpKey } from '@/app/help'
import type { StatementBand as Band, StatementSide } from '@/engine'
import { AMOUNT_COL, CHANGE_COL, StatementLines, changeText, type LineContext } from './StatementLine'

/**
 * One half of the Statement (DESIGN.md §2, the statement frame): an island holding two sides, side by side from
 * 1024 px and stacked below it. Each side is a column whose total sits at the bottom, so on a wide screen the two
 * totals share a line, the way a T-account closes.
 */
export function StatementBand({ title, help, band, ctx, totals, amountHead, right }: {
  title: string
  help: HelpKey
  band: Band
  ctx: LineContext
  /** What the two totals are called. */
  totals: [string, string]
  /** The amount column's heading: the day the balances are read on. */
  amountHead?: string
  right?: ReactNode
}) {
  return (
    <Island title={title} help={help} right={right} bodyClassName="px-0 pb-0 pt-1" data-testid={`band-${band.left.key}`}>
      <div className="grid grid-cols-1 divide-border/60 max-lg:divide-y lg:grid-cols-2 lg:divide-x">
        <Side side={band.left} total={totals[0]} ctx={ctx} amountHead={amountHead} />
        <Side side={band.right} total={totals[1]} ctx={ctx} amountHead={amountHead} />
      </div>
      {band.difference !== 0 && (
        <p role="alert" className="border-t px-2 py-1.5 text-xs text-destructive">
          The two sides differ by {formatAmount(Math.abs(band.difference), ctx.ccy, ctx.locale)}. That should never happen; please report it.
        </p>
      )}
    </Island>
  )
}

function Side({ side, total, ctx, amountHead }: { side: StatementSide; total: string; ctx: LineContext; amountHead?: string }) {
  return (
    <section aria-label={side.label} className="flex min-w-0 flex-col">
      <div className="flex items-center gap-1.5 px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        <h4 className="min-w-0 flex-1 truncate">{side.label}</h4>
        {ctx.withChange && <span className={CHANGE_COL}>change</span>}
        {amountHead && <span className={AMOUNT_COL}>{amountHead}</span>}
      </div>
      <div className="border-t border-border/60">
        <StatementLines lines={side.lines} level={0} ctx={ctx} />
      </div>
      <div className="mt-auto flex min-h-11 items-center gap-1.5 border-t px-2 text-sm font-semibold md:min-h-8 md:text-xs" data-testid={`total-${side.key}`}>
        <span className="min-w-0 flex-1 truncate">{total}</span>
        {ctx.withChange && <span className={cn(CHANGE_COL, 'text-muted-foreground')}>{changeText(side.change ?? 0, ctx.ccy, ctx.locale)}</span>}
        <span className={AMOUNT_COL}>{formatAmount(side.total, ctx.ccy, ctx.locale)}</span>
      </div>
    </section>
  )
}
