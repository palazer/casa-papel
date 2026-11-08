import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { formatMonth } from '@/app/format'
import type { MonthKey } from '@/model'

/** Previous / month name / next, in the toolbar's grammar (DESIGN.md §8): two 24 px outline buttons around the month,
 *  which is the screen's second heading so a reader can jump to it. */
export function MonthPicker({ months, month, onChange, locale, children }: { months: MonthKey[]; month: MonthKey; onChange: (m: MonthKey) => void; locale: string; children?: React.ReactNode }) {
  const idx = months.indexOf(month)
  return (
    <div className="flex items-center gap-1">
      <Button variant="outline" size="icon-xs" aria-label="Previous month" disabled={idx <= 0} onClick={() => onChange(months[idx - 1])}><ChevronLeft /></Button>
      <h2 className="min-w-32 text-center text-sm font-medium leading-5">{formatMonth(month, locale, 'long')}</h2>
      <Button variant="outline" size="icon-xs" aria-label="Next month" disabled={idx < 0 || idx >= months.length - 1} onClick={() => onChange(months[idx + 1])}><ChevronRight /></Button>
      {children}
    </div>
  )
}
