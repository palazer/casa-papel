import type { ReactNode } from 'react'
import type { Store } from '@/store'
import { StoreContext } from './store'

export function StoreProvider({ store, children }: { store: Store; children: ReactNode }) {
  return <StoreContext.Provider value={store}>{store ? children : null}</StoreContext.Provider>
}
