import { createContext, useContext, useSyncExternalStore } from 'react'
import type { Store } from '@/store'
import { syncConfig } from './config'
import { SyncEngine, type SyncView } from './engine'
import { SupabaseRemote } from './supabaseRemote'

/** The engine for this store, or null when this build has no sync configured or the store is the demo sandbox. */
export function createSyncEngine(store: Store, enabled: boolean): SyncEngine | null {
  const cfg = syncConfig()
  if (!cfg || !enabled) return null
  return new SyncEngine(store, new SupabaseRemote(cfg))
}

export const SyncContext = createContext<SyncEngine | null>(null)

export function useSyncEngine(): SyncEngine | null {
  return useContext(SyncContext)
}

const OFF: SyncView = { status: 'off', email: null, owner: false, pending: false, lastPullAt: null, lastPushAt: null, error: null, failingSince: null, choice: null }
const noop = () => () => {}

/** Re-renders on every engine state change. Returns null when sync is not available at all. */
export function useSyncView(): SyncView | null {
  const engine = useSyncEngine()
  const view = useSyncExternalStore(
    engine ? (cb) => engine.subscribe(cb) : noop,
    () => (engine ? engine.getView() : OFF),
    () => OFF,
  )
  return engine ? view : null
}
