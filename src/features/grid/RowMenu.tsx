import { useState } from 'react'
import { MoreHorizontal } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { useStore } from '@/app/store'
import { monthOfDate, type Row } from '@/model'
import { archiveRow, moveRow, renameRow, updateRow } from '@/store'

export function RowMenu({ row, onError }: { row: Row; onError: (msg: string) => void }) {
  const store = useStore()
  const [renaming, setRenaming] = useState(false)
  const [name, setName] = useState(row.name)

  const act = (fn: () => Promise<unknown>) => () => void fn().catch((e) => onError(e instanceof Error ? e.message : 'Action failed'))

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger render={<Button variant="ghost" size="icon" className="size-6 opacity-0 group-hover:opacity-100 focus:opacity-100 data-popup-open:opacity-100" aria-label={`Row menu for ${row.name}`} />}>
          <MoreHorizontal />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuItem onClick={() => { setName(row.name); setRenaming(true) }}>Rename…</DropdownMenuItem>
          <DropdownMenuItem onClick={act(() => moveRow(store, row.id, 'up'))}>Move up</DropdownMenuItem>
          <DropdownMenuItem onClick={act(() => moveRow(store, row.id, 'down'))}>Move down</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={act(() => updateRow(store, row.id, { defaultStatus: row.defaultStatus === 'committed' ? 'projected' : 'committed' }))}>
            {row.defaultStatus === 'committed' ? 'Treat new values as estimates' : 'Treat new values as certain'}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          {row.archivedMonth ? (
            <DropdownMenuItem onClick={act(() => archiveRow(store, row.id, null))}>Unarchive</DropdownMenuItem>
          ) : (
            <DropdownMenuItem onClick={act(() => archiveRow(store, row.id, monthOfDate()))}>Archive from this month</DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={renaming} onOpenChange={(o) => { if (!o) setRenaming(false) }}>
        <DialogContent className="sm:max-w-sm" aria-describedby={undefined}>
          <DialogHeader><DialogTitle>Rename row</DialogTitle></DialogHeader>
          <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && name.trim()) { act(() => renameRow(store, row.id, name.trim()))(); setRenaming(false) } }} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenaming(false)}>Cancel</Button>
            <Button disabled={!name.trim()} onClick={() => { act(() => renameRow(store, row.id, name.trim()))(); setRenaming(false) }}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
