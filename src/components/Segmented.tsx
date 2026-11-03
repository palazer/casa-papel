import { cn } from '@/lib/utils'

/** A small radio group drawn as pills; one option is always chosen. */
export function Segmented({ value, onChange, options, label }: { value: string; onChange: (v: string) => void; options: Array<{ value: string; label: string }>; label?: string }) {
  return (
    <div className="flex flex-wrap gap-1" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value} type="button" role="radio" aria-checked={value === o.value}
          className={cn('rounded-md border px-2.5 py-1 text-xs', value === o.value ? 'border-foreground bg-foreground text-background' : 'hover:bg-muted')}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}
