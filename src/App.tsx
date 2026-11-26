import { useCallback, useEffect, useMemo, useState } from 'react'
import { ErrorBoundary } from '@/app/ErrorBoundary'
import { ScreenContext, isUtility, readScreen, rememberScreen, shownScreen, type Screen } from '@/app/screens'
import { createAppStore, isDemoMode, useStore } from '@/app/store'
import { StoreProvider } from '@/app/StoreProvider'
import { takeInviteFromUrl } from '@/app/url'
import { useAutoRates } from '@/app/useAutoRates'
import { activeHousehold, defaultMonths, useTables } from '@/app/useEngine'
import { AppRail } from '@/components/AppRail'
import { BottomTabs } from '@/components/BottomTabs'
import { DataScreen } from '@/features/data/DataScreen'
import { GridScreen } from '@/features/grid/GridScreen'
import { GuideScreen } from '@/features/guide/GuideScreen'
import { HomeScreen } from '@/features/home/HomeScreen'
import { HouseholdScreen } from '@/features/household/HouseholdScreen'
import { MainAccountQuestion } from '@/features/main/MainAccountQuestion'
import { PastQuestionHost } from '@/features/past/PastQuestion'
import { PaymentsScreen } from '@/features/payments/PaymentsScreen'
import { StatementScreen } from '@/features/statement/StatementScreen'
import { TrendsScreen } from '@/features/trends/TrendsScreen'
import { AccountDialog, type AccountStep } from '@/features/sync/AccountDialog'
import { planCards, planHousekeeping, planMainAccount } from '@/store'
import { SyncContext, createSyncEngine, useSyncEngine } from '@/sync/useSync'

export default function App() {
  const store = useMemo(() => createAppStore(), [])
  // the demo sandbox never syncs; builds without Supabase settings get no engine at all
  const sync = useMemo(() => createSyncEngine(store, !isDemoMode()), [store])
  return (
    <ErrorBoundary>
      <StoreProvider store={store}>
        {/* a change that alters a month that is over asks first, over whatever dialog it was saved from (rule T4) */}
        <PastQuestionHost>
          <SyncContext.Provider value={sync}>
            <Shell />
          </SyncContext.Provider>
        </PastQuestionHost>
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
  const [asked, setAsked] = useState<Screen>(readScreen)
  const go = useCallback((s: Screen, hash?: string) => {
    setAsked(s)
    rememberScreen(s, hash)
  }, [])
  /** "Plan payments by day and method": the household's switch for the Payments page (DESIGN.md §12). */
  const payments = household?.payments ?? false
  // a page whose switch is off (turned off on another device, or bookmarked) gives way to the Statement
  const screen = tables === undefined ? asked : shownScreen(asked, { payments })
  const nav = useMemo(() => ({ screen, go, payments }), [screen, go, payments])
  const sync = useSyncEngine()
  const [inviteCode] = useState(() => takeInviteFromUrl())
  const [account, setAccount] = useState<AccountStep | null>(() => (inviteCode && sync ? 'join' : null))
  /** The account dialog's closing words, shown on the welcome screen until a household appears. */
  const [notice, setNotice] = useState<string | null>(null)
  const openAccount = useCallback((step: AccountStep) => {
    setNotice(null)
    setAccount(step)
  }, [])

  /** The first exchange with the server is over (or there is none to wait for): what the app fetches by itself may run. */
  const [synced, setSynced] = useState(!sync)
  useEffect(() => {
    if (!sync) return
    let here = true
    void sync.firstSync.then(() => { if (here) setSynced(true) })
    void sync.start().catch(() => undefined)
    return () => {
      here = false
      sync.stop()
    }
  }, [sync])
  // housekeeping at start: logged edits older than a year go; a failure here costs nothing and the next start tries again
  useEffect(() => {
    void store.pruneEvents().catch(() => undefined)
  }, [store])
  const months = useMemo(() => (household && tables ? defaultMonths(household, tables) : []), [household, tables])

  // what the app does by itself with the data in front of it: the schedules land in the current month and later
  useEffect(() => {
    if (!tables || !household || months.length === 0) return
    const mutations = planHousekeeping(tables)
    if (mutations.length) void store.commitSystem(mutations)
  }, [tables, household, months, store])
  // one main account (rule B9): a household from before the rule is put right, after the first sync, so it is the
  // household as the other devices left it; the question which is the main account follows from its mark
  useEffect(() => {
    if (!tables || !household || !synced) return
    const mutations = planMainAccount(tables)
    if (mutations.length) void store.commitSystem(mutations)
  }, [tables, household, synced, store])
  // a card is a debt and nothing else (schema 23): cards from before are put right, after the first sync for the same reason
  useEffect(() => {
    if (!tables || !household || !synced) return
    const mutations = planCards(tables)
    if (mutations.length) void store.commitSystem(mutations)
  }, [tables, household, synced, store])
  // the official rates of the currencies in use are kept up to date, once a day, after the first sync
  useAutoRates(store, tables, synced)

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
  // Data and the Guide read without a household; every other screen needs one
  const showHome = !household && !isUtility(screen)

  return (
    <ScreenContext.Provider value={nav}>
      <div className="flex min-h-dvh bg-background text-foreground">
        <AppRail householdName={household?.name} />
        <main className="min-w-0 flex-1 p-4 pb-24 text-sm md:p-6 md:pb-6">
          <div className="mx-auto max-w-[1800px]">
            {showHome ? (
              <HomeScreen onOpenData={() => go('data')} onCreated={() => go('statement')} syncAvailable={!!sync} onSignIn={() => openAccount('signin')} onJoin={() => openAccount('join')} notice={notice} />
            ) : screen === 'data' ? <DataScreen />
              : screen === 'guide' ? <GuideScreen />
              : screen === 'grid' ? <GridScreen />
              : screen === 'payments' ? <PaymentsScreen />
              : screen === 'trends' ? <TrendsScreen />
              : screen === 'household' ? <HouseholdScreen />
              : <StatementScreen />}
          </div>
        </main>
        <BottomTabs />
        {/* once, after a household from before rule B9 was put right: which of its current accounts is the main one */}
        {household?.askMainAccount === true && tables && <MainAccountQuestion key={household.id} tables={tables} household={household} />}
        {account && sync && <AccountDialog initial={account} inviteCode={inviteCode ?? undefined} hasLocalData={!!household} onClose={(message) => { setAccount(null); setNotice(message ?? null) }} />}
      </div>
    </ScreenContext.Provider>
  )
}
