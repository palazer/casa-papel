import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { formatMonth } from '@/app/format'
import type { MonthKey } from '@/model'

export function MonthPicker({ months, month, onChange, locale, children }: { months: MonthKey[]; month: MonthKey; onChange: (m: MonthKey) => void; locale: string; children?: React.ReactNode }) {
  const idx = months.indexOf(month)
  return (
    <div className="flex items-center justify-between gap-2">
      <Button variant="outline" size="icon" aria-label="Previous month" disabled={idx <= 0} onClick={() => onChange(months[idx - 1])}><ChevronLeft /></Button>
      <div className="text-center">
        <h2 className="text-lg font-semibold">{formatMonth(month, locale, 'long')}</h2>
        {children}
      </div>
      <Button variant="outline" size="icon" aria-label="Next month" disabled={idx < 0 || idx >= months.length - 1} onClick={() => onChange(months[idx + 1])}><ChevronRight /></Button>
    </div>
  )
}
