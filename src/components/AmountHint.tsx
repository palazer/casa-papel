import { formatAmount, sumResult } from '@/app/format'
import { cn } from '@/lib/utils'

/**
 * Under an amount field (DESIGN.md §8): what a typed sum comes to, `= €7,360.17`, while the field holds one. A plain
 * number shows nothing. Saving stores the result; the line lets a slip in the sum be seen before that.
 */
export function AmountHint({ text, currency, locale, className }: { text: string; currency: string; locale: string; className?: string }) {
  const result = sumResult(text, currency, locale)
  if (result == null) return null
  return <p className={cn('text-xs tabular-nums text-muted-foreground', className)} data-testid="amount-hint">= {formatAmount(result, currency, locale)}</p>
}
