import { formatAmount, formatMonth } from '@/app/format'
import { addMonths, parseMonth, type Money, type MonthKey } from '@/model'
import { formatDate, txt } from '@/i18n'

const T = txt.grid.following

/** `Jul 2026`, `Jul 2026 and Sept 2026`, `Jul 2026, Aug 2026 and Sept 2026`; beyond `max`: `…, Oct 2026 and 3 more months`. */
export function listMonths(months: MonthKey[], locale: string, max = 4): string {
  const names = [...months].sort().map((m) => formatMonth(m, locale))
  if (names.length <= 1) return names[0] ?? ''
  if (names.length <= max) return T.listAnd(names.slice(0, -1).join(', '), names[names.length - 1])
  const more = names.length - max
  return T.andMore(names.slice(0, max).join(', '), more)
}

/**
 * What "This and following months" does to the months after it, said before saving: the months whose own amount is
 * replaced, and the months that stay because something in them is ticked as done. Empty when it does neither.
 */
export function followingEffects(following: { replaced: MonthKey[]; kept: MonthKey[] }, locale: string): string {
  const parts: string[] = []
  if (following.replaced.length) parts.push(T.replacesWhatYouTyped(listMonths(following.replaced, locale)))
  if (following.kept.length === 1) parts.push(T.isTickedAsDone(listMonths(following.kept, locale)))
  else if (following.kept.length > 1) parts.push(T.areTickedAsDone(listMonths(following.kept, locale)))
  return parts.join(' ')
}

/** The sentence under "This and following months" for one amount: `plain` while nothing later is touched. */
export function followingText(month: MonthKey, following: { replaced: MonthKey[]; kept: MonthKey[] }, locale: string, plain: string): string {
  const effects = followingEffects(following, locale)
  return effects ? T.countsFromOn(formatMonth(month, locale, 'long'), effects) : plain
}

/**
 * The sentence under "Only this month": the month, and what the month after goes on with. `goesOn` is that amount,
 * null when the month after has none (`empty` says so), and undefined when there is nothing to say about it.
 */
export function onlyThisMonthText(month: MonthKey, goesOn: Money | null | undefined, currency: string, locale: string, empty = T.staysEmpty): string {
  const only = T.only(formatMonth(month, locale, 'long'))
  if (goesOn === undefined) return only
  const next = addMonths(month, 1)
  const sameYear = parseMonth(next).year === parseMonth(month).year
  const name = sameYear
    ? formatDate(new Date(parseMonth(next).year, parseMonth(next).month - 1, 1), locale, { month: 'long' })
    : formatMonth(next, locale, 'long')
  return goesOn == null ? `${only} ${name} ${empty}.` : T.goesOnWith(only, name, formatAmount(goesOn, currency, locale))
}
