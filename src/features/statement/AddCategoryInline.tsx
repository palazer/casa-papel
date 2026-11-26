import { useState, type KeyboardEvent } from 'react'
import { Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { AmountHint } from '@/components/AmountHint'
import { parseAmount, unreadableAmount } from '@/app/format'
import { useStore } from '@/app/store'
import type { MonthKey, Section } from '@/model'
import { addCategory } from '@/store'
import { showSaveError } from '@/app/saveError'
import { txt } from '@/i18n'

const T = txt.statement.addCategory

/**
 * "Add category" at the foot of Income and Expenses: a name, then the category appears as a line, ready for its first
 * row. With `estimate` (expenses) it also takes an optional amount per month, so "Hobbies, 60" counts from `month` on
 * before it has a single row.
 */
export function AddCategoryInline({ section, onError, estimate }: { section: Section; onError: (msg: string) => void; estimate?: { month: MonthKey; currency: string; locale: string } }) {
  const store = useStore()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [amount, setAmount] = useState('')

  const reset = () => {
    setName('')
    setAmount('')
    setOpen(false)
  }
  async function save() {
    const n = name.trim()
    if (!n) return
    const typed = estimate && amount.trim() !== '' ? parseAmount(amount, estimate.currency, estimate.locale) : 0
    if (typed == null || typed < 0) return onError(unreadableAmount(amount, T.theEstimateIsNot))
    try {
      await addCategory(store, { name: n, section, estimate: estimate && typed > 0 ? { month: estimate.month, amount: typed } : undefined })
      reset()
    } catch (e) {
      showSaveError(onError, T.couldNotAddThe)(e)
    }
  }

  if (!open) {
    return (
      <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={() => setOpen(true)} aria-label={T.addCategoryIn(section)}>
        <Plus /> {T.addCategory}
      </Button>
    )
  }
  const keys = (e: KeyboardEvent<HTMLInputElement>) => { if (e.key === 'Enter') void save(); if (e.key === 'Escape') reset() }
  return (
    <div className="flex flex-wrap items-center gap-1">
      <Input autoFocus className="h-7 w-44" placeholder={T.categoryName} value={name} aria-label={T.newCategoryName(section)} onChange={(e) => setName(e.target.value)} onKeyDown={keys} />
      {estimate && (
        <>
          <Input className="h-7 w-28" inputMode="decimal" placeholder={txt.common.estimate} value={amount} aria-label={T.estimatePerMonthFor(section)} onChange={(e) => setAmount(e.target.value)} onKeyDown={keys} />
          <span className="text-muted-foreground">{T.perMonthOptional(estimate.currency)}</span>
        </>
      )}
      <Button size="sm" onClick={() => void save()}>{txt.common.add}</Button>
      <Button size="sm" variant="ghost" onClick={reset}>{txt.common.cancel}</Button>
      {estimate && <AmountHint text={amount} currency={estimate.currency} locale={estimate.locale} className="basis-full" />}
    </div>
  )
}
