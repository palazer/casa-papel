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
import { NativeSelect } from '@/components/NativeSelect'
import { RemoveDialog } from '@/features/remove/RemoveDialog'
import { showSaveError } from '@/app/saveError'
import { lower, txt } from '@/i18n'

const T = txt.household.categories

const SECTIONS: Array<{ key: Section; title: string }> = [
  { key: 'income', title: txt.common.income },
  { key: 'expense', title: txt.common.expenses },
  { key: 'transfer', title: txt.common.transfers },
]

const byOrder = (a: Category, b: Category) => (a.order < b.order ? -1 : a.order > b.order ? 1 : 0)

/** Categories per section: rename, reorder, remove, add; and every row's category in one place (DESIGN.md §6). */
export function CategoriesCard({ household, tables, onError }: { household: Household; tables: Tables; onError: (m: string) => void }) {
  const store = useStore()
  const act = (fn: () => Promise<unknown>) => void fn().catch(showSaveError(onError, txt.common.actionFailed))
  return (
    <Island air title={T.categories} help="household.categories" description={T.namedGroupsInsideA}>
      <div className="space-y-5">
        {SECTIONS.map(({ key, title }) => {
          const categories = tables.categories.filter((c) => !c.deletedAt && c.section === key).sort(byOrder)
          const rows = sortRows(tables.rows.filter((r) => !r.deletedAt && r.section === key && !r.archivedMonth), tables.categories)
          const valid = (id: string | null) => (id && categories.some((c) => c.id === id) ? id : '')
          return (
            <section key={key} className="space-y-2" aria-label={T.categoriesOf(title)}>
              <h4 className={cn('text-[10px] font-semibold uppercase tracking-wider', SECTION_HUE[key].text)}>{title}</h4>
              {categories.length === 0 ? (
                <p className="text-muted-foreground">{T.noCategoriesYetRows}</p>
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
                          <NativeSelect aria-label={T.categoryFor(r.name)} value={valid(r.categoryId)} onChange={(e) => act(() => setRowCategory(store, r.id, e.target.value || null))}>
                            <option value="">{txt.common.noCategory}</option>
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
      <Input aria-label={T.nameOfTheCategory(c.name)} className="h-7 w-44" value={name} onChange={(e) => setName(e.target.value)} onBlur={commit} onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }} />
      <Button size="icon-xs" variant="ghost" aria-label={T.moveUp(c.name)} disabled={first} onClick={() => act(() => moveCategory(store, c.id, 'up'))}><ChevronUp /></Button>
      <Button size="icon-xs" variant="ghost" aria-label={T.moveDown(c.name)} disabled={last} onClick={() => act(() => moveCategory(store, c.id, 'down'))}><ChevronDown /></Button>
      <Button size="xs" variant="ghost" className="ml-auto" aria-label={T.remove(c.name)} onClick={() => setRemoving(true)}>{txt.common.removeMore}</Button>
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
      <Input aria-label={T.newCategoryOf(lower(title))} placeholder={T.newCategory} className="h-7 w-44" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') add() }} />
      <Button size="xs" variant="outline" disabled={!name.trim()} onClick={add}>{T.addCategory}</Button>
      {showUsual && (
        <span className="flex items-center gap-1">
          <Button size="xs" variant="outline" onClick={() => act(() => seedDefaultCategories(store))}>{T.addTheUsualCategories}</Button>
          <InfoTip help="household.usualCategories" />
        </span>
      )}
    </div>
  )
}
