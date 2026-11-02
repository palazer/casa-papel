import { Fragment, useMemo, useState } from 'react'
import { MoreHorizontal } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Check } from '@/components/Check'
import { MonthPicker } from '@/components/MonthPicker'
import { formatAmount, formatMonth } from '@/app/format'
import { useStore } from '@/app/store'
import { activeHousehold, defaultMonths, useTables } from '@/app/useEngine'
import { describeCadence, monthOfDate, type MonthKey, type RecurringItem } from '@/model'
import { deleteRecurringItem, endRecurringItem, recurringStatus, setRecurringPaid } from '@/store'
import { RecurringDialog } from './RecurringDialog'

export function RecurringList() {
  const store = useStore()
  const tables = useTables()
  const household = activeHousehold(tables)
  const months = useMemo(() => (household && tables ? defaultMonths(household, tables) : []), [household, tables])
  const [month, setMonth] = useState<MonthKey>(() => monthOfDate())
  const [editing, setEditing] = useState<RecurringItem | 'new' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<string | null>(null)
  if (!tables || !household) return null
  const { locale, baseCurrency } = household
  const m = months.includes(month) ? month : months[months.length - 1]
  const items = tables.recurringItems.filter((r) => !r.deletedAt).sort((a, b) => a.name.localeCompare(b.name))
  const rowName = (id: string) => tables.rows.find((r) => r.id === id)?.name ?? '?'
  const accountName = (id: string | null) => (id ? tables.accounts.find((a) => a.id === id)?.name ?? '' : '')
  const act = (fn: () => Promise<unknown>) => void fn().catch((e) => setError(e instanceof Error ? e.message : 'Action failed'))

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <MonthPicker months={months} month={m} onChange={setMonth} locale={locale} />
      {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
      <div className="flex items-start justify-between gap-4">
        <p className="text-sm text-muted-foreground">
          The full list. In the grid, open any posted item to change its amount for one month or from now on, skip a month, or end it; open any cell and choose "Make recurring" to start a new one.
        </p>
        <Button onClick={() => setEditing('new')}>Add recurring</Button>
      </div>
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
            <tr><th className="px-3 py-2 font-medium">Name</th><th className="px-3 py-2 font-medium">Row</th><th className="px-3 py-2 text-right font-medium">Amount</th><th className="px-3 py-2 font-medium">When</th><th className="px-3 py-2 font-medium">Account</th><th className="px-3 py-2 font-medium">{formatMonth(m, locale)}</th><th className="px-1 py-2" /></tr>
          </thead>
          <tbody className="divide-y">
            {items.map((it) => {
              const status = recurringStatus(tables, it, m)
              const ended = it.endMonth != null && it.endMonth < m
              return (
                <Fragment key={it.id}>
                <tr className={ended ? 'text-muted-foreground' : ''}>
                  <td className="px-3 py-2 font-medium">{it.name}{ended && <span className="ml-1 text-xs font-normal">(ended {formatMonth(it.endMonth!, locale)})</span>}</td>
                  <td className="px-3 py-2">{rowName(it.rowId)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatAmount(it.amount, it.currency ?? baseCurrency, locale)}</td>
                  <td className="px-3 py-2">{describeCadence(it, locale)}</td>
                  <td className="px-3 py-2">{accountName(it.accountId)}</td>
                  <td className="px-3 py-2">
                    {status === 'not-due' ? <span className="text-muted-foreground">—</span> : (
                      <Check
                        label={<Badge variant={status === 'paid' ? 'secondary' : status === 'skipped' ? 'outline' : 'default'}>{status === 'paid' ? 'Paid' : status === 'skipped' ? 'Skipped' : 'Due'}</Badge>}
                        checked={status === 'paid'}
                        aria-label={`${it.name} paid in ${formatMonth(m, locale)}`}
                        onChange={(e) => act(() => setRecurringPaid(store, it.id, m, e.target.checked))}
                      />
                    )}
                  </td>
                  <td className="px-1 py-2">
                    <DropdownMenu>
                      <DropdownMenuTrigger render={<Button variant="ghost" size="icon" className="size-7" aria-label={`Menu for ${it.name}`} />}><MoreHorizontal /></DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => setEditing(it)}>Edit…</DropdownMenuItem>
                        {ended ? (
                          <DropdownMenuItem onClick={() => act(() => endRecurringItem(store, it.id, null))}>Reactivate</DropdownMenuItem>
                        ) : (
                          <DropdownMenuItem onClick={() => act(() => endRecurringItem(store, it.id, m))}>End after {formatMonth(m, locale)}</DropdownMenuItem>
                        )}
                        <DropdownMenuItem onClick={() => setDeleting(it.id)}>Delete…</DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </td>
                </tr>
                {deleting === it.id && (
                  <tr>
                    <td colSpan={7} className="px-3 py-2">
                      <div className="flex flex-wrap items-center gap-2 text-xs">
                        <span className="text-muted-foreground">Delete "{it.name}" for good? Nothing more will be posted; amounts already in the grid stay. To stop it from a month on instead, use "End after".</span>
                        <Button size="xs" variant="destructive" onClick={() => { setDeleting(null); act(() => deleteRecurringItem(store, it.id)) }}>Really delete</Button>
                        <Button size="xs" variant="ghost" onClick={() => setDeleting(null)}>Cancel</Button>
                      </div>
                    </td>
                  </tr>
                )}
                </Fragment>
              )
            })}
            {items.length === 0 && <tr><td colSpan={7} className="px-3 py-6 text-center text-muted-foreground">Nothing recurring yet. Rent, salary, insurance, subscriptions all belong here.</td></tr>}
          </tbody>
        </table>
      </div>
      {editing && <RecurringDialog tables={tables} household={household} item={editing === 'new' ? null : editing} defaultMonth={m} onClose={() => setEditing(null)} />}
    </div>
  )
}
