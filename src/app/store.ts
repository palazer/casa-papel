import { createContext, useContext } from 'react'
import { CasaDb, DEFAULT_DB_NAME, DEMO_DB_NAME, Store } from '@/store'

export function isDemoMode(): boolean {
  return new URLSearchParams(window.location.search).get('demo') === '1'
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
