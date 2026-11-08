import type { ReactNode } from 'react'
import { Info } from 'lucide-react'
import { HELP, type HelpKey } from '@/app/help'
import { Label } from '@/components/ui/label'
import { Popover, PopoverContent, PopoverDescription, PopoverHeader, PopoverTitle, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'

interface Props {
  /** The text to show, from the one help map. */
  help: HelpKey
  /** Overrides, for a tip whose words depend on the row or account it sits next to. */
  title?: string
  text?: string
  side?: 'top' | 'bottom' | 'left' | 'right'
  className?: string
}

/**
 * The (i) icon (DESIGN.md §8): hover opens it on a mouse, a tap opens it on touch, Escape or a click outside closes it.
 * Always a sibling of the thing it explains, never inside a label, button or menu item. 16 px on desktop, 24 px where
 * the pointer is a finger, so it is easy to hit on a phone without taking space on a dense table.
 */
export function InfoTip({ help, title, text, side = 'top', className }: Props) {
  const h = HELP[help]
  const heading = title ?? h.title
  return (
    <Popover>
      <PopoverTrigger
        openOnHover
        delay={150}
        closeDelay={100}
        aria-label={`About ${heading}`}
        className={cn(
          'inline-flex size-4 shrink-0 items-center justify-center rounded-full align-middle text-muted-foreground/70 outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring data-popup-open:text-foreground pointer-coarse:size-6',
          className,
        )}
      >
        <Info className="size-3.5 pointer-coarse:size-4" aria-hidden />
      </PopoverTrigger>
      <PopoverContent side={side} className="w-64 gap-1 p-3 text-xs">
        <PopoverHeader className="gap-1 text-xs">
          <PopoverTitle className="text-xs font-semibold">{heading}</PopoverTitle>
          <PopoverDescription className="text-xs leading-4">{text ?? h.text}</PopoverDescription>
        </PopoverHeader>
      </PopoverContent>
    </Popover>
  )
}

/** A form label with its (i) beside it, not inside it, so the icon never focuses the field. */
export function TipLabel({ htmlFor, help, children, className }: { htmlFor?: string; help: HelpKey; children: ReactNode; className?: string }) {
  return (
    <span className={cn('flex items-center gap-1', className)}>
      <Label htmlFor={htmlFor}>{children}</Label>
      <InfoTip help={help} />
    </span>
  )
}
