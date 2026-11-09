import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { InfoTip, TipLabel } from '@/components/InfoTip'
import { useStore } from '@/app/store'
import type { Row, Tables } from '@/model'
import { addCategory, seedDefaultCategories, setRowCategory } from '@/store'
import { NativeSelect } from '@/components/NativeSelect'
import { useSave } from './RowDialogs'

const NEW = '__new__'

/** Which category a row sorts under: one of its section's, a new one, or none. */
export function RowCategoryDialog({ row, tables, onClose }: { row: Row; tables: Tables; onClose: () => void }) {
  const store = useStore()
  const categories = tables.categories.filter((c) => !c.deletedAt && c.section === row.section).sort((a, b) => (a.order < b.order ? -1 : a.order > b.order ? 1 : 0))
  const [choice, setChoice] = useState(() => (row.categoryId && categories.some((c) => c.id === row.categoryId) ? row.categoryId : ''))
  const [newName, setNewName] = useState('')
  const [seedError, setSeedError] = useState<string | null>(null)
  const { error, busy, save } = useSave(onClose)

  const submit = () => void save(async () => {
    if (choice === NEW) await addCategory(store, { name: newName, section: row.section, rowIds: [row.id] })
    else await setRowCategory(store, row.id, choice || null)
  })

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Category</DialogTitle>
          <DialogDescription>Row "{row.name}"</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <TipLabel htmlFor="row-category" help="row.category">Category</TipLabel>
            <NativeSelect id="row-category" className="w-full" value={choice} onChange={(e) => setChoice(e.target.value)}>
              <option value="">No category</option>
              {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              <option value={NEW}>New category…</option>
            </NativeSelect>
          </div>
          {choice === NEW && (
            <div className="space-y-1.5">
              <Label htmlFor="row-category-new">Name of the new category</Label>
              <Input id="row-category-new" autoFocus value={newName} onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') submit() }} />
            </div>
          )}
          {row.section === 'expense' && categories.length === 0 && (
            <div className="flex items-center gap-1">
              <Button size="xs" variant="outline" disabled={busy} onClick={() => { setSeedError(null); seedDefaultCategories(store).catch((e) => setSeedError(e instanceof Error ? e.message : 'Could not add them.')) }}>
                Add the usual categories
              </Button>
              <InfoTip help="household.usualCategories" />
            </div>
          )}
          {(error || seedError) && <p className="text-sm text-destructive" role="alert">{error ?? seedError}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={submit} disabled={busy || (choice === NEW && !newName.trim())}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
