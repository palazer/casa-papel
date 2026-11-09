import { useMemo, useState } from 'react'
import { NativeSelect } from './NativeSelect'

interface Props {
  id?: string
  /** YYYY-MM, or '' when allowEmpty */
  value: string
  onChange: (month: string) => void
  locale?: string
  /** Accessible name prefix: "<label>: month" / "<label>: year" */
  label: string
  allowEmpty?: boolean
  fromYear?: number
  toYear?: number
  className?: string
}

/** Month + year pickers. Safari has no native month input, so a text fallback let people type anything. */
export function MonthField({ id, value, onChange, locale = 'en', label, allowEmpty = false, fromYear, toYear, className }: Props) {
  const [now] = useState(() => new Date())
  const names = useMemo(() => {
    const fmt = new Intl.DateTimeFormat(locale, { month: 'long' })
    return Array.from({ length: 12 }, (_, i) => fmt.format(new Date(2026, i, 1)))
  }, [locale])
  const [y, m] = value ? value.split('-').map(Number) : [NaN, NaN]
  const y0 = Math.min(fromYear ?? now.getFullYear() - 6, Number.isFinite(y) ? y : Infinity)
  const y1 = Math.max(toYear ?? now.getFullYear() + 6, Number.isFinite(y) ? y : -Infinity)
  const years = Array.from({ length: y1 - y0 + 1 }, (_, i) => y0 + i)
  const set = (yy: number, mm: number) => onChange(`${yy}-${String(mm).padStart(2, '0')}`)
  return (
    <div className={`flex gap-2 ${className ?? ''}`}>
      <NativeSelect
        id={id}
        aria-label={`${label}: month`}
        className="min-w-0 flex-1"
        value={Number.isFinite(m) ? String(m) : ''}
        onChange={(e) => (e.target.value === '' ? onChange('') : set(Number.isFinite(y) ? y : now.getFullYear(), Number(e.target.value)))}
      >
        {allowEmpty && <option value="">—</option>}
        {names.map((n, i) => <option key={n} value={i + 1}>{n}</option>)}
      </NativeSelect>
      <NativeSelect
        aria-label={`${label}: year`}
        className="w-24"
        value={Number.isFinite(y) ? String(y) : ''}
        onChange={(e) => (e.target.value === '' ? onChange('') : set(Number(e.target.value), Number.isFinite(m) ? m : now.getMonth() + 1))}
      >
        {allowEmpty && <option value="">—</option>}
        {years.map((yy) => <option key={yy} value={yy}>{yy}</option>)}
      </NativeSelect>
    </div>
  )
}
