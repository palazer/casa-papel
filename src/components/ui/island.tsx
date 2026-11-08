import type { ReactNode } from 'react'
import { ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { Hue } from '@/app/hues'

/**
 * The panel every screen is built from (DESIGN.md §3, after nfl-fantasy's Island): a bordered card on the card
 * ground with no shadow and no coloured bar, a title, an optional one-line `description` (Casa Papel explains every
 * panel in a sentence), an optional non-scrolling `toolbar` and a body. Two heads: the dense one is a 10 px small-caps
 * eyebrow with 8 px of padding; `air` is a 14 px sentence-case title on a hairline that runs edge to edge, with 16 px
 * of padding, for reading pages. `tone` colours the title in a kind-of-money hue: the one deviation from nfl, where a
 * section's colour lives in its title alone. `right` puts a control or a count at the end of the title row; `tabs` a
 * TabBar in place of the title; `onFold` makes the title a button that minimizes the island.
 */
export function Island({ title, tabs, right, description, toolbar, children, className, bodyClassName, folded = false, onFold, air = false, tone, as: Tag = 'section', ...rest }: {
  title?: ReactNode
  tabs?: ReactNode
  right?: ReactNode
  description?: ReactNode
  toolbar?: ReactNode
  children?: ReactNode
  className?: string
  bodyClassName?: string
  folded?: boolean
  onFold?: (folded: boolean) => void
  air?: boolean
  tone?: Hue
  as?: 'section' | 'div' | 'article'
  id?: string
  'aria-label'?: string
  'data-testid'?: string
}) {
  const fold = onFold && (
    <button type="button" aria-expanded={!folded} title={folded ? 'open' : 'minimize'} onClick={() => onFold(!folded)} className="flex min-w-0 items-center gap-1 hover:text-foreground">
      <ChevronDown className={cn('size-3 shrink-0 transition-transform', folded && '-rotate-90')} aria-hidden />
      <span className="truncate">{title}</span>
    </button>
  )
  if (air) {
    return (
      <Tag className={cn('flex min-h-0 flex-col rounded-lg border bg-card', className)} {...rest}>
        {(title || tabs || right) && (
          <h3 className={cn('flex items-end gap-4 border-b px-4 pt-2 text-sm font-medium leading-5 text-foreground', tone?.text)}>
            {tabs ?? (fold ? <span className="min-w-0 pb-2">{fold}</span> : <span className="min-w-0 truncate pb-2">{title}</span>)}
            {right && <span className="ml-auto flex shrink-0 items-center gap-2 pb-2 text-xs font-normal text-muted-foreground">{right}</span>}
          </h3>
        )}
        {description && <p className="px-4 pt-3 text-xs leading-4 text-muted-foreground">{description}</p>}
        {toolbar}
        {!folded && <div className={cn('min-h-0 flex-1 overflow-y-auto px-4 pb-4 pt-3', bodyClassName)}>{children}</div>}
      </Tag>
    )
  }
  const head = tabs ?? title
  return (
    <Tag className={cn('flex min-h-0 flex-col rounded-lg border bg-card', className)} {...rest}>
      {(head || right) && (
        <h3 className={cn('flex items-center gap-1 px-2 pt-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground', tone?.text)}>
          {fold ?? <span className="truncate">{head}</span>}
          {right && <span className="ml-auto font-normal normal-case tracking-normal">{right}</span>}
        </h3>
      )}
      {description && <p className="px-2 pt-1 text-[11px] leading-[15px] text-muted-foreground">{description}</p>}
      {toolbar}
      {!folded && <div className={cn('min-h-0 flex-1 overflow-y-auto px-2 pb-2 pt-1', bodyClassName)}>{children}</div>}
    </Tag>
  )
}
