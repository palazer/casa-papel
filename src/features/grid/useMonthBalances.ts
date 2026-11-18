import { useMemo, useState } from 'react'
import { amountToInput, parseAmount, unreadableAmount } from '@/app/format'
import type { Household, Money, MonthKey, Tables } from '@/model'
import { previewMonthBalances, type BalanceEntry, type BalanceLine } from '@/store'

export type BalanceSide = 'start' | 'end'
const keyOf = (side: BalanceSide, id: string) => `${side}:${id}`
/** A stored balance as a field shows it. A real 0 is written out: an empty field means "calculated". */
const asText = (v: Money | null, currency: string, locale: string): string => (v == null ? '' : v === 0 ? '0' : amountToInput(v, currency, locale))

/**
 * The fields of a month's balances (DESIGN.md §8): a start and an end per account. A field holds a real number or is
 * empty, and an empty one stands for the calculated amount. Every field starts on what is stored when the dialog
 * opens, and only a field that reads differently by then is written. A typed start runs through the engine at once,
 * so the calculated end an empty field shows is the one it will give.
 */
export function useMonthBalances(tables: Tables, household: Household, month: MonthKey, shown: (line: BalanceLine) => boolean = () => true) {
  const locale = household.locale
  const [opened] = useState(() => {
    const texts: Record<string, string> = {}
    const book: Record<string, boolean> = {}
    const accounts: Array<{ id: string; currency: string }> = []
    for (const l of previewMonthBalances(tables, household, month).lines.filter(shown)) {
      accounts.push({ id: l.account.id, currency: l.account.currency })
      texts[keyOf('start', l.account.id)] = asText(l.startStored, l.account.currency, locale)
      texts[keyOf('end', l.account.id)] = asText(l.endStored, l.account.currency, locale)
      // ticked for a balance typed now; an old difference is only counted when someone asks for it
      book[l.account.id] = l.endStored == null
    }
    return { texts, book, accounts }
  })
  const [texts, setTexts] = useState(opened.texts)
  const [book, setBook] = useState(opened.book)
  const [error, setError] = useState<string | null>(null)

  const textOf = (side: BalanceSide, id: string): string => texts[keyOf(side, id)] ?? ''
  const changed = (side: BalanceSide, id: string): boolean => textOf(side, id).trim() !== (opened.texts[keyOf(side, id)] ?? '').trim()
  const read = (side: BalanceSide, id: string, currency: string): Money | null | undefined => {
    const text = textOf(side, id)
    if (text.trim() === '') return null
    return parseAmount(text, currency, locale) ?? undefined
  }
  /** What a field reads: a number, `null` for empty, `undefined` for text that is not an amount. */
  const typed = (side: BalanceSide, line: BalanceLine): Money | null | undefined => read(side, line.account.id, line.account.currency)
  const setText = (side: BalanceSide, id: string, text: string) => {
    setError(null)
    setTexts((t) => ({ ...t, [keyOf(side, id)]: text }))
  }

  // the starts that read differently from what is stored, as far as they can be read
  const typedStarts: Record<string, Money | null> = {}
  for (const a of opened.accounts) {
    const v = read('start', a.id, a.currency)
    if (changed('start', a.id) && v !== undefined) typedStarts[a.id] = v
  }
  const startsKey = JSON.stringify(typedStarts)
  const preview = useMemo(
    () => previewMonthBalances(tables, household, month, JSON.parse(startsKey) as Record<string, Money | null>),
    [tables, household, month, startsKey],
  )
  const lines = preview.lines.filter(shown)

  /** How far a typed end is from the calculated one; null when there is nothing to compare. */
  const difference = (line: BalanceLine): Money | null => {
    const v = typed('end', line)
    return v != null && line.endCalculated != null ? v - line.endCalculated : null
  }
  /** A card whose purchases are expense rows owes more than the plan expects: the difference can be counted as spending. */
  const canBook = (line: BalanceLine): boolean => line.itemized && (difference(line) ?? 0) > 0

  /** What to save: the fields that changed. Says what cannot be read and returns null. */
  function entry(): BalanceEntry | null {
    const out: Required<BalanceEntry> = { starts: {}, ends: {}, book: [] }
    for (const line of lines) {
      // a difference that is counted as spending is saved with its balance, also when the balance itself did not change
      const booked = canBook(line) && (book[line.account.id] ?? false)
      for (const side of ['start', 'end'] as const) {
        if (!changed(side, line.account.id) && !(side === 'end' && booked)) continue
        const v = typed(side, line)
        if (v === undefined) {
          const fallback = lines.length > 1 ? `${line.account.name}: that is not a number I can read.` : 'That is not a number I can read.'
          setError(unreadableAmount(textOf(side, line.account.id), fallback))
          return null
        }
        out[side === 'start' ? 'starts' : 'ends'][line.account.id] = v
      }
      if (booked) out.book.push(line.account.id)
    }
    return out
  }

  return {
    locale, lines, main: preview.main, error, setError, textOf, setText, typed, difference, canBook, entry,
    bookOf: (id: string) => book[id] ?? false,
    setBook: (id: string, on: boolean) => setBook((b) => ({ ...b, [id]: on })),
  }
}

export type MonthBalancesForm = ReturnType<typeof useMonthBalances>
