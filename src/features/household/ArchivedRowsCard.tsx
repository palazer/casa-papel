import { Button } from '@/components/ui/button'
import { Chip } from '@/components/ui/chip'
import { Island } from '@/components/ui/island'
import { formatMonth } from '@/app/format'
import { useStore } from '@/app/store'
import { sortRows } from '@/engine'
import { SECTION_INFO, type Household, type Tables } from '@/model'
import { restoreRow } from '@/store'

/** Rows put away from a month on. Shown only when there are any; Restore brings a row back to the grid. */
export function ArchivedRowsCard({ household, tables, onError }: { household: Household; tables: Tables; onError: (m: string) => void }) {
  const store = useStore()
  const rows = sortRows(tables.rows.filter((r) => !r.deletedAt && r.archivedMonth), tables.categories)
  if (rows.length === 0) return null
  const act = (fn: () => Promise<unknown>) => void fn().catch((e) => onError(e instanceof Error ? e.message : 'Action failed'))
  return (
    <Island air title="Archived rows" help="household.archived" description="Rows put away from a month on. Their earlier months still count; restore one to bring it back to the grid.">
      <ul className="divide-y divide-border/60">
        {rows.map((r) => (
          <li key={r.id} className="flex min-h-8 flex-wrap items-center gap-2 py-1 text-muted-foreground">
            <Chip tone="zinc">{SECTION_INFO[r.section].label.toLowerCase()}</Chip>
            <span className="font-medium text-foreground">{r.name}</span>
            <span>since {formatMonth(r.archivedMonth!, household.locale)}</span>
            <Button size="xs" variant="outline" className="ml-auto" onClick={() => act(() => restoreRow(store, r.id))}>Restore</Button>
          </li>
        ))}
      </ul>
    </Island>
  )
}
