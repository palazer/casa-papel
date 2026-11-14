import { MoreHorizontal } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'

/**
 * What can be done to an account, a card, a loan or a virtual account from its line on the Statement (DESIGN.md §7):
 * edit it (its dialog), move it among the lines that stand beside it under the same heading, and archive or delete
 * it. The same shape as a row's and a category's menu, so every "…" on the page opens a menu.
 */
export function AccountMenu({ what, name, at, count, onEdit, onMove, onRemove, removeLabel, triggerClassName }: {
  /** What the line is, for the menu's name: "Account menu for Savings", "Virtual account menu for Travel". */
  what: 'Account' | 'Virtual account'
  name: string
  /** Where the line stands among those beside it, and how many there are: the ends cannot move further. */
  at: number
  count: number
  onEdit: () => void
  onMove: (direction: 'up' | 'down') => void
  onRemove: () => void
  /** "Archive or delete…", or "Delete" while the household is being set up. */
  removeLabel: string
  triggerClassName?: string
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="ghost" size="icon" className={triggerClassName ?? 'size-6'} aria-label={`${what} menu for ${name}`} />}>
        <MoreHorizontal />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-max">
        <DropdownMenuItem onClick={onEdit}>Edit…</DropdownMenuItem>
        <DropdownMenuItem disabled={at <= 0} onClick={() => onMove('up')}>Move up</DropdownMenuItem>
        <DropdownMenuItem disabled={at < 0 || at >= count - 1} onClick={() => onMove('down')}>Move down</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={onRemove}>{removeLabel}</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
