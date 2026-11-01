import { useEffect, useMemo, useState } from 'react'
import { Redo2, Undo2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ErrorBoundary } from '@/app/ErrorBoundary'
import { createAppStore, isDemoMode, useStore } from '@/app/store'
import { StoreProvider } from '@/app/StoreProvider'
import { activeHousehold, defaultMonths, useTables } from '@/app/useEngine'
import { useStoreVersion } from '@/app/useStoreVersion'
import { DataScreen } from '@/features/data/DataScreen'
import { GridScreen } from '@/features/grid/GridScreen'
import { NativeSelect } from '@/features/grid/NativeSelect'
import { HomeScreen } from '@/features/home/HomeScreen'
import { HouseholdScreen } from '@/features/household/HouseholdScreen'
import { MonthScreen } from '@/features/month/MonthScreen'
import { MovesScreen } from '@/features/moves/MovesScreen'
import { planRecurringPosts } from '@/store'

type Screen = 'grid' | 'month' | 'moves' | 'household' | 'data'
const SCREENS: Array<{ key: Screen; label: string }> = [
  { key: 'grid', label: 'Grid' }, { key: 'month', label: 'Month' }, { key: 'moves', label: 'Moves' },
  { key: 'household', label: 'Household' }, { key: 'data', label: 'Data' },
]

export default function App() {
  const store = useMemo(() => createAppStore(), [])
  return (
    <ErrorBoundary>
      <StoreProvider store={store}>
        <Shell />
      </StoreProvider>
    </ErrorBoundary>
  )
}

function Shell() {
  const store = useStore()
  const tables = useTables()
  const household = activeHousehold(tables)
  const [screen, setScreen] = useState<Screen>(() => (window.innerWidth < 768 ? 'month' : 'grid'))
  useStoreVersion(store)
  const months = useMemo(() => (household && tables ? defaultMonths(household, tables) : []), [household, tables])

  // keep open months in step with the recurring register
  useEffect(() => {
    if (!tables || !household || months.length === 0) return
    const mutations = planRecurringPosts(tables, months)
    if (mutations.length) void store.commitSystem(mutations)
  }, [tables, household, months, store])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable)) return
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        void (e.shiftKey ? store.redo() : store.undo())
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [store])

  if (tables === undefined) return null
  const showHome = !household && screen !== 'data'

  return (
    <div className="min-h-dvh bg-background text-foreground">
      <header className="border-b">
        <div className="mx-auto flex max-w-[1800px] items-center gap-3 px-4 py-2">
          <img src={`${import.meta.env.BASE_URL}favicon.svg`} alt="" className="size-7 rounded-md" />
          <span className="max-w-[40vw] truncate font-semibold tracking-tight sm:max-w-none">{household?.name ?? 'Casa Papel'}</span>
          {isDemoMode() && <Badge variant="secondary">demo</Badge>}
          <nav className="ml-auto flex items-center gap-1" aria-label="Screens">
            <Button variant="ghost" size="icon" aria-label="Undo" disabled={!store.canUndo} onClick={() => void store.undo()}><Undo2 /></Button>
            <Button variant="ghost" size="icon" aria-label="Redo" disabled={!store.canRedo} onClick={() => void store.redo()}><Redo2 /></Button>
            <span className="mx-1 h-5 w-px bg-border" />
            <div className="hidden gap-1 md:flex">
              {SCREENS.map((s) => (
                <Button key={s.key} variant={screen === s.key && !(showHome && s.key !== 'data') ? 'secondary' : 'ghost'} size="sm" onClick={() => setScreen(s.key)}>{s.label}</Button>
              ))}
            </div>
            <NativeSelect aria-label="Screen" className="md:hidden" value={screen} onChange={(e) => setScreen(e.target.value as Screen)}>
              {SCREENS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
            </NativeSelect>
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-[1800px] px-4 py-4">
        {showHome ? (
          <HomeScreen onOpenData={() => setScreen('data')} onCreated={() => setScreen(window.innerWidth < 768 ? 'month' : 'grid')} />
        ) : screen === 'data' ? <DataScreen />
          : screen === 'month' ? <MonthScreen />
          : screen === 'moves' ? <MovesScreen />
          : screen === 'household' ? <HouseholdScreen />
          : <GridScreen />}
      </main>
    </div>
  )
}
