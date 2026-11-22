import { useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Segmented } from '@/components/Segmented'
import { formatMonth } from '@/app/format'
import { useStore } from '@/app/store'
import { sortRows } from '@/engine'
import { ENTITY_KIND_LABEL, buysOnCard, holdsBalance, monthOfDate, payContext, usualMethod, type Account, type FundedBy, type Household, type Row, type Section, type Tables } from '@/model'
import { accountTypeForRow, derivedRowReason, followRow, setRowAccount, setRowDeductedFrom, setRowFundedBy, setRowScope, setUsualPayment, thirdCurrencyReason, updateRow } from '@/store'
import { NativeSelect } from '@/components/NativeSelect'
import { UsualPaidFields } from '@/features/payments/PaidFields'
import { fundingOptions } from './funding'
import { currencyChoices, currencyLabel } from '@/app/currencies'
import { HELP } from '@/app/help'
import { TipLabel } from '@/components/InfoTip'
import { accountHelp, accountVerb, landingAccounts, movesMoney, paysByCard } from './rowAccount'
import { saveError } from '@/app/saveError'

interface Base {
  row: Row
  tables: Tables
  household: Household
  onClose: () => void
}

const SECTIONS: Array<{ key: Section; title: string }> = [
  { key: 'income', title: 'Income' },
  { key: 'expense', title: 'Expenses' },
  { key: 'transfer', title: 'Transfers' },
]

/** Busy and error state for a dialog that saves once and closes. */
export function useSave(onClose: () => void) {
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  // Buttons are disabled while a save runs, but Enter in a field is not a button: a second press before the first
  // has finished must not save twice (a top-up would be added twice).
  const running = useRef(false)
  const save = async (fn: () => Promise<void>) => {
    if (running.current) return
    running.current = true
    setBusy(true)
    setError(null)
    try {
      await fn()
      onClose()
    } catch (e) {
      setError(saveError(e, 'Could not save.'))
    } finally {
      running.current = false
      setBusy(false)
    }
  }
  return { error, busy, save }
}

/**
 * Rule X15 on the spot: why the row with `patch` would make an amount count across three currencies, or null. The
 * dialog shows it under its field as soon as the choice is made and holds Save back; the store refuses the same.
 */
function thirdCurrencyOf(tables: Tables, row: Row, patch: Partial<Row>): string | null {
  return thirdCurrencyReason(tables, [{ op: 'put', table: 'rows', record: { ...row, ...patch } }])
}
const Refusal = ({ text }: { text: string | null }) => (text ? <p className="text-sm text-destructive" role="alert" data-testid="third-currency">{text}</p> : null)

/** Where a spending row's single amounts come out of, from a month on or for all months. */
export function RowSourceDialog({ row, tables, household, onClose }: Base) {
  const store = useStore()
  const options = fundingOptions(tables, [row.defaultFundedBy])
  const [fundedBy, setFundedBy] = useState<FundedBy>(row.defaultFundedBy)
  const [scope, setScope] = useState<'from-month' | 'all-months'>('from-month')
  const { error, busy, save } = useSave(onClose)
  const month = monthOfDate()
  const oldLabel = options.find((o) => o.value === row.defaultFundedBy)?.label ?? 'the old source'
  const third = thirdCurrencyOf(tables, row, { defaultFundedBy: fundedBy })

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Comes out of</DialogTitle>
          <DialogDescription>Row "{row.name}"</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="row-source">Single amounts in this row come out of</Label>
            <NativeSelect id="row-source" className="w-full" value={fundedBy} onChange={(e) => setFundedBy(e.target.value as FundedBy)}>
              {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </NativeSelect>
            <p className="text-xs text-muted-foreground">{HELP['cell.comesOutOf'].text} Items that have their own choice keep it.</p>
            <Refusal text={third} />
          </div>
          <fieldset className="space-y-1.5">
            <legend className="text-sm font-medium">Applies to</legend>
            <Segmented
              value={scope}
              onChange={(v) => setScope(v as 'from-month' | 'all-months')}
              options={[{ value: 'from-month', label: `From ${formatMonth(month, household.locale)} on` }, { value: 'all-months', label: 'All months, past included' }]}
            />
            <p className="text-xs text-muted-foreground">
              {scope === 'from-month'
                ? `Earlier months stay as they are (${oldLabel}), so the past balances of your accounts and virtual accounts do not move.`
                : 'Earlier months change too: the balances of the accounts and virtual accounts involved are worked out again from the start.'}
            </p>
          </fieldset>
          {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={() => void save(() => setRowFundedBy(store, row.id, fundedBy, scope === 'all-months' ? 'all-months' : { from: month }))} disabled={busy || third != null}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** Destination for transfers, the card or loan a payment row clears, or the paying account for everything else. */
export function RowAccountDialog({ row, tables, onClose }: Base) {
  const store = useStore()
  const need = accountTypeForRow(row)
  // an ordinary expense names the card it is bought on; an account of another kind stays listed only while the row still names it
  const byCard = paysByCard(row)
  // pocket money lands only in an account that net worth leaves out; any other account the row still names is not offered
  const pocket = row.kind === 'pocket-money'
  // a row that moves money sends it into the account it names: only one with a balance of its own can receive it
  const moves = movesMoney(row)
  const fits = (a: Account) => (need ? a.type === need : moves ? holdsBalance(a) || a.id === row.accountId : !byCard || a.type === 'credit-card' || a.id === row.accountId)
  // archived accounts are offered only while the row still points at one
  const accounts = pocket ? landingAccounts(tables.accounts) : tables.accounts.filter((a) => !a.deletedAt && fits(a) && (!a.archivedMonth || a.id === row.accountId))
  const [accountId, setAccountId] = useState(() => (pocket && !accounts.some((a) => a.id === row.accountId) ? '' : row.accountId ?? ''))
  const { error, busy, save } = useSave(onClose)
  const verb = accountVerb(row)
  const third = thirdCurrencyOf(tables, row, { accountId: accountId || null })

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{verb}</DialogTitle>
          <DialogDescription>Row "{row.name}"</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="row-account">{byCard ? 'Card' : verb}</Label>
            <NativeSelect id="row-account" className="w-full" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
              {!need && <option value="">{byCard ? 'Not by card' : pocket ? 'Nowhere' : moves ? 'No account: the money leaves the plan' : '—'}</option>}
              {need && !accountId && <option value="">Pick an account</option>}
              {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}{need && !a.tracked ? ' (not tracked)' : ''}{byCard && a.type !== 'credit-card' ? ' (not a card)' : ''}{moves && !holdsBalance(a) ? ' (has no balance to go into)' : ''}</option>)}
            </NativeSelect>
            <p className="text-xs text-muted-foreground">{accountHelp(row)}</p>
            {byCard && !accounts.some((a) => a.type === 'credit-card') && <p className="text-xs text-muted-foreground">No credit card yet: add one on the Statement under "Debts and net worth".</p>}
            {need && accounts.length === 0 && <p className="text-xs text-muted-foreground">No account of the right kind yet. Add one under Household first.</p>}
            {pocket && accounts.length === 0 && <p className="text-xs text-muted-foreground" data-testid="no-landing">No account is left out of net worth yet. Open an account, or add one, and tick "Leave out of net worth" under "More options".</p>}
            <Refusal text={third} />
          </div>
          <p className="text-xs text-muted-foreground">Applies to every month, past ones included. To switch from a month on, archive this row and add a new one.</p>
          {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={() => void save(() => setRowAccount(store, row.id, accountId || null))} disabled={busy || third != null}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/**
 * "Usually paid…": the day and the method of a row's amounts, for every month. While the household plans its
 * payments it stands where "Paid by card…" stood for an ordinary expense row: a method that draws on a card says the
 * same thing, and more.
 */
export function RowPaidDialog({ row, tables, onClose }: Base) {
  const store = useStore()
  const usual = usualMethod(row, payContext(tables))?.id ?? null
  const [day, setDay] = useState<number | null>(row.payDay ?? null)
  const [methodId, setMethodId] = useState<string | null>(usual)
  const { error, busy, save } = useSave(onClose)
  const method = methodId ? tables.paymentMethods.find((m) => m.id === methodId) : undefined
  const third = buysOnCard(row) ? thirdCurrencyOf(tables, row, { accountId: method ? method.accountId : row.accountId }) : null
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Usually paid</DialogTitle>
          <DialogDescription>Row "{row.name}"</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <UsualPaidFields titled tables={tables} row={row} day={day} methodId={methodId} onDay={setDay} onMethod={setMethodId} idPrefix="row-usual" says="For every month of this row, past ones included. An item of a month can name a day and a method of its own." />
          <Refusal text={third} />
          {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={() => void save(() => setUsualPayment(store, row.id, { payDay: day, payMethodId: methodId }))} disabled={busy || third != null}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** Make this row mirror another row's amount month by month. */
export function RowFollowDialog({ row, tables, household, onClose }: Base) {
  const store = useStore()
  const rule = household.closingRule
  const candidates = sortRows(tables.rows.filter((r) => !r.deletedAt && r.id !== row.id && !r.archivedMonth && !r.followsRowId && !derivedRowReason(r, rule)), tables.categories)
  const [targetId, setTargetId] = useState(row.followsRowId ?? '')
  // shown to a tenth of a percent; an untouched field keeps the stored fraction exactly
  const seeded = String(Math.round((row.followShare ?? 1) * 1000) / 10)
  const [share, setShare] = useState(seeded)
  const { error, busy, save } = useSave(onClose)
  const third = thirdCurrencyOf(tables, row, { followsRowId: targetId || null })

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Follow another row</DialogTitle>
          <DialogDescription>Row "{row.name}"</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="row-follows">Same amount as</Label>
            <NativeSelect id="row-follows" className="w-full" value={targetId} onChange={(e) => setTargetId(e.target.value)}>
              <option value="">Nothing: its own amounts</option>
              {SECTIONS.map((s) => {
                const list = candidates.filter((r) => r.section === s.key)
                return list.length ? (
                  <optgroup key={s.key} label={s.title}>
                    {list.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                  </optgroup>
                ) : null
              })}
            </NativeSelect>
            <p className="text-xs text-muted-foreground">
              Month by month this row shows the same amount as the row you pick, or a share of it, and its cells cannot be edited while it follows.
              Handy for a transfer that moves exactly what came in, like a child's long-term savings following the child benefit, or a tax that takes a quarter of a salary.
              Choose "Nothing" to go back to its own amounts; they were kept.
            </p>
            <Refusal text={third} />
          </div>
          {targetId && (
            <div className="space-y-1.5">
              <TipLabel htmlFor="row-follow-share" help="row.followShare">Share (%)</TipLabel>
              <Input id="row-follow-share" className="w-28" inputMode="decimal" value={share} onChange={(e) => setShare(e.target.value)} />
              <p className="text-xs text-muted-foreground">100 mirrors the row exactly; 25 puts a quarter of it here.</p>
            </div>
          )}
          {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button
            onClick={() => void save(async () => {
              const pct = Number(share.replace(',', '.'))
              if (targetId && !(pct > 0)) throw new Error('The share must be a number above 0.')
              const fraction = share === seeded ? row.followShare : pct / 100
              await followRow(store, row.id, targetId || null, targetId ? fraction : null)
            })}
            disabled={busy || third != null}
          >Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** The currency this row's amounts are typed in; the grid shows the household-currency value beneath each one. */
export function RowCurrencyDialog({ row, tables, household, onClose }: Base) {
  const store = useStore()
  const base = household.baseCurrency
  const codes = currencyChoices(base, row.currency)
  const [ccy, setCcy] = useState(row.currency ?? base)
  const { error, busy, save } = useSave(onClose)
  const third = thirdCurrencyOf(tables, row, { currency: ccy === base ? null : ccy })

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Currency</DialogTitle>
          <DialogDescription>Row "{row.name}"</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <TipLabel htmlFor="row-currency" help="row.currency">Amounts in this row are in</TipLabel>
            <NativeSelect id="row-currency" className="w-full" value={ccy} onChange={(e) => setCcy(e.target.value)}>
              {codes.map((c) => <option key={c} value={c}>{currencyLabel(c, base)}</option>)}
            </NativeSelect>
            <p className="text-xs text-muted-foreground">{HELP['row.currency'].text}</p>
            <Refusal text={third} />
          </div>
          {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={() => void save(() => updateRow(store, row.id, { currency: ccy === base ? null : ccy }))} disabled={busy || third != null}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** Take this spending row out of an income row: the income shows what is left, and the shares count the net. */
export function RowDeductionDialog({ row, tables, household, onClose }: Base) {
  const store = useStore()
  const rule = household.closingRule
  // live income rows; an archived one stays listed while this row is still deducted from it (the engine stops at its archive month)
  const incomes = sortRows(tables.rows.filter((r) => !r.deletedAt && r.section === 'income' && (!r.archivedMonth || r.id === row.deductedFromRowId) && !derivedRowReason(r, rule)), tables.categories)
  const [targetId, setTargetId] = useState(row.deductedFromRowId ?? '')
  const { error, busy, save } = useSave(onClose)

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Deducted from an income</DialogTitle>
          <DialogDescription>Row "{row.name}"</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <TipLabel htmlFor="row-deducted-from" help="row.deductedFrom">This expense is taken off</TipLabel>
            <NativeSelect id="row-deducted-from" className="w-full" value={targetId} onChange={(e) => setTargetId(e.target.value)}>
              <option value="">Nothing: a normal expense</option>
              {incomes.map((r) => <option key={r.id} value={r.id}>{r.name}{r.archivedMonth ? ' (archived)' : ''}</option>)}
            </NativeSelect>
            <p className="text-xs text-muted-foreground">{HELP['row.deductedFrom'].text} The row then belongs to whoever that income belongs to.</p>
          </div>
          {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={() => void save(async () => { if (targetId !== (row.deductedFromRowId ?? '')) await setRowDeductedFrom(store, row.id, targetId || null) })} disabled={busy}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** Who a row is for: the household, an adult, or a child, pet or thing. */
export function RowScopeDialog({ row, tables, onClose }: Base) {
  const store = useStore()
  const live = tables.entities.filter((e) => !e.deletedAt && (!e.archivedMonth || e.id === row.scope)).sort((a, b) => (a.order < b.order ? -1 : a.order > b.order ? 1 : 0))
  const adults = live.filter((e) => e.kind === 'adult')
  const others = live.filter((e) => e.kind !== 'adult')
  const [scope, setScope] = useState(row.scope)
  const { error, busy, save } = useSave(onClose)

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Belongs to</DialogTitle>
          <DialogDescription>Row "{row.name}"</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <TipLabel htmlFor="row-belongs-to" help="row.belongsTo">This row is for</TipLabel>
            <NativeSelect id="row-belongs-to" className="w-full" value={scope} onChange={(e) => setScope(e.target.value)}>
              <option value="shared">The household (shared)</option>
              {adults.length > 0 && <optgroup label="Adults">{adults.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}</optgroup>}
              {others.length > 0 && <optgroup label="Other people & things">{others.map((e) => <option key={e.id} value={e.id}>{e.name} · {ENTITY_KIND_LABEL[e.kind].toLowerCase()}</option>)}</optgroup>}
            </NativeSelect>
            <p className="text-xs text-muted-foreground">{HELP['row.belongsTo'].text}</p>
          </div>
          {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={() => void save(() => setRowScope(store, row.id, scope))} disabled={busy}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
