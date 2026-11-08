import { useState } from 'react'
import { Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useStore } from '@/app/store'
import type { Category, Section } from '@/model'
import { addRow } from '@/store'
import { NativeSelect } from './NativeSelect'

/** "Add row" at the foot of a section: a name, and a category when the section has any. */
export function AddRowInline({ section, categories, onError }: { section: Section; categories: Category[]; onError: (msg: string) => void }) {
  const store = useStore()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [categoryId, setCategoryId] = useState('')

  async function save() {
    const n = name.trim()
    if (!n) return
    try {
      await addRow(store, { name: n, section, categoryId: categoryId || null })
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
      {categories.length > 0 && (
        <NativeSelect aria-label={`Category for the new ${section} row`} className="h-7" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
          <option value="">No category</option>
          {[...categories].sort((a, b) => (a.order < b.order ? -1 : a.order > b.order ? 1 : 0)).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </NativeSelect>
      )}
      <Button size="sm" onClick={() => void save()}>Add</Button>
      <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
    </div>
  )
}
