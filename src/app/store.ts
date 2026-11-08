import { createContext, useContext } from 'react'
import { CasaDb, DEFAULT_DB_NAME, DEMO_DB_NAME, Store } from '@/store'

export function isDemoMode(): boolean {
  return new URLSearchParams(window.location.search).get('demo') === '1'
}

/** Open the demo sandbox in this tab: its own database, never synced. */
export function openDemoSandbox(): void {
  window.location.href = `${window.location.pathname}?demo=1`
}

/** Back to the real household. */
export function leaveDemoSandbox(): void {
  window.location.href = window.location.pathname
}

export function createAppStore(): Store {
  return new Store(new CasaDb(isDemoMode() ? DEMO_DB_NAME : DEFAULT_DB_NAME))
}

export const StoreContext = createContext<Store | null>(null)

export function useStore(): Store {
  const s = useContext(StoreContext)
  if (!s) throw new Error('useStore outside StoreProvider')
  return s
}
