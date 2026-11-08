import { ChevronRight, Repeat } from 'lucide-react'
import { Chip } from '@/components/ui/chip'
import { InfoTip } from '@/components/InfoTip'
import { Tick } from '@/components/Tick'
import { cn } from '@/lib/utils'
import type { CellResult, ResolvedItem } from '@/engine'
import type { Row } from '@/model'
import { formatAmount } from '@/app/format'
import { amountDisplay, doneLabel, doneness, flowOf, statusClass, toneClass, type DoneState, type Flow } from '@/features/grid/display'

interface Props {
  row: Row
  cell: CellResult
  locale: string
  ccy: string
  neg: boolean
  closed: boolean
  /** The app works this row's amount out (the savings plug, a pocket share). */
  automatic: boolean
  followedName?: string
  expanded: boolean
  onExpand: (open: boolean) => void
  /** Open the Paid sheet for the line, or for one of its items. */
  onOpen: (itemId: string | null) => void
  onTick: (itemId: string | null, done: boolean) => void
  busy: boolean
}

const BODY = 'flex min-h-11 min-w-0 items-center gap-2 px-3 py-2 text-left text-sm outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:hover:bg-transparent'

/**
 * One row of the Month view (DESIGN.md §7): the body on the left, the tick on the right. An itemized line opens as an
 * accordion with a tick per item; any other line opens the Paid sheet; an automatic line is plain text with an (i).
 */
export function MonthLine({ row, cell, locale, ccy, neg, closed, automatic, followedName, expanded, onExpand, onOpen, onTick, busy }: Props) {
  const currency = cell.currency
  const flow = flowOf(row)
  const d = amountDisplay(cell.value, flow, currency, locale, neg)
  const live = cell.items.filter((i) => !i.skipped)
  const itemized = live.length > 1
  const empty = cell.source === 'empty' || (cell.source === 'items' && live.length === 0)
  const derived = cell.source === 'derived'
  const dn = doneness(cell)
  const tickable = !empty && cell.value !== 0
  const listId = `${row.id}-items`
  const subtitle = itemized
    ? dn.done > 0 && dn.done < dn.total ? `${dn.done} of ${dn.total} done` : `${live.length} items`
    : followedName ? `= ${followedName}` : automatic ? 'automatic' : null
  // an amount in another currency carries its household-currency value in the subline
  const about = !empty && currency !== ccy ? formatAmount(cell.valueBase, ccy, locale, { compact: true }) : null
  const net = row.section === 'income' && cell.deductionsBase > 0 ? formatAmount(cell.netBase, ccy, locale, { compact: true }) : null
  const subline = [subtitle, net ? `net ${net}` : about ? `≈ ${about}` : null].filter(Boolean).join(' · ') || null
  const amount = (
    <span className={cn('shrink-0 tabular-nums', toneClass[d.tone], empty ? 'text-muted-foreground/40' : derived ? statusClass.derived : statusClass[cell.status])}>
      {empty ? '·' : d.text}
    </span>
  )
  const label = `${row.name}: ${empty ? 'empty' : d.text}${net ? `, net ${net}` : about ? `, about ${about}` : ''}${tickable ? `, ${doneLabel(dn)}` : ''}`

  return (
    <li>
      <div className="grid grid-cols-[minmax(0,1fr)_2.75rem] items-stretch">
        {derived ? (
          <div className="flex min-h-11 min-w-0 items-center gap-2 px-3 py-2 text-sm">
            <span className="min-w-0 flex-1">
              <span className="block truncate">{row.name}</span>
              {subline && (
                <span className="flex items-center gap-1 text-xs text-muted-foreground">
                  {subline}
                  <InfoTip help={followedName ? 'row.follows' : 'row.automatic'} />
                </span>
              )}
            </span>
            {amount}
          </div>
        ) : (
          <button
            type="button" disabled={closed && !itemized} aria-label={label} aria-expanded={itemized ? expanded : undefined} aria-controls={itemized ? listId : undefined}
            onClick={() => (itemized ? onExpand(!expanded) : onOpen(live[0]?.id ?? null))} className={BODY}
          >
            {itemized && <ChevronRight className={cn('size-3.5 shrink-0 text-muted-foreground transition-transform', expanded && 'rotate-90')} aria-hidden />}
            <span className="min-w-0 flex-1">
              <span className="block truncate">{row.name}</span>
              {subline && <span className="block text-xs text-muted-foreground">{subline}</span>}
            </span>
            {amount}
          </button>
        )}
        {tickable ? (
          <Tick done={dn.done} total={dn.total} state={dn.state} label={`${row.name} done`} disabled={closed || busy} onToggle={() => onTick(null, dn.state !== 'all')} />
        ) : <span />}
      </div>
      {itemized && expanded && (
        <ul id={listId} className="divide-y divide-border/60 border-t border-border/60 bg-muted/20">
          {cell.items.map((it) => (
            <MonthItemLine
              key={it.id} row={row} item={it} currency={currency} locale={locale} neg={neg} flow={flow} closed={closed} busy={busy}
              onOpen={() => onOpen(it.id)} onTick={() => onTick(it.id, it.status !== 'done')}
            />
          ))}
        </ul>
      )}
    </li>
  )
}

function MonthItemLine({ row, item, currency, locale, neg, flow, closed, busy, onOpen, onTick }: {
  row: Row; item: ResolvedItem; currency: string; locale: string; neg: boolean; flow: Flow; closed: boolean; busy: boolean; onOpen: () => void; onTick: () => void
}) {
  const name = item.label || 'Amount'
  const d = amountDisplay(item.effectiveAmount, flow, currency, locale, neg)
  const state: DoneState = item.status === 'done' ? 'all' : 'none'
  return (
    <li className="grid grid-cols-[minmax(0,1fr)_2.75rem] items-stretch">
      <button type="button" disabled={closed || item.skipped} aria-label={`${row.name}: ${name}: ${d.text}${item.recurringItemId ? ', on a schedule' : ''}${item.skipped ? ', skipped' : ''}`} onClick={onOpen} className={cn(BODY, 'pl-9')}>
        {item.recurringItemId && <Repeat className="size-3 shrink-0 text-muted-foreground" aria-hidden />}
        <span className={cn('min-w-0 flex-1 truncate', item.skipped && 'text-muted-foreground line-through')}>{name}</span>
        {item.skipped && <Chip tone="zinc">skipped</Chip>}
        <span className={cn('shrink-0 tabular-nums', toneClass[d.tone], statusClass[item.status], item.skipped && 'text-muted-foreground')}>{d.text}</span>
      </button>
      {item.skipped ? <span /> : (
        <Tick done={state === 'all' ? 1 : 0} total={1} state={state} label={`${row.name}: ${name} done`} disabled={closed || busy} onToggle={onTick} />
      )}
    </li>
  )
}
