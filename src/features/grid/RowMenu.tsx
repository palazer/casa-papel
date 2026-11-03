import { useState } from 'react'
import { MoreHorizontal } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { useStore } from '@/app/store'
import { monthOfDate, type Household, type Row, type Tables } from '@/model'
import { archiveRow, derivedRowReason, moveRow, renameRow, updateRow } from '@/store'
import { RowAccountDialog, RowFollowDialog, RowSourceDialog } from './RowDialogs'
import { accountVerb } from './rowAccount'

type Open = 'rename' | 'source' | 'account' | 'follow' | null

export function RowMenu({ row, tables, household, onError }: { row: Row; tables: Tables; household: Household; onError: (msg: string) => void }) {
  const store = useStore()
  const [open, setOpen] = useState<Open>(null)
  const [name, setName] = useState(row.name)
  const followed = row.followsRowId ? tables.rows.find((r) => r.id === row.followsRowId) : undefined
  /** Rows the app works out itself have no amount of their own to follow with. */
  const canFollow = !derivedRowReason(row, household.closingRule)

  const act = (fn: () => Promise<unknown>) => () => void fn().catch((e) => onError(e instanceof Error ? e.message : 'Action failed'))
  const close = () => setOpen(null)

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger render={<Button variant="ghost" size="icon" className="size-6 opacity-0 group-hover:opacity-100 focus:opacity-100 data-popup-open:opacity-100" aria-label={`Row menu for ${row.name}`} />}>
          <MoreHorizontal />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuItem onClick={() => { setName(row.name); setOpen('rename') }}>Rename…</DropdownMenuItem>
          <DropdownMenuItem onClick={act(() => moveRow(store, row.id, 'up'))}>Move up</DropdownMenuItem>
          <DropdownMenuItem onClick={act(() => moveRow(store, row.id, 'down'))}>Move down</DropdownMenuItem>
          <DropdownMenuSeparator />
          {!followed && (
            <DropdownMenuItem onClick={act(() => updateRow(store, row.id, { defaultStatus: row.defaultStatus === 'committed' ? 'projected' : 'committed' }))}>
              {row.defaultStatus === 'committed' ? 'Treat new values as estimates' : 'Treat new values as certain'}
            </DropdownMenuItem>
          )}
          {row.section === 'expense' && <DropdownMenuItem onClick={() => setOpen('source')}>Comes out of…</DropdownMenuItem>}
          {row.kind !== 'pool-allocation' && <DropdownMenuItem onClick={() => setOpen('account')}>{accountVerb(row)}…</DropdownMenuItem>}
          {canFollow && <DropdownMenuItem onClick={() => setOpen('follow')}>{followed ? `Follows ${followed.name}…` : 'Follow another row…'}</DropdownMenuItem>}
          <DropdownMenuSeparator />
          {row.archivedMonth ? (
            <DropdownMenuItem onClick={act(() => archiveRow(store, row.id, null))}>Unarchive</DropdownMenuItem>
          ) : (
            <DropdownMenuItem onClick={act(() => archiveRow(store, row.id, monthOfDate()))}>Archive from this month</DropdownMenuItem>
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
      {open === 'source' && <RowSourceDialog row={row} tables={tables} household={household} onClose={close} />}
      {open === 'account' && <RowAccountDialog row={row} tables={tables} household={household} onClose={close} />}
      {open === 'follow' && <RowFollowDialog row={row} tables={tables} household={household} onClose={close} />}
    </>
  )
}
