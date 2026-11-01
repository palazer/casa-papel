import { useSyncExternalStore } from 'react'
import type { Store } from '@/store'

/** Re-renders after each commit, undo or redo (for undo/redo button state). */
export function useStoreVersion(store: Store): number {
  return useSyncExternalStore(
    (cb) => store.subscribe(cb),
    () => store.getVersion(),
    () => store.getVersion(),
  )
}
