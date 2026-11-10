import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Segmented } from '@/components/Segmented'
import { amountToInput, formatAmount, formatMonth, parseAmount } from '@/app/format'
import { useStore } from '@/app/store'
import { cellKey, computeEngine, type EngineOutput } from '@/engine'
import type { Household, MonthKey, Tables } from '@/model'
import { applyMutations, topUpMutations, topUpPool, type TopUpSource } from '@/store'
import { useSave } from '@/features/grid/RowDialogs'

interface Props {
  tables: Tables
  engine: EngineOutput
  household: Household
  poolId: string
  month: MonthKey
  onClose: () => void
}

const INCOME = 'income'

/**
 * A pool account was asked for more than it holds (DESIGN.md §8): say by how much, and offer to top it up with a
 * record. The source is the unassigned part of its own savings account unless another is picked; the lines the month
 * will then show come from running the save on a copy.
 */
export function TopUpDialog({ tables, engine, household, poolId, month, onClose }: Props) {
  const store = useStore()
  const { locale, baseCurrency: ccy } = household
  const pool = tables.pools.find((p) => p.id === poolId)
  const now = engine.pools[poolId]?.months[month]
  const short = now?.short ?? 0
  const money = (v: number) => formatAmount(v, ccy, locale)
  const monthName = formatMonth(month, locale, 'long')

  /** Savings and investment accounts that hold something this month, the pool account's own savings account first. */
  const sources = useMemo(() => {
    const live = tables.accounts.filter((a) => !a.deletedAt && !a.archivedMonth && (a.type === 'savings' || a.type === 'investment'))
    const own = live.find((a) => a.id === pool?.accountId)
    const set = (accountId: string) => tables.pools.filter((p) => !p.deletedAt && p.accountId === accountId).reduce((sum, p) => sum + (engine.pools[p.id]?.months[month]?.balance ?? 0), 0)
    return [...(own ? [own] : []), ...live.filter((a) => a.id !== own?.id)].map((a) => {
      const balance = engine.accounts[a.id]?.months[month]?.balanceBase
      // what is free in a savings account is what its pool accounts have not set aside
      const free = balance == null ? null : a.type === 'savings' ? balance - set(a.id) : balance
      return { id: a.id, label: a.type === 'savings' ? `${a.name}, not set aside` : a.name, name: a.name, free }
    })
  }, [tables, engine, month, pool?.accountId])
  const [sourceId, setSourceId] = useState(sources[0]?.id ?? INCOME)
  const [text, setText] = useState(short > 0 ? amountToInput(short, ccy, locale) : '')
  const { error, busy, save } = useSave(onClose)

  const amount = text.trim() === '' ? null : parseAmount(text, ccy, locale)
  const chosen = sources.find((s) => s.id === sourceId)
  /** The top-up tried on a copy: what the two rows and the pool account would then show, or why it cannot be saved. */
  const preview = useMemo(() => {
    if (amount == null) return null
    try {
      const source: TopUpSource = sourceId === INCOME ? { kind: 'income' } : { kind: 'account', accountId: sourceId }
      const mutations = topUpMutations(tables, poolId, month, source, amount)
      const after = applyMutations(tables, mutations)
      const out = computeEngine({ tables: after, months: [month] })
      const poolNow = after.pools.find((p) => p.id === poolId)
      const fromRow = sourceId === INCOME ? undefined : after.rows.find((r) => !r.deletedAt && (r.kind === 'from-savings' || r.kind === 'from-investment') && r.accountId === sourceId && mutations.some((mu) => mu.op === 'put' && mu.table === 'cells' && mu.record.rowId === r.id))
      const setAside = after.rows.find((r) => r.id === poolNow?.allocationRowId)
      return {
        from: fromRow ? { name: fromRow.name, amount: out.cells[cellKey(fromRow.id, month)]?.valueBase ?? 0 } : null,
        setAside: setAside ? { name: setAside.name, amount: out.cells[cellKey(setAside.id, month)]?.valueBase ?? 0 } : null,
        short: out.pools[poolId]?.months[month]?.short ?? 0,
        balance: out.pools[poolId]?.months[month]?.balance ?? 0,
        rest: out.totals[month]?.rest ?? null,
      }
    } catch (e) {
      return { error: e instanceof Error ? e.message : 'That top-up cannot be saved.' }
    }
  }, [tables, poolId, month, sourceId, amount])
  const problem = text.trim() !== '' && amount == null ? 'That is not a number I can read.' : preview && 'error' in preview ? preview.error : null
  const lines = preview && !('error' in preview) ? preview : null

  function submit() {
    if (amount == null || problem) return
    const source: TopUpSource = sourceId === INCOME ? { kind: 'income' } : { kind: 'account', accountId: sourceId }
    void save(async () => { await topUpPool(store, poolId, month, source, amount) })
  }

  if (!pool || !now) return null
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="sm:max-w-lg" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>{short > 0 ? `${pool.name} is short in ${monthName}` : `Top up ${pool.name} in ${monthName}`}</DialogTitle>
          <DialogDescription>
            {short > 0
              ? <>{money(now.spend)} comes out of {pool.name} this month and it holds {money(now.spend - short)}: {money(short)} is missing. Until it is topped up, the missing part comes out of the unassigned savings without a line of its own.</>
              : <>{pool.name} holds {money(now.balance)} at the end of {monthName}. A top-up adds to it this month only.</>}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <fieldset className="space-y-1.5">
            <legend className="text-sm font-medium">Top it up from</legend>
            <Segmented
              label="Top it up from" value={sourceId} onChange={setSourceId}
              options={[...sources.map((s) => ({ value: s.id, label: s.free != null ? `${s.label} · ${money(s.free)}` : s.label })), { value: INCOME, label: 'This month\'s income' }]}
            />
            <p className="text-xs text-muted-foreground">
              {sourceId === INCOME
                ? `More of this month's income is set aside for ${pool.name}, so the rest of the month shrinks by the amount. Nothing is taken from an account.`
                : `The month takes the money out of ${chosen?.name ?? 'the account'} and sets it aside for ${pool.name}. Both show as a line, and the rest of the month stays as it is.`}
            </p>
          </fieldset>
          <div className="space-y-1.5">
            <Label htmlFor="top-up-amount">Amount in {ccy}</Label>
            <Input id="top-up-amount" className="w-40" autoFocus inputMode="decimal" value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') submit() }} />
          </div>
          {lines && (
            <div className="space-y-1">
              <p className="text-sm font-medium">{monthName} will then show</p>
              <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-sm" data-testid="top-up-preview">
                {lines.from && (<><dt className="text-muted-foreground">Money in · {lines.from.name}</dt><dd className="text-right tabular-nums">{money(lines.from.amount)}</dd></>)}
                {lines.setAside && (<><dt className="text-muted-foreground">Money out · {lines.setAside.name}, this month</dt><dd className="text-right tabular-nums">{money(lines.setAside.amount)}</dd></>)}
                <dt className="text-muted-foreground">{pool.name} at the end of the month{lines.short > 0 ? `, still short by ${money(lines.short)}` : ''}</dt>
                <dd className="text-right tabular-nums" data-testid="top-up-balance">{money(lines.balance)}</dd>
              </dl>
            </div>
          )}
          {(problem || error) && <p className="text-sm text-destructive" role="alert">{problem ?? error}</p>}
        </div>
        <DialogFooter className="flex-row flex-wrap gap-2 sm:justify-between">
          <Button variant="ghost" onClick={onClose} disabled={busy}>Not now</Button>
          <Button onClick={submit} disabled={busy || amount == null || !!problem}>Top up</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
