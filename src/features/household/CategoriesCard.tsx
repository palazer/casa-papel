import { useState } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Island } from '@/components/ui/island'
import { InfoTip } from '@/components/InfoTip'
import { cn } from '@/lib/utils'
import { SECTION_HUE } from '@/app/hues'
import { useStore } from '@/app/store'
import { sortRows } from '@/engine'
import type { Category, Household, Section, Tables } from '@/model'
import { addCategory, moveCategory, renameCategory, seedDefaultCategories, setRowCategory } from '@/store'
import { NativeSelect } from '@/features/grid/NativeSelect'
import { RemoveDialog } from '@/features/remove/RemoveDialog'

const SECTIONS: Array<{ key: Section; title: string }> = [
  { key: 'income', title: 'Income' },
  { key: 'expense', title: 'Expenses' },
  { key: 'transfer', title: 'Transfers' },
]

const byOrder = (a: Category, b: Category) => (a.order < b.order ? -1 : a.order > b.order ? 1 : 0)

/** Categories per section: rename, reorder, remove, add; and every row's category in one place (DESIGN.md §6). */
export function CategoriesCard({ household, tables, onError }: { household: Household; tables: Tables; onError: (m: string) => void }) {
  const store = useStore()
  const act = (fn: () => Promise<unknown>) => void fn().catch((e) => onError(e instanceof Error ? e.message : 'Action failed'))
  return (
    <Island air title="Categories" help="household.categories" description="Named groups inside a section. Rows sort by category in the grid and share a faint band; a label line names each group. Removing a category keeps its rows.">
      <div className="space-y-5">
        {SECTIONS.map(({ key, title }) => {
          const categories = tables.categories.filter((c) => !c.deletedAt && c.section === key).sort(byOrder)
          const rows = sortRows(tables.rows.filter((r) => !r.deletedAt && r.section === key && !r.archivedMonth), tables.categories)
          const valid = (id: string | null) => (id && categories.some((c) => c.id === id) ? id : '')
          return (
            <section key={key} className="space-y-2" aria-label={`${title} categories`}>
              <h4 className={cn('text-[10px] font-semibold uppercase tracking-wider', SECTION_HUE[key].text)}>{title}</h4>
              {categories.length === 0 ? (
                <p className="text-muted-foreground">No categories yet. Rows sit in the order you give them.</p>
              ) : (
                <ul className="divide-y divide-border/60">
                  {categories.map((c, i) => (
                    <CategoryRow key={c.id} category={c} first={i === 0} last={i === categories.length - 1} household={household} tables={tables} act={act} />
                  ))}
                </ul>
              )}
              <AddCategory section={key} title={title} showUsual={key === 'expense' && categories.length === 0} act={act} />
              {categories.length > 0 && rows.length > 0 && (
                <table className="w-full">
                  <tbody className="divide-y divide-border/60">
                    {rows.map((r) => (
                      <tr key={r.id}>
                        <td className="py-0.5 pr-2">{r.name}</td>
                        <td className="py-0.5 text-right">
                          <NativeSelect aria-label={`Category for ${r.name}`} value={valid(r.categoryId)} onChange={(e) => act(() => setRowCategory(store, r.id, e.target.value || null))}>
                            <option value="">No category</option>
                            {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                          </NativeSelect>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>
          )
        })}
      </div>
    </Island>
  )
}

function CategoryRow({ category: c, first, last, household, tables, act }: { category: Category; first: boolean; last: boolean; household: Household; tables: Tables; act: (fn: () => Promise<unknown>) => void }) {
  const store = useStore()
  const [name, setName] = useState(c.name)
  const [removing, setRemoving] = useState(false)
  const commit = () => {
    const n = name.trim()
    if (!n || n === c.name) setName(c.name)
    else act(() => renameCategory(store, c.id, n))
  }
  return (
    <li className="flex flex-wrap items-center gap-2 py-1">
      <Input aria-label={`Name of the category ${c.name}`} className="h-7 w-44" value={name} onChange={(e) => setName(e.target.value)} onBlur={commit} onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }} />
      <Button size="icon-xs" variant="ghost" aria-label={`Move ${c.name} up`} disabled={first} onClick={() => act(() => moveCategory(store, c.id, 'up'))}><ChevronUp /></Button>
      <Button size="icon-xs" variant="ghost" aria-label={`Move ${c.name} down`} disabled={last} onClick={() => act(() => moveCategory(store, c.id, 'down'))}><ChevronDown /></Button>
      <Button size="xs" variant="ghost" className="ml-auto" aria-label={`Remove ${c.name}`} onClick={() => setRemoving(true)}>Remove…</Button>
      {removing && <RemoveDialog target={{ kind: 'category', id: c.id }} tables={tables} household={household} onClose={() => setRemoving(false)} />}
    </li>
  )
}

function AddCategory({ section, title, showUsual, act }: { section: Section; title: string; showUsual: boolean; act: (fn: () => Promise<unknown>) => void }) {
  const store = useStore()
  const [name, setName] = useState('')
  const add = () => {
    if (!name.trim()) return
    act(async () => {
      await addCategory(store, { name, section })
      setName('')
    })
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Input aria-label={`New ${title.toLowerCase()} category`} placeholder="New category" className="h-7 w-44" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') add() }} />
      <Button size="xs" variant="outline" disabled={!name.trim()} onClick={add}>Add category</Button>
      {showUsual && (
        <span className="flex items-center gap-1">
          <Button size="xs" variant="outline" onClick={() => act(() => seedDefaultCategories(store))}>Add the usual categories</Button>
          <InfoTip help="household.usualCategories" />
        </span>
      )}
    </div>
  )
}
