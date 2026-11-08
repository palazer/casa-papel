import { cn } from '@/lib/utils'

/** Tabs switch an island's view (DESIGN.md §8): sentence-case words on the air head's hairline, the active one in
 *  the foreground colour with a 2 px underline that sits on the hairline, the others muted. A filter is a ViewToggle. */
export function TabBar<T extends string>({ value, options, labels, onChange, ariaLabel }: { value: T; options: readonly T[]; labels?: Partial<Record<T, string>>; onChange: (v: T) => void; ariaLabel?: string }) {
  return (
    <div role="tablist" aria-label={ariaLabel} className="flex min-w-0 items-end gap-4">
      {options.map((o) => (
        <button
          key={o} type="button" role="tab" aria-selected={o === value} onClick={() => onChange(o)}
          className={cn('-mb-px whitespace-nowrap border-b-2 pb-2 text-sm font-medium leading-5', o === value ? 'border-foreground text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground')}
        >
          {labels?.[o] ?? o.charAt(0).toUpperCase() + o.slice(1)}
        </button>
      ))}
    </div>
  )
}
