import { useCallback, useEffect, useMemo, useState } from 'react'
import { ErrorBoundary } from '@/app/ErrorBoundary'
import { ScreenContext, isPhone, readScreen, rememberScreen, type Screen } from '@/app/screens'
import { createAppStore, isDemoMode, useStore } from '@/app/store'
import { StoreProvider } from '@/app/StoreProvider'
import { takeInviteFromUrl } from '@/app/url'
import { activeHousehold, defaultMonths, useTables } from '@/app/useEngine'
import { AppRail } from '@/components/AppRail'
import { BottomTabs } from '@/components/BottomTabs'
import { DataScreen } from '@/features/data/DataScreen'
import { GridScreen } from '@/features/grid/GridScreen'
import { HomeScreen } from '@/features/home/HomeScreen'
import { HouseholdScreen } from '@/features/household/HouseholdScreen'
import { MonthScreen } from '@/features/month/MonthScreen'
import { MovesScreen } from '@/features/moves/MovesScreen'
import { AccountDialog, type AccountStep } from '@/features/sync/AccountDialog'
import { planRecurringPosts } from '@/store'
import { SyncContext, createSyncEngine, useSyncEngine } from '@/sync/useSync'

export default function App() {
  const store = useMemo(() => createAppStore(), [])
  // the demo sandbox never syncs; builds without Supabase settings get no engine at all
  const sync = useMemo(() => createSyncEngine(store, !isDemoMode()), [store])
  return (
    <ErrorBoundary>
      <StoreProvider store={store}>
        <SyncContext.Provider value={sync}>
          <Shell />
        </SyncContext.Provider>
      </StoreProvider>
    </ErrorBoundary>
  )
}

/** The frame every screen sits in (DESIGN.md §2): the dark rail on the left (phones: the bottom tabs), the screen in a
 *  main that scrolls with the window. Each screen draws its own page header. */
function Shell() {
  const store = useStore()
  const tables = useTables()
  const household = activeHousehold(tables)
  const [screen, setScreen] = useState<Screen>(readScreen)
  const go = useCallback((s: Screen) => {
    setScreen(s)
    rememberScreen(s)
  }, [])
  const nav = useMemo(() => ({ screen, go }), [screen, go])
  const sync = useSyncEngine()
  const [inviteCode] = useState(() => takeInviteFromUrl())
  const [account, setAccount] = useState<AccountStep | null>(() => (inviteCode && sync ? 'join' : null))

  useEffect(() => {
    if (!sync) return
    void sync.start()
    return () => sync.stop()
  }, [sync])
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
    <ScreenContext.Provider value={nav}>
      <div className="flex min-h-dvh bg-background text-foreground">
        <AppRail householdName={household?.name} />
        <main className="min-w-0 flex-1 p-4 pb-24 text-sm md:p-6 md:pb-6">
          <div className="mx-auto max-w-[1800px]">
            {showHome ? (
              <HomeScreen onOpenData={() => go('data')} onCreated={() => go(isPhone() ? 'month' : 'grid')} syncAvailable={!!sync} onSignIn={() => setAccount('signin')} onJoin={() => setAccount('join')} />
            ) : screen === 'data' ? <DataScreen />
              : screen === 'month' ? <MonthScreen />
              : screen === 'moves' ? <MovesScreen />
              : screen === 'household' ? <HouseholdScreen />
              : <GridScreen />}
          </div>
        </main>
        <BottomTabs />
        {account && sync && <AccountDialog initial={account} inviteCode={inviteCode ?? undefined} hasLocalData={!!household} onClose={() => setAccount(null)} />}
      </div>
    </ScreenContext.Provider>
  )
}
