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
import { PAYMENT_KIND_INFO, methodNote, paymentKindInfo, type Entity, type PaymentKind, type PaymentMethod, type Tables } from '@/model'
import { methodDetail } from '@/features/payments/methods'
import { addPaymentMethod, addPaymentMethods, methodInUse, removePaymentMethod, starterMethods, updatePaymentMethod, type PaymentMethodInput } from '@/store'

const byOrder = <T extends { order: string }>(a: T, b: T) => (a.order < b.order ? -1 : a.order > b.order ? 1 : 0)

/**
 * The household's ways of paying: shown while "Plan payments by day and method" is on. A method is a label (a name,
 * a kind, who pays, a note) and is tied to no account. One that is in use is archived, not deleted.
 */
export function PaymentMethodsCard({ tables, onError }: { tables: Tables; onError: (m: string) => void }) {
  const store = useStore()
  const [editing, setEditing] = useState<PaymentMethod | 'new' | null>(null)
  const all = tables.paymentMethods.filter((m) => !m.deletedAt).sort(byOrder)
  const methods = all.filter((m) => !m.archived)
  const archived = all.filter((m) => m.archived)
  const act = (fn: () => Promise<unknown>) => void fn().catch(showSaveError(onError, 'Action failed'))
  const line = (m: PaymentMethod) => {
    const detail = methodDetail(m, tables)
    return (
      <>
        <Chip tone="zinc">{paymentKindInfo(m.kind).label.toLowerCase()}</Chip>
        <span className={m.archived ? undefined : 'font-medium'}>{m.name}</span>
        {detail && <span className="text-muted-foreground">{detail}</span>}
      </>
    )
  }
  return (
    <Island
      air tone={HUES.transfer} title="Payment methods"
      description={'How an amount is paid: a direct debit, a standing order, a card, cash, someone who pays it for you. A method is a label of your own and changes no figure. An amount says which it is "Paid with", and the Payments page adds up what is paid with each.'}
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

/** The first methods, offered to a household that has none: tick, and they are added in one step. */
function StarterList({ tables, onError }: { tables: Tables; onError: (m: string) => void }) {
  const store = useStore()
  const offered = starterMethods(tables)
  const [off, setOff] = useState<Set<number>>(new Set())
  const chosen = offered.filter((_, i) => !off.has(i))
  return (
    <div className="space-y-2" data-testid="starter-methods">
      <p className="text-muted-foreground">No methods yet. Start with these and untick what you do not use; each can be renamed afterwards.</p>
      <div className="space-y-1.5">
        {offered.map((m, i) => (
          <Check
            key={`${m.kind}|${m.name}`} checked={!off.has(i)}
            label={<>{m.name} <span className="text-muted-foreground">· {[paymentKindInfo(m.kind).label.toLowerCase(), m.note].filter(Boolean).join(' · ')}</span></>}
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

export function PaymentMethodDialog({ method, tables, onClose, onSaved }: { method: PaymentMethod | null; tables: Tables; onClose: () => void; onSaved?: (m: PaymentMethod) => void }) {
  const store = useStore()
  const adults: Entity[] = tables.entities.filter((e) => !e.deletedAt && e.kind === 'adult' && (!e.archivedMonth || e.id === method?.ownerEntityId)).sort(byOrder)
  const used = method != null && methodInUse(tables, method.id)
  const [kind, setKind] = useState<PaymentKind>(method?.kind ?? 'direct-debit')
  const [name, setName] = useState(method?.name ?? '')
  // a method from before the note shows the name of the account it was tied to; saved, that is its note
  const [note, setNote] = useState(method ? methodNote(method, tables.accounts) : '')
  const [owner, setOwner] = useState(method?.ownerEntityId ?? '')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const info = paymentKindInfo(kind)

  function save() {
    if (busy) return
    setBusy(true)
    const input: PaymentMethodInput = { name: name.trim(), kind, ownerEntityId: owner || null, note: note.trim() }
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
          <DialogDescription>A way of paying, by a name of your own. It changes no figure.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="pm-name">Name</Label>
            <Input id="pm-name" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder={`e.g. ${info.label}`} />
          </div>
          <div className="space-y-1.5">
            <TipLabel htmlFor="pm-kind" help="payments.kind">Kind</TipLabel>
            <NativeSelect id="pm-kind" className="w-full" value={kind} onChange={(e) => setKind(e.target.value as PaymentKind)}>
              {PAYMENT_KIND_INFO.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
            </NativeSelect>
            <p className="text-xs text-muted-foreground" data-testid="pm-kind-help">{info.help}</p>
          </div>
          <div className="space-y-1.5">
            <TipLabel htmlFor="pm-owner" help="payments.owner">Who pays with it</TipLabel>
            <NativeSelect id="pm-owner" className="w-full" value={owner} onChange={(e) => setOwner(e.target.value)}>
              <option value="">Household</option>
              {adults.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </NativeSelect>
          </div>
          <div className="space-y-1.5">
            <TipLabel htmlFor="pm-note" help="payments.note">Note (optional)</TipLabel>
            <Input id="pm-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. main account" />
          </div>
        </div>
        {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
        <DialogFooter className="flex-row flex-wrap gap-2 sm:justify-between">
          <div>{method && <Button variant="ghost" size="sm" disabled={busy} onClick={remove}>{used ? 'Archive' : 'Delete'}</Button>}</div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
            <Button disabled={busy || !name.trim()} onClick={save}>Save</Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
