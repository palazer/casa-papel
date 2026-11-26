import { useState } from 'react'
import { MoreHorizontal } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { useStore } from '@/app/store'
import { canCarryRule, isPaymentRow, type Household, type Row, type Tables } from '@/model'
import { derivedRowReason, moveRow, removeIfFree, renameRow, restoreRow, restoredText, updateRow } from '@/store'
import { RemoveDialog } from '@/features/remove/RemoveDialog'
import { RowAccountDialog, RowCurrencyDialog, RowDeductionDialog, RowFollowDialog, RowPaidDialog, RowScopeDialog, RowSourceDialog } from './RowDialogs'
import { RowCategoryDialog } from './RowCategoryDialog'
import { accountVerb, hasAccountChoice } from './rowAccount'
import { showSaveError } from '@/app/saveError'
import { txt } from '@/i18n'

const T = txt.grid.rowMenu

type Open = 'rename' | 'category' | 'scope' | 'currency' | 'source' | 'deduction' | 'account' | 'paid' | 'follow' | 'remove' | null

/** In the Grid the "…" shows while its row is hovered; another screen says when it shows on its own lines. */
const GRID_TRIGGER = 'size-6 opacity-0 group-hover:opacity-100 focus:opacity-100 data-popup-open:opacity-100'

/**
 * Everything that can be done to a row, behind the "…" beside its name. The Grid and the Statement show the same
 * menu; `triggerClassName` is the one thing that differs, when the "…" is visible.
 */
export function RowMenu({ row, tables, household, onError, onDeleted, onRestored, onRule, triggerClassName = GRID_TRIGGER }: {
  row: Row; tables: Tables; household: Household; onError: (msg: string) => void
  /** An archived row was restored: what came back with it, as the sentence the screen shows with the way back. */
  onRestored?: (text: string) => void
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
  /** While the household plans its payments, a row whose amounts leave says how it is usually paid. */
  const paid = !!household.payments && isPaymentRow(row)
  /** Rows the app works out itself have no amount of their own to follow with. */
  const canFollow = !derivedRowReason(row, household.closingRule)

  const act = (fn: () => Promise<unknown>) => () => void fn().catch(showSaveError(onError, txt.common.actionFailed))
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
        <DropdownMenuTrigger render={<Button variant="ghost" size="icon" className={triggerClassName} aria-label={T.rowMenuFor(row.name)} />}>
          <MoreHorizontal />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-max">
          <DropdownMenuItem onClick={() => { setName(row.name); setOpen('rename') }}>{txt.common.renameMore}</DropdownMenuItem>
          <DropdownMenuItem onClick={act(() => moveRow(store, row.id, 'up'))}>{txt.common.moveUp}</DropdownMenuItem>
          <DropdownMenuItem onClick={act(() => moveRow(store, row.id, 'down'))}>{txt.common.moveDown}</DropdownMenuItem>
          <DropdownMenuItem onClick={() => setOpen('category')}>{T.category2}</DropdownMenuItem>
          <DropdownMenuItem onClick={() => setOpen('scope')}>{T.belongsTo}</DropdownMenuItem>
          {canFollow && !followed && <DropdownMenuItem onClick={() => setOpen('currency')}>{T.currency2}</DropdownMenuItem>}
          <DropdownMenuSeparator />
          {!followed && (
            <DropdownMenuItem onClick={act(() => updateRow(store, row.id, { defaultStatus: row.defaultStatus === 'committed' ? 'projected' : 'committed' }))}>
              {row.defaultStatus === 'committed' ? T.treatNewValuesAs : T.treatNewValuesAs2}
            </DropdownMenuItem>
          )}
          {row.section === 'expense' && <DropdownMenuItem onClick={() => setOpen('source')}>{T.comesOutOf}</DropdownMenuItem>}
          {row.section === 'expense' && <DropdownMenuItem onClick={() => setOpen('deduction')}>{deductedFrom ? T.deductedFrom(deductedFrom.name) : T.deductedFromAnIncome}</DropdownMenuItem>}
          {row.kind !== 'pool-allocation' && hasAccountChoice(row) && <DropdownMenuItem onClick={() => setOpen('account')}>{accountVerb(row)}…</DropdownMenuItem>}
          {paid && <DropdownMenuItem onClick={() => setOpen('paid')}>{T.usuallyPaid}</DropdownMenuItem>}
          {onRule && canCarryRule(row) && !row.archivedMonth && <DropdownMenuItem onClick={onRule}>{T.rule}</DropdownMenuItem>}
          {canFollow && <DropdownMenuItem onClick={() => setOpen('follow')}>{followed ? T.follows(followed.name) : T.followAnotherRow}</DropdownMenuItem>}
          <DropdownMenuSeparator />
          {row.archivedMonth ? (
            <DropdownMenuItem onClick={act(async () => onRestored?.(restoredText(await restoreRow(store, row.id))))}>{txt.common.restore}</DropdownMenuItem>
          ) : (
            <DropdownMenuItem onClick={cheap ? act(removeNow) : () => setOpen('remove')}>{cheap ? txt.common.delete : txt.common.archiveOrDelete}</DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={open === 'rename'} onOpenChange={(o) => { if (!o) close() }}>
        <DialogContent className="sm:max-w-sm" aria-describedby={undefined}>
          <DialogHeader><DialogTitle>{T.renameRow}</DialogTitle></DialogHeader>
          <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && name.trim()) { act(() => renameRow(store, row.id, name.trim()))(); close() } }} />
          <DialogFooter>
            <Button variant="outline" onClick={close}>{txt.common.cancel}</Button>
            <Button disabled={!name.trim()} onClick={() => { act(() => renameRow(store, row.id, name.trim()))(); close() }}>{txt.common.save}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {open === 'category' && <RowCategoryDialog row={row} tables={tables} onClose={close} />}
      {open === 'scope' && <RowScopeDialog row={row} tables={tables} household={household} onClose={close} />}
      {open === 'currency' && <RowCurrencyDialog row={row} tables={tables} household={household} onClose={close} />}
      {open === 'deduction' && <RowDeductionDialog row={row} tables={tables} household={household} onClose={close} />}
      {open === 'source' && <RowSourceDialog row={row} tables={tables} household={household} onClose={close} />}
      {open === 'account' && <RowAccountDialog row={row} tables={tables} household={household} onClose={close} />}
      {open === 'paid' && <RowPaidDialog row={row} tables={tables} household={household} onClose={close} />}
      {open === 'follow' && <RowFollowDialog row={row} tables={tables} household={household} onClose={close} />}
      {open === 'remove' && <RemoveDialog target={{ kind: 'row', id: row.id }} tables={tables} household={household} onClose={close} />}
    </>
  )
}
