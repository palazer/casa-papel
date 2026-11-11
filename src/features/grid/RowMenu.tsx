import { useState } from 'react'
import { MoreHorizontal } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { useStore } from '@/app/store'
import { canCarryRule, type Household, type Row, type Tables } from '@/model'
import { derivedRowReason, moveRow, removeIfFree, renameRow, restoreRow, updateRow } from '@/store'
import { RemoveDialog } from '@/features/remove/RemoveDialog'
import { RowAccountDialog, RowCurrencyDialog, RowDeductionDialog, RowFollowDialog, RowScopeDialog, RowSourceDialog } from './RowDialogs'
import { RowCategoryDialog } from './RowCategoryDialog'
import { accountVerb } from './rowAccount'

type Open = 'rename' | 'category' | 'scope' | 'currency' | 'source' | 'deduction' | 'account' | 'follow' | 'remove' | null

/** In the Grid the "…" shows while its row is hovered; another screen says when it shows on its own lines. */
const GRID_TRIGGER = 'size-6 opacity-0 group-hover:opacity-100 focus:opacity-100 data-popup-open:opacity-100'

/**
 * Everything that can be done to a row, behind the "…" beside its name. The Grid and the Statement show the same
 * menu; `triggerClassName` is the one thing that differs, when the "…" is visible.
 */
export function RowMenu({ row, tables, household, onError, onDeleted, onRule, triggerClassName = GRID_TRIGGER }: {
  row: Row; tables: Tables; household: Household; onError: (msg: string) => void
  /** "Rule…" for a row that can carry one: the screen opens the row's dialog, which holds the rule. */
  onRule?: () => void
  /** A row was deleted in one click (a household that is being set up); the screen can say so and offer the way back. */
  onDeleted?: (name: string) => void
  triggerClassName?: string
}) {
  const store = useStore()
  const [open, setOpen] = useState<Open>(null)
  const [name, setName] = useState(row.name)
  const followed = row.followsRowId ? tables.rows.find((r) => r.id === row.followsRowId) : undefined
  const deductedFrom = row.deductedFromRowId ? tables.rows.find((r) => r.id === row.deductedFromRowId) : undefined
  /** Rows the app works out itself have no amount of their own to follow with. */
  const canFollow = !derivedRowReason(row, household.closingRule)

  const act = (fn: () => Promise<unknown>) => () => void fn().catch((e) => onError(e instanceof Error ? e.message : 'Action failed'))
  const close = () => setOpen(null)
  // While a household is being set up, deleting is cheap: one click, and undo is the way back. When more than the row
  // would change, the dialog still opens and says what.
  const cheap = household.setupOpen ?? false
  const removeNow = async () => {
    const name = await removeIfFree(store, { kind: 'row', id: row.id })
    if (name == null) setOpen('remove')
    else onDeleted?.(name)
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger render={<Button variant="ghost" size="icon" className={triggerClassName} aria-label={`Row menu for ${row.name}`} />}>
          <MoreHorizontal />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-max">
          <DropdownMenuItem onClick={() => { setName(row.name); setOpen('rename') }}>Rename…</DropdownMenuItem>
          <DropdownMenuItem onClick={act(() => moveRow(store, row.id, 'up'))}>Move up</DropdownMenuItem>
          <DropdownMenuItem onClick={act(() => moveRow(store, row.id, 'down'))}>Move down</DropdownMenuItem>
          <DropdownMenuItem onClick={() => setOpen('category')}>Category…</DropdownMenuItem>
          <DropdownMenuItem onClick={() => setOpen('scope')}>Belongs to…</DropdownMenuItem>
          {canFollow && !followed && <DropdownMenuItem onClick={() => setOpen('currency')}>Currency…</DropdownMenuItem>}
          <DropdownMenuSeparator />
          {!followed && (
            <DropdownMenuItem onClick={act(() => updateRow(store, row.id, { defaultStatus: row.defaultStatus === 'committed' ? 'projected' : 'committed' }))}>
              {row.defaultStatus === 'committed' ? 'Treat new values as estimates' : 'Treat new values as certain'}
            </DropdownMenuItem>
          )}
          {row.section === 'expense' && <DropdownMenuItem onClick={() => setOpen('source')}>Comes out of…</DropdownMenuItem>}
          {row.section === 'expense' && <DropdownMenuItem onClick={() => setOpen('deduction')}>{deductedFrom ? `Deducted from ${deductedFrom.name}…` : 'Deducted from an income…'}</DropdownMenuItem>}
          {row.kind !== 'pool-allocation' && <DropdownMenuItem onClick={() => setOpen('account')}>{accountVerb(row)}…</DropdownMenuItem>}
          {onRule && canCarryRule(row) && !row.archivedMonth && <DropdownMenuItem onClick={onRule}>Rule…</DropdownMenuItem>}
          {canFollow && <DropdownMenuItem onClick={() => setOpen('follow')}>{followed ? `Follows ${followed.name}…` : 'Follow another row…'}</DropdownMenuItem>}
          <DropdownMenuSeparator />
          {row.archivedMonth ? (
            <DropdownMenuItem onClick={act(() => restoreRow(store, row.id))}>Restore</DropdownMenuItem>
          ) : (
            <DropdownMenuItem onClick={cheap ? act(removeNow) : () => setOpen('remove')}>{cheap ? 'Delete' : 'Archive or delete…'}</DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={open === 'rename'} onOpenChange={(o) => { if (!o) close() }}>
        <DialogContent className="sm:max-w-sm" aria-describedby={undefined}>
          <DialogHeader><DialogTitle>Rename row</DialogTitle></DialogHeader>
          <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && name.trim()) { act(() => renameRow(store, row.id, name.trim()))(); close() } }} />
          <DialogFooter>
            <Button variant="outline" onClick={close}>Cancel</Button>
            <Button disabled={!name.trim()} onClick={() => { act(() => renameRow(store, row.id, name.trim()))(); close() }}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {open === 'category' && <RowCategoryDialog row={row} tables={tables} onClose={close} />}
      {open === 'scope' && <RowScopeDialog row={row} tables={tables} household={household} onClose={close} />}
      {open === 'currency' && <RowCurrencyDialog row={row} tables={tables} household={household} onClose={close} />}
      {open === 'deduction' && <RowDeductionDialog row={row} tables={tables} household={household} onClose={close} />}
      {open === 'source' && <RowSourceDialog row={row} tables={tables} household={household} onClose={close} />}
      {open === 'account' && <RowAccountDialog row={row} tables={tables} household={household} onClose={close} />}
      {open === 'follow' && <RowFollowDialog row={row} tables={tables} household={household} onClose={close} />}
      {open === 'remove' && <RemoveDialog target={{ kind: 'row', id: row.id }} tables={tables} household={household} onClose={close} />}
    </>
  )
}
