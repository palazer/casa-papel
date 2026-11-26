import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { formatMonth } from '@/app/format'
import { parseMonth, type MonthKey } from '@/model'
import { txt } from '@/i18n'

const T = txt.components.monthPicker

/** Previous / month name / next, in the toolbar's grammar (DESIGN.md §8): two 24 px outline buttons around the month,
 *  which is the screen's second heading so a reader can jump to it. At the last planned month, Next gives way to
 *  "Add <year>" when the screen passes `onAddYear`: the plan grows a calendar year at a time. */
export function MonthPicker({ months, month, onChange, locale, onAddYear, children }: { months: MonthKey[]; month: MonthKey; onChange: (m: MonthKey) => void; locale: string; onAddYear?: () => void; children?: React.ReactNode }) {
  const idx = months.indexOf(month)
  const atEnd = idx >= months.length - 1
  return (
    <div className="flex items-center gap-1">
      <Button variant="outline" size="icon-xs" aria-label={T.previousMonth} disabled={idx <= 0} onClick={() => onChange(months[idx - 1])}><ChevronLeft /></Button>
      <h2 className="min-w-32 text-center text-sm font-medium leading-5">{formatMonth(month, locale, 'long')}</h2>
      {atEnd && onAddYear && idx >= 0
        ? <Button variant="outline" size="xs" onClick={onAddYear}>{T.addYear(parseMonth(month).year)}</Button>
        : <Button variant="outline" size="icon-xs" aria-label={T.nextMonth} disabled={idx < 0 || atEnd} onClick={() => onChange(months[idx + 1])}><ChevronRight /></Button>}
      {children}
    </div>
  )
}
