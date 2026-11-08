import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Chip } from '@/components/ui/chip'
import { Input } from '@/components/ui/input'
import { Island } from '@/components/ui/island'
import { PageHeader } from '@/components/PageHeader'
import { isDemoMode, leaveDemoSandbox, openDemoSandbox, useStore } from '@/app/store'
import { loadDemo } from '@/demo/loadDemo'
import { exportFileName, exportSnapshot, wipeAll } from '@/store'
import { useSyncEngine, useSyncView } from '@/sync/useSync'
import { ImportPanel } from './ImportPanel'
import { InviteCard } from './InviteCard'
import { SyncCard } from './SyncCard'

/** Where the data lives and how it moves: storage status, cloud sync, export, import, the demo, the danger zone. */
export function DataScreen() {
  const store = useStore()
  const household = useLiveQuery(() => store.db.household.toArray(), [store])
  const meta = useLiveQuery(() => store.db.meta.get('meta'), [store])
  const eventCount = useLiveQuery(() => store.db.events.count(), [store])
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [wipeWord, setWipeWord] = useState('')
  const [deleteWord, setDeleteWord] = useState('')
  const sync = useSyncEngine()
  const syncView = useSyncView()
  const signedIn = !!syncView && syncView.status !== 'off'
  const [persisted, setPersisted] = useState<boolean | null>(null)
  const [usage, setUsage] = useState<string | null>(null)
  const [openedAt] = useState(() => Date.now())

  async function refreshStorage() {
    try {
      if (navigator.storage?.persisted) setPersisted(await navigator.storage.persisted())
      if (navigator.storage?.estimate) {
        const e = await navigator.storage.estimate()
        if (e.usage != null) setUsage(`${(e.usage / 1024).toFixed(0)} KB used`)
      }
    } catch {
      /* storage API unavailable */
    }
  }

  useEffect(() => {
    void refreshStorage()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function requestPersist() {
    try {
      const ok = await navigator.storage.persist()
      setPersisted(ok)
      setMessage(ok ? 'This browser will keep your data unless you delete it yourself.' : 'The browser declined. Install the app to improve the odds.')
    } catch {
      setError('Persistent storage is not available in this browser.')
    }
  }

  async function doExport() {
    setError(null)
    const file = await exportSnapshot(store)
    const name = exportFileName(household?.[0]?.name ?? 'household')
    const blob = new Blob([JSON.stringify(file, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = name
    a.click()
    URL.revokeObjectURL(url)
    setMessage(`Exported ${name}`)
  }

  async function doWipe() {
    setError(null)
    try {
      // signed in, a plain wipe would be undone by the next pull: leave the household first
      if (signedIn && sync) await sync.signOut({ wipe: true })
      else await wipeAll(store)
      setWipeWord('')
      setMessage(signedIn ? 'Signed out and all data removed from this browser. The cloud copy is untouched.' : 'All data removed from this browser.')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not wipe.')
    }
  }

  async function doDeleteCloud() {
    if (!sync) return
    setError(null)
    try {
      await sync.deleteCloudCopy()
      setDeleteWord('')
      setMessage('The cloud copy was deleted and this device signed out. Your data stays here.')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not delete the cloud copy.')
    }
  }

  const h = household?.[0]
  const since = meta?.eventsSinceExport ?? 0
  const lastExport = meta?.lastExportAt ? new Date(meta.lastExportAt).toLocaleString() : 'never'
  const exportNag = since > 50 || (meta?.lastExportAt != null && openedAt - meta.lastExportAt > 30 * 86_400_000) || (meta?.lastExportAt == null && since > 0)
  // a healthy cloud copy counts as a backup; the reminder returns after a week of failed pushes
  const syncHealthy = signedIn && (syncView.failingSince == null || openedAt - syncView.failingSince < 7 * 86_400_000)
  const nag = exportNag && !syncHealthy

  return (
    <div className="mx-auto max-w-2xl space-y-4 text-xs">
      <PageHeader title="Data" subline={h ? `${h.name} · export, import, sync` : 'Export, import, sync'} />
      {message && (
        <Alert>
          <AlertTitle>Done</AlertTitle>
          <AlertDescription>{message}</AlertDescription>
        </Alert>
      )}
      {error && (
        <Alert variant="destructive">
          <AlertTitle>Something went wrong</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <Island
        air title="Where your data lives"
        description={sync
          ? 'In this browser, on this device. Sign in below to keep an encrypted copy in the cloud as well; only your password opens it. Export a file now and then so a cleared browser cannot take your history with it.'
          : 'In this browser only, on this device. Casa Papel has no server. Export a file now and then so a cleared browser cannot take your history with it.'}
      >
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Chip tone={persisted ? 'emerald' : persisted === false ? 'amber' : 'zinc'}>{persisted ? 'persistent storage granted' : persisted === false ? 'storage may be evicted' : 'storage status unknown'}</Chip>
            {usage && <Chip tone="zinc">{usage}</Chip>}
            {isDemoMode() && <Chip tone="amber">demo sandbox</Chip>}
            {!persisted && (
              <Button size="xs" variant="outline" onClick={requestPersist}>Ask the browser to keep my data</Button>
            )}
          </div>
          <p className="text-muted-foreground">
            History entries: {eventCount ?? 0} · since last export: {since} · last export: {lastExport}
          </p>
        </div>
      </Island>

      <SyncCard hasLocalData={!!h} onMessage={setMessage} onError={setError} />
      <InviteCard onError={setError} />

      <Island air title="Export" description="One JSON file with every table and the full change history. Keep it anywhere you like.">
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" onClick={doExport} disabled={!h}>Export now</Button>
          {nag && <span role="status" className="text-amber-700 dark:text-amber-400">You have unsaved changes since your last export.</span>}
        </div>
      </Island>

      <Island air title="Import" description="Restore an export, or merge a copy of the same household from another device.">
        <div className="space-y-3">
          <ImportPanel onMessage={(m) => { setError(null); setMessage(m) }} onError={(m) => { setMessage(null); setError(m) }} />
        </div>
      </Island>

      <Island
        air title="Demo household"
        description={isDemoMode()
          ? 'You are in the demo sandbox. Loading the demo never touches your real data.'
          : 'Loads a fictional household into this store, replacing what is here. Prefer the sandbox at ?demo=1.'}
      >
        <div className="space-y-2">
          <div className="flex flex-wrap gap-2">
            {signedIn
              ? <Button size="sm" variant="outline" onClick={openDemoSandbox}>Open the demo sandbox</Button>
              : <Button size="sm" variant={isDemoMode() ? 'default' : 'outline'} onClick={() => void loadDemo(store)}>Load demo household</Button>}
            {isDemoMode() && <Button size="sm" variant="outline" onClick={leaveDemoSandbox} title="Back to your own household">Leave the demo</Button>}
          </div>
          {signedIn && <p className="text-muted-foreground">While signed in, the demo opens in its own sandbox so it never lands in your household's cloud copy.</p>}
        </div>
      </Island>

      <Island
        air title="Danger zone" className="border-destructive/40"
        description={signedIn ? 'Remove everything from this browser and stop syncing here. The cloud copy and other devices are untouched. Type WIPE to enable the button.' : 'Remove everything from this browser. Export first. Type WIPE to enable the button.'}
      >
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Input className="max-w-40" value={wipeWord} onChange={(e) => setWipeWord(e.target.value)} placeholder="WIPE" aria-label="Type WIPE to confirm" />
            <Button size="sm" variant="destructive" disabled={wipeWord !== 'WIPE'} onClick={doWipe}>{signedIn ? 'Sign out and wipe this device' : 'Wipe this device'}</Button>
          </div>
          {signedIn && syncView.owner && (
            <div className="space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <Input className="max-w-40" value={deleteWord} onChange={(e) => setDeleteWord(e.target.value)} placeholder="DELETE" aria-label="Type DELETE to confirm" />
                <Button size="sm" variant="destructive" disabled={deleteWord !== 'DELETE'} onClick={doDeleteCloud}>Delete the cloud copy</Button>
              </div>
              <p className="text-muted-foreground">Removes the household from the server for every device. Each device keeps what it has locally. Type DELETE to enable the button.</p>
            </div>
          )}
        </div>
      </Island>
    </div>
  )
}
