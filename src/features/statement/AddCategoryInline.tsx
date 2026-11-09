import { useState, type KeyboardEvent } from 'react'
import { Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useStore } from '@/app/store'
import type { Section } from '@/model'
import { addCategory } from '@/store'

/** "Add category" at the foot of Income and Expenses: a name, then the category appears as a line, ready for its first row. */
export function AddCategoryInline({ section, onError }: { section: Section; onError: (msg: string) => void }) {
  const store = useStore()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')

  const reset = () => {
    setName('')
    setOpen(false)
  }
  async function save() {
    const n = name.trim()
    if (!n) return
    try {
      await addCategory(store, { name: n, section })
      reset()
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Could not add the category')
    }
  }

  if (!open) {
    return (
      <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={() => setOpen(true)} aria-label={`Add ${section} category`}>
        <Plus /> Add category
      </Button>
    )
  }
  const keys = (e: KeyboardEvent<HTMLInputElement>) => { if (e.key === 'Enter') void save(); if (e.key === 'Escape') reset() }
  return (
    <div className="flex flex-wrap items-center gap-1">
      <Input autoFocus className="h-7 w-44" placeholder="Category name" value={name} aria-label={`New ${section} category name`} onChange={(e) => setName(e.target.value)} onKeyDown={keys} />
      <Button size="sm" onClick={() => void save()}>Add</Button>
      <Button size="sm" variant="ghost" onClick={reset}>Cancel</Button>
    </div>
  )
}
