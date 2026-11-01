import { useEffect, useMemo, useState } from 'react'
import { Redo2, Undo2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ErrorBoundary } from '@/app/ErrorBoundary'
import { createAppStore, isDemoMode, useStore } from '@/app/store'
import { StoreProvider } from '@/app/StoreProvider'
import { activeHousehold, useTables } from '@/app/useEngine'
import { useStoreVersion } from '@/app/useStoreVersion'
import { DataScreen } from '@/features/data/DataScreen'
import { GridScreen } from '@/features/grid/GridScreen'
import { HomeScreen } from '@/features/home/HomeScreen'
import { MonthScreen } from '@/features/month/MonthScreen'

type Screen = 'grid' | 'month' | 'data'

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

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return
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
          <nav className="ml-auto flex items-center gap-1">
            <Button variant="ghost" size="icon" aria-label="Undo" disabled={!store.canUndo} onClick={() => void store.undo()}><Undo2 /></Button>
            <Button variant="ghost" size="icon" aria-label="Redo" disabled={!store.canRedo} onClick={() => void store.redo()}><Redo2 /></Button>
            <span className="mx-1 h-5 w-px bg-border" />
            <Button variant={screen === 'grid' && !showHome ? 'secondary' : 'ghost'} size="sm" onClick={() => setScreen('grid')}>Grid</Button>
            <Button variant={screen === 'month' && !showHome ? 'secondary' : 'ghost'} size="sm" onClick={() => setScreen('month')}>Month</Button>
            <Button variant={screen === 'data' ? 'secondary' : 'ghost'} size="sm" onClick={() => setScreen('data')}>Data</Button>
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-[1800px] px-4 py-4">
        {showHome ? (
          <HomeScreen onOpenData={() => setScreen('data')} onCreated={() => setScreen('grid')} />
        ) : screen === 'data' ? (
          <DataScreen />
        ) : screen === 'month' ? (
          <MonthScreen />
        ) : (
          <GridScreen />
        )}
      </main>
    </div>
  )
}
