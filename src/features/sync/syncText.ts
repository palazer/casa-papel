import type { SyncView } from '@/sync/engine'

/** One line for the Data screen and the header icon. */
export function describeSync(view: SyncView, now: number = Date.now()): string {
  switch (view.status) {
    case 'off': return 'Not signed in'
    case 'syncing': return 'Syncing…'
    case 'offline': return 'Offline. Changes will sync when you are back.'
    case 'error': return `Could not sync: ${view.error ?? 'unknown error'}`
    case 'stale': return 'Update the app to sync: the cloud copy comes from a newer version.'
    case 'locked': return 'Locked: this device cannot open the cloud copy.'
    case 'choose': return 'Waiting for your decision about which data to keep.'
    case 'idle': {
      if (view.pending) return 'Changes waiting to sync'
      const last = Math.max(view.lastPushAt ?? 0, view.lastPullAt ?? 0)
      return last ? `Synced ${ago(last, now)}` : 'Signed in'
    }
  }
}

export function ago(ts: number, now: number = Date.now()): string {
  const s = Math.max(0, Math.round((now - ts) / 1000))
  if (s < 45) return 'just now'
  const m = Math.round(s / 60)
  if (m < 60) return `${m} min ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h} h ago`
  return new Date(ts).toLocaleDateString()
}
