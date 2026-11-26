import type { SyncView } from '@/sync/engine'
import { txt } from '@/i18n'

const T = txt.sync.status

/** One line for the Data screen and the header icon. */
export function describeSync(view: SyncView, now: number = Date.now()): string {
  switch (view.status) {
    case 'off': return T.notSignedIn
    case 'syncing': return T.syncing
    case 'offline': return T.offlineChangesWillSync
    case 'error': return T.couldNotSync(view.error)
    case 'stale': return T.updateTheAppTo
    case 'locked': return T.lockedThisDeviceCannot
    case 'choose': return T.waitingForYourDecision
    case 'idle': {
      if (view.pending) return T.changesWaitingToSync
      const last = Math.max(view.lastPushAt ?? 0, view.lastPullAt ?? 0)
      return last ? T.synced(ago(last, now)) : T.signedIn
    }
  }
}

export function ago(ts: number, now: number = Date.now()): string {
  const s = Math.max(0, Math.round((now - ts) / 1000))
  if (s < 45) return T.justNow
  const m = Math.round(s / 60)
  if (m < 60) return T.minAgo(m)
  const h = Math.round(m / 60)
  if (h < 24) return T.hAgo(h)
  return new Date(ts).toLocaleDateString()
}
