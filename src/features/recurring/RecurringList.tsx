import { Fragment, useMemo, useState } from 'react'
import { MoreHorizontal } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Chip } from '@/components/ui/chip'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Check } from '@/components/Check'
import { MonthPicker } from '@/components/MonthPicker'
import { formatAmount, formatMonth } from '@/app/format'
import { useStore } from '@/app/store'
import { activeHousehold, defaultMonths, useTables } from '@/app/useEngine'
import { describeCadence, monthOfDate, type MonthKey, type RecurringItem } from '@/model'
import { deleteRecurringItem, endRecurringItem, recurringStatus, setRecurringPaid } from '@/store'
import { RecurringDialog } from './RecurringDialog'

const TH = 'px-1.5 py-1 font-semibold text-muted-foreground'
const TD = 'px-1.5 py-0.5'

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
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <MonthPicker months={months} month={m} onChange={setMonth} locale={locale} />
        <span className="text-muted-foreground">
          In the grid, open any posted item to change its amount for one month or from now on, skip a month, or end it; open any cell and choose "Make recurring" to start a new one.
        </span>
        <Button size="xs" className="ml-auto" onClick={() => setEditing('new')}>Add recurring</Button>
      </div>
      {error && <p role="alert" className="text-destructive">{error}</p>}
      <div className="overflow-x-auto rounded-md border">
        <table className="w-full">
          <thead className="text-left">
            <tr><th className={TH}>Name</th><th className={TH}>Row</th><th className={`${TH} text-right`}>Amount</th><th className={TH}>When</th><th className={TH}>Account</th><th className={TH}>{formatMonth(m, locale)}</th><th className="px-1 py-1" /></tr>
          </thead>
          <tbody className="divide-y divide-border/60">
            {items.map((it) => {
              const status = recurringStatus(tables, it, m)
              const ended = it.endMonth != null && it.endMonth < m
              return (
                <Fragment key={it.id}>
                <tr className={ended ? 'text-muted-foreground' : ''}>
                  <td className={`${TD} font-medium`}>{it.name}{ended && <span className="ml-1 text-[10px] font-normal">(ended {formatMonth(it.endMonth!, locale)})</span>}</td>
                  <td className={TD}>{rowName(it.rowId)}</td>
                  <td className={`${TD} text-right tabular-nums`}>{formatAmount(it.amount, it.currency ?? baseCurrency, locale)}</td>
                  <td className={TD}>{describeCadence(it, locale)}</td>
                  <td className={TD}>{accountName(it.accountId)}</td>
                  <td className={TD}>
                    {status === 'not-due' ? <span className="text-muted-foreground">—</span> : (
                      <Check
                        label={<Chip tone={status === 'paid' ? 'emerald' : status === 'skipped' ? 'zinc' : 'amber'}>{status === 'paid' ? 'paid' : status === 'skipped' ? 'skipped' : 'due'}</Chip>}
                        checked={status === 'paid'}
                        aria-label={`${it.name} paid in ${formatMonth(m, locale)}`}
                        onChange={(e) => act(() => setRecurringPaid(store, it.id, m, e.target.checked))}
                      />
                    )}
                  </td>
                  <td className="px-1 py-0.5">
                    <DropdownMenu>
                      <DropdownMenuTrigger render={<Button variant="ghost" size="icon-xs" aria-label={`Menu for ${it.name}`} />}><MoreHorizontal /></DropdownMenuTrigger>
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
                    <td colSpan={7} className="px-2 py-1.5">
                      <div className="flex flex-wrap items-center gap-2">
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
            {items.length === 0 && <tr><td colSpan={7} className="px-2 py-6 text-center text-muted-foreground">Nothing recurring yet. Rent, salary, insurance, subscriptions all belong here.</td></tr>}
          </tbody>
        </table>
      </div>
      {editing && <RecurringDialog tables={tables} household={household} item={editing === 'new' ? null : editing} defaultMonth={m} onClose={() => setEditing(null)} />}
    </div>
  )
}
