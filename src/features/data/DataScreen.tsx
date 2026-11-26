import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Chip } from '@/components/ui/chip'
import { Input } from '@/components/ui/input'
import { Island } from '@/components/ui/island'
import { GroupTabs } from '@/components/GroupTabs'
import { PageHeader } from '@/components/PageHeader'
import { isDemoMode, leaveDemoSandbox, openDemoSandbox, useStore } from '@/app/store'
import { loadDemo } from '@/demo/loadDemo'
import { exportFileName, exportSnapshot, wipeAll } from '@/store'
import { useSyncEngine, useSyncView } from '@/sync/useSync'
import { ImportPanel } from './ImportPanel'
import { InviteCard } from './InviteCard'
import { SyncCard } from './SyncCard'
import { errorText } from '@/app/saveError'
import { txt } from '@/i18n'

const T = txt.data.page

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
        if (e.usage != null) setUsage(T.kbUsed((e.usage / 1024).toFixed(0)))
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
      setMessage(ok ? T.thisBrowserWillKeep : T.theBrowserDeclinedInstall)
    } catch {
      setError(T.persistentStorageIsNot)
    }
  }

  async function doExport() {
    setError(null)
    try {
      const file = await exportSnapshot(store)
      const name = exportFileName(household?.[0]?.name ?? 'household')
      const blob = new Blob([JSON.stringify(file, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = name
      a.click()
      // not at once: Safari starts the download a moment after the click (later still when it asks first), and a link that is already gone cancels it
      setTimeout(() => URL.revokeObjectURL(url), 60_000)
      setMessage(T.exported(name))
    } catch (e) {
      // the export is the backup: a failure must not look like a button that did nothing
      setMessage(null)
      setError(T.theExportDidNot(errorText(e, T.unknownError)))
    }
  }

  async function doWipe() {
    setError(null)
    try {
      // signed in, a plain wipe would be undone by the next pull: leave the household first
      if (signedIn && sync) await sync.signOut({ wipe: true })
      else await wipeAll(store)
      setWipeWord('')
      setMessage(signedIn ? T.signedOutAndAll : T.allDataRemoved)
    } catch (e) {
      setError(errorText(e, T.couldNotWipe))
    }
  }

  async function doDeleteCloud() {
    if (!sync) return
    setError(null)
    try {
      await sync.deleteCloudCopy()
      setDeleteWord('')
      setMessage(T.theCloudCopyWas)
    } catch (e) {
      setError(errorText(e, T.couldNotDeleteThe))
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
      <PageHeader title={T.data} subline={h ? T.exportImportSync(h.name) : T.exportImportSyncPlain} />
      <GroupTabs />
      {message && (
        <Alert>
          <AlertTitle>{txt.common.done}</AlertTitle>
          <AlertDescription>{message}</AlertDescription>
        </Alert>
      )}
      {error && (
        <Alert variant="destructive">
          <AlertTitle>{T.somethingWentWrong}</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <Island
        air title={T.whereYourDataLives}
        description={sync
          ? T.inThisBrowserOn
          : T.inThisBrowserOnly}
      >
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Chip tone={persisted ? 'emerald' : persisted === false ? 'amber' : 'zinc'}>{persisted ? T.persistentStorageGranted : persisted === false ? T.storageMayBeEvicted : T.storageStatusUnknown}</Chip>
            {usage && <Chip tone="zinc">{usage}</Chip>}
            {isDemoMode() && <Chip tone="amber">{T.demoSandbox}</Chip>}
            {!persisted && (
              <Button size="xs" variant="outline" onClick={requestPersist}>{T.askTheBrowserTo}</Button>
            )}
          </div>
          <p className="text-muted-foreground">
            {T.historyEntriesSinceLast(eventCount, since, lastExport)}
          </p>
        </div>
      </Island>

      <SyncCard hasLocalData={!!h} onMessage={setMessage} onError={setError} />
      <InviteCard onError={setError} />

      <Island air title={T.export} help="data.export" description={T.oneJsonFileWith}>
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" onClick={doExport} disabled={!h}>{T.exportNow}</Button>
          {nag && <span role="status" className="text-amber-700 dark:text-amber-400">{T.youHaveUnsavedChanges}</span>}
        </div>
      </Island>

      <Island air title={T.import} description={T.restoreAnExportOr}>
        <div className="space-y-3">
          <ImportPanel onMessage={(m) => { setError(null); setMessage(m) }} onError={(m) => { setMessage(null); setError(m) }} />
        </div>
      </Island>

      <Island
        air title={T.demoHousehold}
        description={isDemoMode()
          ? T.youAreInThe
          : T.loadsAFictionalHousehold}
      >
        <div className="space-y-2">
          <div className="flex flex-wrap gap-2">
            {signedIn
              ? <Button size="sm" variant="outline" onClick={openDemoSandbox}>{T.openTheDemoSandbox}</Button>
              : <Button size="sm" variant={isDemoMode() ? 'default' : 'outline'} onClick={() => void loadDemo(store)}>{T.loadDemoHousehold}</Button>}
            {isDemoMode() && <Button size="sm" variant="outline" onClick={leaveDemoSandbox} title={T.backToYourOwn}>{T.leaveTheDemo}</Button>}
          </div>
          {signedIn && <p className="text-muted-foreground">{T.whileSignedInThe}</p>}
        </div>
      </Island>

      <Island
        air title={T.dangerZone} className="border-destructive/40"
        description={signedIn ? T.removeEverythingFromThis : T.removeEverythingPlain}
      >
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Input className="max-w-40" value={wipeWord} onChange={(e) => setWipeWord(e.target.value)} placeholder={T.wipe} aria-label={T.typeWipeToConfirm} />
            <Button size="sm" variant="destructive" disabled={wipeWord !== T.wipe} onClick={doWipe}>{signedIn ? T.signOutAndWipe : T.wipeThisDevice}</Button>
          </div>
          {signedIn && syncView.owner && (
            <div className="space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <Input className="max-w-40" value={deleteWord} onChange={(e) => setDeleteWord(e.target.value)} placeholder={T.delete} aria-label={T.typeDeleteToConfirm} />
                <Button size="sm" variant="destructive" disabled={deleteWord !== T.delete} onClick={doDeleteCloud}>{T.deleteTheCloudCopy}</Button>
              </div>
              <p className="text-muted-foreground">{T.removesTheHouseholdFrom}</p>
            </div>
          )}
        </div>
      </Island>
    </div>
  )
}
