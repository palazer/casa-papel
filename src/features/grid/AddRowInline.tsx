import { useState } from 'react'
import { Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useStore } from '@/app/store'
import type { Section } from '@/model'
import { addRow } from '@/store'

export function AddRowInline({ section, onError }: { section: Section; onError: (msg: string) => void }) {
  const store = useStore()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')

  async function save() {
    const n = name.trim()
    if (!n) return
    try {
      await addRow(store, { name: n, section })
      setName('')
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
  return (
    <div className="flex items-center gap-1">
      <Input
        autoFocus className="h-7 w-44" placeholder="Row name" value={name} aria-label={`New ${section} row name`}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') void save(); if (e.key === 'Escape') setOpen(false) }}
      />
      <Button size="sm" onClick={() => void save()}>Add</Button>
      <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
    </div>
  )
}
