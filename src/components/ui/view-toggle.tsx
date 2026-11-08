import { cn } from '@/lib/utils'

/** Two or three small mutually exclusive options that filter a list (DESIGN.md §8). Lime marks the pressed one. */
export function ViewToggle<T extends string>({ value, options, labels, onChange, ariaLabel }: { value: T; options: readonly T[]; labels?: Partial<Record<T, string>>; onChange: (v: T) => void; ariaLabel?: string }) {
  return (
    <span role="radiogroup" aria-label={ariaLabel} className="inline-flex overflow-hidden rounded border">
      {options.map((o) => (
        <button
          key={o} type="button" role="radio" aria-checked={o === value} onClick={() => onChange(o)}
          className={cn('px-1.5 text-[10px] font-medium leading-4', o === value ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground')}
        >
          {labels?.[o] ?? o}
        </button>
      ))}
    </span>
  )
}
