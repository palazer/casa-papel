import { useState } from 'react'
import type { Store } from '@/store'
import { useStoreVersion } from './useStoreVersion'

/**
 * What was just done, for `UndoNotice`: said right after the change went through, and gone with the next change of
 * the store, whatever makes it. `notice` is the sentence while it stands, `say` sets it, `clear` dismisses it.
 */
export function useUndoNotice(store: Store): { notice: string | null; say: (text: string) => void; clear: () => void } {
  const version = useStoreVersion(store)
  const [said, setSaid] = useState<{ text: string; version: number } | null>(null)
  return {
    notice: said && said.version === version ? said.text : null,
    // the store's version right after the change: the message goes with the next one
    say: (text) => setSaid({ text, version: store.getVersion() }),
    clear: () => setSaid(null),
  }
}
