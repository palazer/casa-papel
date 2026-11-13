import { Check } from '@/components/Check'
import { NativeSelect } from '@/components/NativeSelect'
import { cadenceOf, dueMonthNumbers, parseMonth, type MonthKey, type RepeatChoice } from '@/model'
import { landsText, monthName } from './repeatText'

type Option = 'none' | '1' | '2' | '3' | '6' | '12' | 'months'
const RHYTHMS: Array<{ value: Exclude<Option, 'none'>; label: string }> = [
  { value: '1', label: 'Every month' }, { value: '2', label: 'Every 2 months' }, { value: '3', label: 'Every 3 months' },
  { value: '6', label: 'Every 6 months' }, { value: '12', label: 'Every year' }, { value: 'months', label: 'In chosen months' },
]
const MONTHS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]
const optionOf = (c: RepeatChoice): Option => (c.kind === 'none' ? 'none' : c.kind === 'months' ? 'months' : (String(c.interval) as Option))

/**
 * How one amount repeats (DESIGN.md §8): a select in plain words, the month it counts from where the rhythm needs
 * one, twelve boxes for chosen months, and a sentence that says where it lands. A rhythm picked here lands in the
 * month the dialog is on unless another month is picked; the sentence then says that it does not.
 */
export function RepeatField({ value, onChange, month, locale, name, label = 'Repeats', none, monthly = true }: {
  value: RepeatChoice
  onChange: (choice: RepeatChoice) => void
  /** The month the dialog is on. */
  month: MonthKey
  locale: string
  /** What repeats: it names the controls ("Repeats, Barmenia"). */
  name: string
  /** The word before the select. */
  label?: string
  /** What "does not repeat" is called here; left out, it is not on offer. */
  none?: string
  /** "Every month" is on offer. A single amount has its own way to say that. */
  monthly?: boolean
}) {
  const here = parseMonth(month).month
  function pick(option: Option) {
    if (option === 'none') return onChange({ kind: 'none' })
    // a rhythm that had months of its own keeps them when it is asked another way
    const kept = value.kind === 'every' && value.interval !== 1 ? value : null
    if (option === 'months') return onChange({ kind: 'months', months: value.kind === 'months' ? value.months : kept ? dueMonthNumbers(cadenceOf(kept)) : [here] })
    onChange({ kind: 'every', interval: Number(option) as 1 | 2 | 3 | 6 | 12, anchor: kept?.anchor ?? here })
  }
  return (
    <div className="space-y-1 text-xs" data-testid="repeat-field">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="text-muted-foreground">{label}</span>
        <NativeSelect aria-label={`${label}, ${name}`} className="h-7 text-xs" value={optionOf(value)} onChange={(e) => pick(e.target.value as Option)}>
          {none && <option value="none">{none}</option>}
          {RHYTHMS.filter((r) => monthly || r.value !== '1').map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
        </NativeSelect>
        {value.kind === 'every' && value.interval !== 1 && (
          <>
            <span className="text-muted-foreground">{value.interval === 12 ? 'in' : 'from'}</span>
            <NativeSelect
              aria-label={`${value.interval === 12 ? 'In which month' : 'From which month'}, ${name}`} className="h-7 text-xs"
              value={value.anchor} onChange={(e) => onChange({ ...value, anchor: Number(e.target.value) })}
            >
              {MONTHS.map((m) => <option key={m} value={m}>{monthName(m, locale)}</option>)}
            </NativeSelect>
          </>
        )}
      </div>
      {value.kind === 'months' && (
        <fieldset className="grid grid-cols-4 gap-x-2 gap-y-1 sm:grid-cols-6" aria-label={`Months, ${name}`}>
          {MONTHS.map((m) => (
            <Check
              key={m} className="text-xs" label={monthName(m, locale, 'short')} checked={value.months.includes(m)}
              onChange={(e) => onChange({ kind: 'months', months: e.target.checked ? [...value.months, m] : value.months.filter((x) => x !== m) })}
            />
          ))}
        </fieldset>
      )}
      {value.kind !== 'none' && <p className="text-muted-foreground" data-testid="repeat-lands">{landsText(value, month, locale)}</p>}
    </div>
  )
}
