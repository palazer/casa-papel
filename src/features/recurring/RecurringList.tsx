import { Fragment, useMemo, useState } from 'react'
import { MoreHorizontal } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Chip } from '@/components/ui/chip'
import { InfoTip } from '@/components/InfoTip'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Check } from '@/components/Check'
import { MonthPicker } from '@/components/MonthPicker'
import { formatAmount, formatMonth } from '@/app/format'
import { useStore } from '@/app/store'
import { activeHousehold, defaultMonths, useTables } from '@/app/useEngine'
import { cellKey, type EngineOutput } from '@/engine'
import { addMonths, describeCadence, monthOfDate, type MonthKey, type RecurringItem } from '@/model'
import { endRecurringItem, reactivateRecurringItem, recurringStatus, rowCurrencyOf, setRecurringPaid } from '@/store'
import { RemoveDialog } from '@/features/remove/RemoveDialog'
import { RecurringDialog } from './RecurringDialog'
import { saveError } from '@/app/saveError'
import { txt } from '@/i18n'

const T = txt.recurring.list

const TH = 'px-1.5 py-1 font-semibold text-muted-foreground'
const TD = 'px-1.5 py-0.5'

export function RecurringList({ engine }: {
  /** The screen's figures, so a payment to a paid-off loan can say that it no longer counts; left out, it says "due". */
  engine?: EngineOutput | null
}) {
  const store = useStore()
  const tables = useTables()
  const household = activeHousehold(tables)
  const months = useMemo(() => (household && tables ? defaultMonths(household, tables) : []), [household, tables])
  const [month, setMonth] = useState<MonthKey>(() => monthOfDate())
  const [editing, setEditing] = useState<RecurringItem | 'new' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [removing, setRemoving] = useState<RecurringItem | null>(null)
  if (!tables || !household) return null
  const { locale } = household
  const m = months.includes(month) ? month : months[months.length - 1]
  const items = tables.recurringItems.filter((r) => !r.deletedAt).sort((a, b) => a.name.localeCompare(b.name))
  const rowName = (id: string) => tables.rows.find((r) => r.id === id)?.name ?? '?'
  const accountName = (id: string | null) => (id ? tables.accounts.find((a) => a.id === id)?.name ?? '' : '')
  const act = (fn: () => Promise<unknown>) => void fn().catch((e) => setError(saveError(e, txt.common.actionFailed)))

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <MonthPicker months={months} month={m} onChange={setMonth} locale={locale} />
        <span className="text-muted-foreground">
          {T.whatRepeatsIsSet}
        </span>
        <Button size="xs" className="ml-auto" onClick={() => setEditing('new')}>{T.addSchedule}</Button>
      </div>
      {error && <p role="alert" className="text-destructive">{error}</p>}
      <div className="overflow-x-auto rounded-md border">
        <table className="w-full">
          <thead className="text-left">
            <tr><th className={TH}>{txt.common.name}</th><th className={TH}>{T.row}</th><th className={`${TH} text-right`}>{T.amount}</th><th className={TH}>{T.when}</th><th className={TH}>{txt.common.account}</th><th className={TH}><span className="inline-flex items-center gap-1">{formatMonth(m, locale)}<InfoTip help="schedule.status" /></span></th><th className="px-1 py-1" /></tr>
          </thead>
          <tbody className="divide-y divide-border/60">
            {items.map((it) => {
              const status = recurringStatus(tables, it, m)
              const ended = it.endMonth != null && it.endMonth < m
              // a piece that ends where a change from a month on begins: the schedule runs on under its newer piece,
              // so there is nothing to reactivate (it would land twice)
              const replaced = it.endMonth != null && items.some((o) => o.id !== it.id && o.rowId === it.rowId && o.name === it.name && o.startMonth === addMonths(it.endMonth!, 1))
              // due, but its loan owes less than the payment or nothing: the month counts less, and there is nothing to tick
              const paidOff = status === 'due' && engine?.cells[cellKey(it.rowId, m)]?.asked != null
              return (
                <Fragment key={it.id}>
                <tr className={ended ? 'text-muted-foreground' : ''}>
                  <td className={`${TD} font-medium`}>{it.name}{ended && <span className="ml-1 text-[10px] font-normal">{T.ended(formatMonth(it.endMonth!, locale))}</span>}</td>
                  <td className={TD}>{rowName(it.rowId)}</td>
                  <td className={`${TD} text-right tabular-nums`}>{formatAmount(it.amount, rowCurrencyOf(tables, it.rowId), locale)}</td>
                  <td className={TD}>{describeCadence(it, locale)}</td>
                  <td className={TD}>{accountName(it.accountId)}</td>
                  <td className={TD}>
                    {status === 'not-due' ? <span className="text-muted-foreground">—</span> : paidOff ? <Chip tone="zinc">{T.paidOff}</Chip> : (
                      <Check
                        label={<Chip tone={status === 'paid' ? 'emerald' : status === 'skipped' ? 'zinc' : 'amber'}>{status === 'paid' ? T.paid : status === 'skipped' ? T.skipped : T.due}</Chip>}
                        checked={status === 'paid'}
                        aria-label={T.paidIn(it.name, formatMonth(m, locale))}
                        onChange={(e) => act(() => setRecurringPaid(store, it.id, m, e.target.checked))}
                      />
                    )}
                  </td>
                  <td className="px-1 py-0.5">
                    <DropdownMenu>
                      <DropdownMenuTrigger render={<Button variant="ghost" size="icon-xs" aria-label={T.menuFor(it.name)} />}><MoreHorizontal /></DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => setEditing(it)}>{txt.common.editMore}</DropdownMenuItem>
                        {replaced ? null : ended ? (
                          <DropdownMenuItem onClick={() => act(() => reactivateRecurringItem(store, it.id))}>{T.reactivate}</DropdownMenuItem>
                        ) : (
                          <DropdownMenuItem onClick={() => act(() => endRecurringItem(store, it.id, m))}>{T.endAfter(formatMonth(m, locale))}</DropdownMenuItem>
                        )}
                        <DropdownMenuItem onClick={() => setRemoving(it)}>{txt.common.deleteMore}</DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </td>
                </tr>
                </Fragment>
              )
            })}
            {items.length === 0 && <tr><td colSpan={7} className="px-2 py-6 text-center text-muted-foreground">{T.nothingRecurringYetRent}</td></tr>}
          </tbody>
        </table>
      </div>
      {editing && <RecurringDialog tables={tables} household={household} item={editing === 'new' ? null : editing} defaultMonth={m} onClose={() => setEditing(null)} />}
      {removing && <RemoveDialog target={{ kind: 'schedule', id: removing.id }} tables={tables} household={household} onClose={() => setRemoving(null)} />}
    </div>
  )
}
