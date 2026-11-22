import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Chip } from '@/components/ui/chip'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Island } from '@/components/ui/island'
import { Label } from '@/components/ui/label'
import { Check } from '@/components/Check'
import { InfoTip, TipLabel } from '@/components/InfoTip'
import { NativeSelect } from '@/components/NativeSelect'
import { HUES } from '@/app/hues'
import { useStore } from '@/app/store'
import { saveError, showSaveError } from '@/app/saveError'
import {
  METHOD_ACCOUNT_TYPES, PAYMENT_KIND_INFO, methodAccountReason, paymentKindInfo,
  type Account, type Entity, type PaymentKind, type PaymentMethod, type Tables,
} from '@/model'
import { methodDetail } from '@/features/payments/methods'
import { addPaymentMethod, addPaymentMethods, methodInUse, removePaymentMethod, starterMethods, updatePaymentMethod, type PaymentMethodInput } from '@/store'

const byOrder = <T extends { order: string }>(a: T, b: T) => (a.order < b.order ? -1 : a.order > b.order ? 1 : 0)

/**
 * The household's ways of paying: shown while "Plan payments by day and method" is on. A method that is in use is
 * archived, not deleted, and keeps the account it draws on.
 */
export function PaymentMethodsCard({ tables, onError }: { tables: Tables; onError: (m: string) => void }) {
  const store = useStore()
  const [editing, setEditing] = useState<PaymentMethod | 'new' | null>(null)
  const all = tables.paymentMethods.filter((m) => !m.deletedAt).sort(byOrder)
  const methods = all.filter((m) => !m.archived)
  const archived = all.filter((m) => m.archived)
  const act = (fn: () => Promise<unknown>) => void fn().catch(showSaveError(onError, 'Action failed'))
  const line = (m: PaymentMethod) => (
    <>
      <Chip tone="zinc">{paymentKindInfo(m.kind).label.toLowerCase()}</Chip>
      <span className={m.archived ? undefined : 'font-medium'}>{m.name}</span>
      <span className="text-muted-foreground">on {methodDetail(m, tables)}</span>
    </>
  )
  return (
    <Island
      air tone={HUES.transfer} title="Payment methods"
      description={'How an amount leaves: a direct debit, a standing order, a card, cash. Each method draws on one of your accounts or cards. An amount says which it is "Paid with", and the Payments page adds up what each has to carry.'}
    >
      <div className="space-y-3" data-testid="payment-methods">
        {methods.length > 0 && (
          <ul className="divide-y divide-border/60">
            {methods.map((m) => (
              <li key={m.id} className="flex min-h-8 flex-wrap items-center gap-2 py-1">
                {line(m)}
                <Button size="xs" variant="ghost" className="ml-auto" onClick={() => setEditing(m)}>Edit</Button>
              </li>
            ))}
          </ul>
        )}
        {methods.length === 0 && <StarterList tables={tables} onError={onError} />}
        {archived.length > 0 && (
          <div className="space-y-1">
            <p className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Archived <InfoTip help="payments.archivedMethod" /></p>
            <ul className="divide-y divide-border/60">
              {archived.map((m) => (
                <li key={m.id} className="flex min-h-8 flex-wrap items-center gap-2 py-1 text-muted-foreground">
                  {line(m)}
                  <Button size="xs" variant="outline" className="ml-auto" onClick={() => act(() => updatePaymentMethod(store, m.id, { archived: false }))}>Use again</Button>
                </li>
              ))}
            </ul>
          </div>
        )}
        <Button variant="outline" size="xs" onClick={() => setEditing('new')}>Add method</Button>
        {editing && <PaymentMethodDialog method={editing === 'new' ? null : editing} tables={tables} onClose={() => setEditing(null)} />}
      </div>
    </Island>
  )
}

/** The first methods, offered from the accounts the household has: tick, and they are added in one step. */
function StarterList({ tables, onError }: { tables: Tables; onError: (m: string) => void }) {
  const store = useStore()
  const offered = starterMethods(tables)
  const [off, setOff] = useState<Set<number>>(new Set())
  if (offered.length === 0) return <p className="text-muted-foreground">No methods yet. A method draws on an account or a card, so add one of those first.</p>
  const chosen = offered.filter((_, i) => !off.has(i))
  return (
    <div className="space-y-2" data-testid="starter-methods">
      <p className="text-muted-foreground">No methods yet. Start with these, from the accounts you have; untick what you do not use.</p>
      <div className="space-y-1.5">
        {offered.map((m, i) => (
          <Check
            key={`${m.kind}|${m.accountId}`} checked={!off.has(i)}
            label={<>{m.name} <span className="text-muted-foreground">· {paymentKindInfo(m.kind).label.toLowerCase()} on {tables.accounts.find((a) => a.id === m.accountId)?.name}</span></>}
            onChange={(e) => { const next = new Set(off); if (e.target.checked) next.delete(i); else next.add(i); setOff(next) }}
          />
        ))}
      </div>
      <Button size="sm" disabled={chosen.length === 0} onClick={() => { addPaymentMethods(store, chosen).catch(showSaveError(onError, 'Could not add the methods.')) }}>
        Add {chosen.length} {chosen.length === 1 ? 'method' : 'methods'}
      </Button>
    </div>
  )
}

/** A name someone might give a method of each kind: the field's example. */
const EXAMPLE: Record<PaymentKind, string> = {
  'direct-debit': 'SEPA direct debit', 'standing-order': 'Standing order', transfer: 'Bank transfer', 'debit-card': 'Debit card',
  'credit-card': 'Visa', wallet: 'PayPal', cash: 'Cash', other: 'Voucher',
}

/** The accounts a method of this kind can draw on: a card for a credit card, no card for what a bank account does. */
const fits = (kind: PaymentKind, account: Account): boolean => methodAccountReason(kind, account) == null

export function PaymentMethodDialog({ method, tables, onClose, onSaved }: { method: PaymentMethod | null; tables: Tables; onClose: () => void; onSaved?: (m: PaymentMethod) => void }) {
  const store = useStore()
  const accounts = tables.accounts.filter((a) => !a.deletedAt && METHOD_ACCOUNT_TYPES.includes(a.type) && (!a.archivedMonth || a.id === method?.accountId)).sort(byOrder)
  const adults: Entity[] = tables.entities.filter((e) => !e.deletedAt && e.kind === 'adult' && (!e.archivedMonth || e.id === method?.ownerEntityId)).sort(byOrder)
  const used = method != null && methodInUse(tables, method.id)
  const [kind, setKind] = useState<PaymentKind>(method?.kind ?? 'direct-debit')
  const [name, setName] = useState(method?.name ?? '')
  const [accountId, setAccountId] = useState(method?.accountId ?? accounts.find((a) => fits('direct-debit', a))?.id ?? '')
  const [owner, setOwner] = useState(method?.ownerEntityId ?? '')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const offered = accounts.filter((a) => fits(kind, a) || a.id === accountId)
  const account = accounts.find((a) => a.id === accountId)
  const reason = account ? methodAccountReason(kind, account) : null
  const info = paymentKindInfo(kind)

  function pickKind(next: PaymentKind) {
    setKind(next)
    // an account the new kind cannot draw on gives way to the first one it can; a method in use keeps its account
    if (!used && !(account && fits(next, account))) {
      const first = accounts.find((a) => fits(next, a))
      setAccountId(first?.id ?? '')
      if (first && !owner && first.ownerEntityId && adults.some((e) => e.id === first.ownerEntityId)) setOwner(first.ownerEntityId)
    }
  }
  function save() {
    if (busy) return
    setBusy(true)
    const input: PaymentMethodInput = { name: name.trim(), kind, accountId, ownerEntityId: owner || null }
    const saving: Promise<unknown> = method ? updatePaymentMethod(store, method.id, input) : addPaymentMethod(store, input).then((made) => onSaved?.(made))
    // a refusal is said in the dialog, where it is seen
    saving.then(onClose).catch((e) => { setBusy(false); setError(saveError(e, 'Could not save.')) })
  }
  function remove() {
    if (!method || busy) return
    setBusy(true)
    removePaymentMethod(store, method.id).then(onClose).catch((e) => { setBusy(false); setError(saveError(e, 'Could not remove it.')) })
  }
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="sm:max-w-md" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>{method ? 'Edit payment method' : 'New payment method'}</DialogTitle>
          <DialogDescription>A way of paying, and the account or card it takes the money from.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="space-y-1.5">
            <TipLabel htmlFor="pm-kind" help="payments.kind">Kind</TipLabel>
            <NativeSelect id="pm-kind" className="w-full" value={kind} onChange={(e) => pickKind(e.target.value as PaymentKind)}>
              {PAYMENT_KIND_INFO.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
            </NativeSelect>
            <p className="text-xs text-muted-foreground" data-testid="pm-kind-help">{info.help}</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pm-name">Name</Label>
            <Input id="pm-name" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder={`e.g. ${EXAMPLE[kind]}`} />
          </div>
          <div className="space-y-1.5">
            <TipLabel htmlFor="pm-account" help="payments.drawsOn">Draws on</TipLabel>
            <NativeSelect id="pm-account" className="w-full" value={accountId} disabled={used} onChange={(e) => setAccountId(e.target.value)}>
              {offered.length === 0 && <option value="">No account for this kind yet</option>}
              {offered.map((a) => <option key={a.id} value={a.id}>{a.name}{a.type === 'credit-card' ? ' (credit card)' : ''}</option>)}
            </NativeSelect>
            {used && <p className="text-xs text-muted-foreground" data-testid="pm-in-use">In use, so the account stays as it is. For another account, add another method.</p>}
            {!used && offered.length === 0 && <p className="text-xs text-muted-foreground">{kind === 'credit-card' ? 'Add the credit card on the Statement, under "Debts", first.' : 'Add the account on the Statement or under Household first.'}</p>}
            {reason && <p className="text-xs text-destructive" role="alert">{reason}</p>}
          </div>
          <div className="space-y-1.5">
            <TipLabel htmlFor="pm-owner" help="payments.owner">Who pays with it</TipLabel>
            <NativeSelect id="pm-owner" className="w-full" value={owner} onChange={(e) => setOwner(e.target.value)}>
              <option value="">Household</option>
              {adults.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </NativeSelect>
          </div>
        </div>
        {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
        <DialogFooter className="flex-row flex-wrap gap-2 sm:justify-between">
          <div>{method && <Button variant="ghost" size="sm" disabled={busy} onClick={remove}>{used ? 'Archive' : 'Delete'}</Button>}</div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
            <Button disabled={busy || !name.trim() || !accountId || reason != null} onClick={save}>Save</Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
