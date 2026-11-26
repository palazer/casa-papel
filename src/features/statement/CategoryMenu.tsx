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
import { saveError, showSaveError } from '@/app/saveError'
import { txt } from '@/i18n'

const T = txt.statement.categoryMenu

const byOrder = (a: Category, b: Category) => (a.order < b.order ? -1 : a.order > b.order ? 1 : 0)

/**
 * What can be done to a category from its line on the Statement (DESIGN.md §7): rename it, set what it should come
 * to in a month (an expense category's estimate), move it among its section's categories, remove it. Its rows are
 * kept either way; removing moves them to "No category". Renaming, moving and removing are the actions of the
 * Categories card under Household.
 */
export function CategoryMenu({ category, tables, household, onError, onDeleted, onEstimate, hasEstimate = false, triggerClassName }: {
  category: Category; tables: Tables; household: Household; onError: (msg: string) => void
  /** An expense category: open its estimate for the month on screen. Left out, the menu has no such item. */
  onEstimate?: () => void
  /** The category has an estimate in that month, so the item changes it. */
  hasEstimate?: boolean
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
  const act = (fn: () => Promise<unknown>) => () => void fn().catch(showSaveError(onError, txt.common.actionFailed))
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
    renameCategory(store, category.id, n).then(close).catch((e) => setProblem(saveError(e, T.thatNameCannotBe)))
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger render={<Button variant="ghost" size="icon" className={triggerClassName ?? 'size-6'} aria-label={T.categoryMenuFor(category.name)} />}>
          <MoreHorizontal />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-max">
          <DropdownMenuItem onClick={() => { setName(category.name); setProblem(null); setOpen('rename') }}>{txt.common.renameMore}</DropdownMenuItem>
          {onEstimate && <DropdownMenuItem onClick={onEstimate}>{hasEstimate ? T.changeEstimate : T.setEstimate}</DropdownMenuItem>}
          <DropdownMenuItem disabled={at <= 0} onClick={act(() => moveCategory(store, category.id, 'up'))}>{txt.common.moveUp}</DropdownMenuItem>
          <DropdownMenuItem disabled={at === siblings.length - 1} onClick={act(() => moveCategory(store, category.id, 'down'))}>{txt.common.moveDown}</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={cheap ? act(removeNow) : () => setOpen('remove')}>{cheap ? txt.common.delete : txt.common.removeMore}</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={open === 'rename'} onOpenChange={(o) => { if (!o) close() }}>
        <DialogContent className="sm:max-w-sm" aria-describedby={undefined}>
          <DialogHeader><DialogTitle>{T.renameCategory}</DialogTitle></DialogHeader>
          <Input autoFocus aria-label={T.categoryName} aria-invalid={!!problem || undefined} value={name} onChange={(e) => { setName(e.target.value); setProblem(null) }} onKeyDown={(e) => { if (e.key === 'Enter') rename() }} />
          {problem && <p role="alert" className="text-sm text-destructive">{problem}</p>}
          <DialogFooter>
            <Button variant="outline" onClick={close}>{txt.common.cancel}</Button>
            <Button disabled={!name.trim()} onClick={rename}>{txt.common.save}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {open === 'remove' && <RemoveDialog target={{ kind: 'category', id: category.id }} tables={tables} household={household} onClose={close} />}
    </>
  )
}
