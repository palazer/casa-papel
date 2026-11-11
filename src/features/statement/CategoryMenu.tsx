import { useState } from 'react'
import { MoreHorizontal } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { useStore } from '@/app/store'
import type { Category, Household, Tables } from '@/model'
import { moveCategory, removeIfFree, renameCategory } from '@/store'
import { RemoveDialog } from '@/features/remove/RemoveDialog'

const byOrder = (a: Category, b: Category) => (a.order < b.order ? -1 : a.order > b.order ? 1 : 0)

/**
 * What can be done to a category from its line on the Statement (DESIGN.md §7): rename it, move it among its
 * section's categories, remove it. Its rows are kept either way; removing moves them to "No category". The same
 * actions as the Categories card under Household.
 */
export function CategoryMenu({ category, tables, household, onError, onDeleted, triggerClassName }: {
  category: Category; tables: Tables; household: Household; onError: (msg: string) => void
  /** The category was deleted in one click (a household that is being set up). */
  onDeleted?: (name: string) => void
  triggerClassName?: string
}) {
  const store = useStore()
  const [open, setOpen] = useState<'rename' | 'remove' | null>(null)
  const [name, setName] = useState(category.name)
  const [problem, setProblem] = useState<string | null>(null)
  const siblings = tables.categories.filter((c) => !c.deletedAt && c.section === category.section).sort(byOrder)
  const at = siblings.findIndex((c) => c.id === category.id)
  const act = (fn: () => Promise<unknown>) => () => void fn().catch((e) => onError(e instanceof Error ? e.message : 'Action failed'))
  const close = () => setOpen(null)
  // cheap while the household is being set up; a category that still has rows opens the dialog, which says they are kept
  const cheap = household.setupOpen ?? false
  const removeNow = async () => {
    const deleted = await removeIfFree(store, { kind: 'category', id: category.id })
    if (deleted == null) setOpen('remove')
    else onDeleted?.(deleted)
  }

  function rename() {
    const n = name.trim()
    if (!n) return
    if (n === category.name) return close()
    // a name that is taken stays in the dialog, beside the field that caused it
    renameCategory(store, category.id, n).then(close).catch((e) => setProblem(e instanceof Error ? e.message : 'That name cannot be used.'))
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger render={<Button variant="ghost" size="icon" className={triggerClassName ?? 'size-6'} aria-label={`Category menu for ${category.name}`} />}>
          <MoreHorizontal />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-max">
          <DropdownMenuItem onClick={() => { setName(category.name); setProblem(null); setOpen('rename') }}>Rename…</DropdownMenuItem>
          <DropdownMenuItem disabled={at <= 0} onClick={act(() => moveCategory(store, category.id, 'up'))}>Move up</DropdownMenuItem>
          <DropdownMenuItem disabled={at === siblings.length - 1} onClick={act(() => moveCategory(store, category.id, 'down'))}>Move down</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={cheap ? act(removeNow) : () => setOpen('remove')}>{cheap ? 'Delete' : 'Remove…'}</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={open === 'rename'} onOpenChange={(o) => { if (!o) close() }}>
        <DialogContent className="sm:max-w-sm" aria-describedby={undefined}>
          <DialogHeader><DialogTitle>Rename category</DialogTitle></DialogHeader>
          <Input autoFocus aria-label="Category name" aria-invalid={!!problem || undefined} value={name} onChange={(e) => { setName(e.target.value); setProblem(null) }} onKeyDown={(e) => { if (e.key === 'Enter') rename() }} />
          {problem && <p role="alert" className="text-sm text-destructive">{problem}</p>}
          <DialogFooter>
            <Button variant="outline" onClick={close}>Cancel</Button>
            <Button disabled={!name.trim()} onClick={rename}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {open === 'remove' && <RemoveDialog target={{ kind: 'category', id: category.id }} tables={tables} household={household} onClose={close} />}
    </>
  )
}
