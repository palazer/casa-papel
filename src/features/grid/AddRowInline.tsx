import { useState, type KeyboardEvent } from 'react'
import { Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useStore } from '@/app/store'
import type { Category, Household, Section, Tables } from '@/model'
import { addRow, addTransferRow, type TransferRowKind } from '@/store'
import { NativeSelect } from './NativeSelect'

/** Each choice under Transfers, with the sentence shown beneath the selects. */
const KINDS: Record<TransferRowKind, { label: string; text: string }> = {
  plain: { label: 'Moves money between your accounts', text: 'An amount you type each month. It is not spending, so it never counts as an expense.' },
  'to-savings': { label: 'Goes into a savings account', text: 'An amount you type; that savings balance under Balances rises with it.' },
  'to-investment': { label: 'Deposits into an investment account', text: 'The account\'s value, deposited total and return under Balances follow this row.' },
  'pool-allocation': { label: 'Fills a pool account', text: 'For a pool account that lost its row: the amount lands in the pool account every month.' },
  'pocket-money': { label: 'Pocket money for an adult', text: 'A fixed amount you type for that adult. It comes off the month\'s leftover, and in the proportional split it is theirs alone.' },
}

/** "Add row" at the foot of a section: a name, a category when the section has any, and under Transfers what the row does. */
export function AddRowInline({ section, categories, tables, household, onError }: { section: Section; categories: Category[]; tables: Tables; household: Household; onError: (msg: string) => void }) {
  const store = useStore()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [categoryId, setCategoryId] = useState('')
  const [kind, setKind] = useState<TransferRowKind>('plain')
  const [targetId, setTargetId] = useState('')

  const live = <T extends { deletedAt?: number | null }>(xs: T[]) => xs.filter((x) => !x.deletedAt)
  const accountsOf = (type: 'savings' | 'investment') => live(tables.accounts).filter((a) => a.type === type)
  // a pool account whose row was deleted can be filled again
  const orphanPools = live(tables.pools).filter((p) => !p.allocationRowId || !tables.rows.some((r) => r.id === p.allocationRowId && !r.deletedAt))
  const adults = live(tables.entities).filter((e) => e.kind === 'adult' && !e.archivedMonth)
  // with the savings plug the app fills one "to savings" row itself; a second would stay at zero
  const plugTaken = household.closingRule === 'savings-plug' && tables.rows.some((r) => !r.deletedAt && r.kind === 'to-savings')
  const kinds = (Object.keys(KINDS) as TransferRowKind[]).filter((k) => (k !== 'to-savings' || !plugTaken) && (k !== 'pool-allocation' || orphanPools.length > 0))
  const targets: Array<{ id: string; name: string }> | null =
    kind === 'to-savings' ? accountsOf('savings') : kind === 'to-investment' ? accountsOf('investment') : kind === 'pool-allocation' ? orphanPools : kind === 'pocket-money' ? adults : null
  const targetLabel = kind === 'pool-allocation' ? 'Pool account' : kind === 'pocket-money' ? 'Adult' : 'Account'
  const missing = targets && targets.length === 0
    ? kind === 'to-savings' ? 'Add a savings account under Household first.' : kind === 'to-investment' ? 'Add an investment account under Household first.' : 'Add an adult under Household first.'
    : null
  const chosen = targets ? (targets.find((t) => t.id === targetId) ?? targets[0]) : undefined

  async function save() {
    const n = name.trim()
    if (!n || missing) return
    try {
      if (section === 'transfer') {
        const id = chosen?.id ?? null
        await addTransferRow(store, {
          name: n, categoryId: categoryId || null, kind,
          accountId: kind === 'to-savings' || kind === 'to-investment' ? id : null,
          poolId: kind === 'pool-allocation' ? id : null,
          adultId: kind === 'pocket-money' ? id : null,
        })
      } else {
        await addRow(store, { name: n, section, categoryId: categoryId || null })
      }
      setName('')
      setKind('plain')
      setTargetId('')
      setOpen(false)
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Could not add row')
    }
  }

  if (!open) {
    return (
      <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={() => setOpen(true)} aria-label={`Add ${section} row`}>
        <Plus /> Add row
      </Button>
    )
  }
  const keys = (e: KeyboardEvent<HTMLInputElement>) => { if (e.key === 'Enter') void save(); if (e.key === 'Escape') setOpen(false) }
  return (
    <div className="flex flex-wrap items-center gap-1">
      <Input autoFocus className="h-7 w-44" placeholder="Row name" value={name} aria-label={`New ${section} row name`} onChange={(e) => setName(e.target.value)} onKeyDown={keys} />
      {categories.length > 0 && (
        <NativeSelect aria-label={`Category for the new ${section} row`} className="h-7" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
          <option value="">No category</option>
          {[...categories].sort((a, b) => (a.order < b.order ? -1 : a.order > b.order ? 1 : 0)).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </NativeSelect>
      )}
      {section === 'transfer' && (
        <NativeSelect aria-label="What the new transfer row does" className="h-7" value={kind} onChange={(e) => { setKind(e.target.value as TransferRowKind); setTargetId('') }}>
          {kinds.map((k) => <option key={k} value={k}>{KINDS[k].label}</option>)}
        </NativeSelect>
      )}
      {section === 'transfer' && targets && targets.length > 0 && (
        <NativeSelect aria-label={`${targetLabel} for the new transfer row`} className="h-7" value={chosen?.id ?? ''} onChange={(e) => setTargetId(e.target.value)}>
          {targets.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </NativeSelect>
      )}
      <Button size="sm" onClick={() => void save()} disabled={!!missing}>Add</Button>
      <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
      {section === 'transfer' && <p className="basis-full text-xs text-muted-foreground">{missing ?? KINDS[kind].text}</p>}
    </div>
  )
}
