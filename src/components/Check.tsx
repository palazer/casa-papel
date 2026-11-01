import type { InputHTMLAttributes, ReactNode } from 'react'
import { cn } from '@/lib/utils'

/** Plain labelled checkbox; native for reliability inside dialogs and lists. */
export function Check({ label, className, ...props }: InputHTMLAttributes<HTMLInputElement> & { label: ReactNode }) {
  return (
    <label className={cn('flex cursor-pointer items-center gap-2 text-sm', props.disabled && 'opacity-50', className)}>
      <input type="checkbox" className="size-4 accent-foreground" {...props} />
      <span>{label}</span>
    </label>
  )
}
