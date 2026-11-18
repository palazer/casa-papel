import { Button } from '@/components/ui/button'
import { Chip } from '@/components/ui/chip'
import { Island } from '@/components/ui/island'
import { formatMonth } from '@/app/format'
import { useStore } from '@/app/store'
import { sortRows } from '@/engine'
import { SECTION_INFO, type Household, type Tables } from '@/model'
import { restoreRow, type Restored } from '@/store'
import { showSaveError } from '@/app/saveError'

/** Rows put away from a month on. Shown only when there are any; Restore brings a row back, and the screen says what came back with it. */
export function ArchivedRowsCard({ household, tables, onError, onRestored }: { household: Household; tables: Tables; onError: (m: string) => void; onRestored: (r: Restored) => void }) {
  const store = useStore()
  const rows = sortRows(tables.rows.filter((r) => !r.deletedAt && r.archivedMonth), tables.categories)
  if (rows.length === 0) return null
  const act = (fn: () => Promise<unknown>) => void fn().catch(showSaveError(onError, 'Action failed'))
  return (
    <Island air title="Archived rows" help="household.archived" description="Rows put away from a month on. Their earlier months still count; restore one to bring it back, with its schedules and what else its archive changed.">
      <ul className="divide-y divide-border/60">
        {rows.map((r) => (
          <li key={r.id} className="flex min-h-8 flex-wrap items-center gap-2 py-1 text-muted-foreground">
            <Chip tone="zinc">{SECTION_INFO[r.section].label.toLowerCase()}</Chip>
            <span className="font-medium text-foreground">{r.name}</span>
            <span>since {formatMonth(r.archivedMonth!, household.locale)}</span>
            <Button size="xs" variant="outline" className="ml-auto" onClick={() => act(async () => onRestored(await restoreRow(store, r.id)))}>Restore</Button>
          </li>
        ))}
      </ul>
    </Island>
  )
}
