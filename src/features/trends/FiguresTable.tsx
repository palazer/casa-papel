import { cn } from '@/lib/utils'
import { txt } from '@/i18n'

const T = txt.trends.table

export interface FigureColumn {
  id: string
  label: string
  /** One amount per row. */
  values: number[]
  /** How the amount moved from the row before: null where there is nothing to compare with. Left out for a part of a breakdown. */
  changes?: Array<number | null>
}

/**
 * What the charts above draw, as a plain table (DESIGN.md §11): a row per month, or per year where the bars are by
 * year, and a column per line or part, with the change from the row before under an amount. It is how the figures
 * are read without the pointer, by a screen reader, or copied out. A row of the plan says so after its name.
 */
export function FiguresTable({ rows, columns, amount, change, caption }: {
  rows: Array<{ key: string; label: string; note?: string }>
  columns: FigureColumn[]
  amount: (v: number) => string
  change: (v: number) => string
  caption: string
}) {
  return (
    <div className="max-h-96 overflow-auto" data-testid="trend-figures">
      <table className="w-full border-separate border-spacing-0 text-xs">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            <th scope="col" className="sticky top-0 border-b bg-card px-2 py-1 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{txt.common.month}</th>
            {columns.map((c) => (
              <th key={c.id} scope="col" className="sticky top-0 border-b bg-card px-2 py-1 text-right text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{c.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.key} className="hover:bg-muted/50">
              <th scope="row" className={cn('whitespace-nowrap border-b px-2 py-1 text-left font-normal', i === rows.length - 1 && 'border-b-0')}>
                {r.label}{r.note && <span className="text-muted-foreground"> · {r.note}</span>}
              </th>
              {columns.map((c) => {
                const d = c.changes?.[i]
                return (
                  <td key={c.id} className={cn('border-b px-2 py-1 text-right tabular-nums', i === rows.length - 1 && 'border-b-0')}>
                    {amount(c.values[i])}
                    {c.changes && <span className="block text-[11px] text-muted-foreground">{d == null ? '–' : d === 0 ? T.noChange : change(d)}</span>}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
