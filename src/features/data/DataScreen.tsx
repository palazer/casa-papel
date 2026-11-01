import { useEffect, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Separator } from '@/components/ui/separator'
import { isDemoMode, useStore } from '@/app/store'
import { loadDemo } from '@/demo/loadDemo'
import type { ExportFile } from '@/model'
import { exportFileName, exportSnapshot, importMerge, importReplace, parseExportFile, wipeAll } from '@/store'

type Pending = { file: ExportFile; name: string }

export function DataScreen() {
  const store = useStore()
  const household = useLiveQuery(() => store.db.household.toArray(), [store])
  const meta = useLiveQuery(() => store.db.meta.get('meta'), [store])
  const eventCount = useLiveQuery(() => store.db.events.count(), [store])
  const [pending, setPending] = useState<Pending | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [wipeWord, setWipeWord] = useState('')
  const [persisted, setPersisted] = useState<boolean | null>(null)
  const [usage, setUsage] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
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

  async function onPickFile(ev: React.ChangeEvent<HTMLInputElement>) {
    setError(null)
    setMessage(null)
    const f = ev.target.files?.[0]
    if (!f) return
    try {
      const text = await f.text()
      const file = parseExportFile(JSON.parse(text))
      setPending({ file, name: f.name })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not read that file.')
    } finally {
      ev.target.value = ''
    }
  }

  async function applyImport(mode: 'replace' | 'merge') {
    if (!pending) return
    try {
      if (mode === 'replace') {
        await importReplace(store, pending.file)
        setMessage(`Replaced everything with ${pending.name}.`)
      } else {
        const r = await importMerge(store, pending.file)
        setMessage(`Merged ${pending.name}: ${r.applied} records updated, ${r.kept} kept, ${r.newEvents} new history entries.`)
      }
      setPending(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Import failed.')
    }
  }

  async function doWipe() {
    await wipeAll(store)
    setWipeWord('')
    setMessage('All data removed from this browser.')
  }

  const h = household?.[0]
  const since = meta?.eventsSinceExport ?? 0
  const lastExport = meta?.lastExportAt ? new Date(meta.lastExportAt).toLocaleString() : 'never'
  const nag = since > 50 || (meta?.lastExportAt != null && openedAt - meta.lastExportAt > 30 * 86_400_000) || (meta?.lastExportAt == null && since > 0)

  return (
    <div className="space-y-6 max-w-2xl">
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

      <Card>
        <CardHeader>
          <CardTitle>Where your data lives</CardTitle>
          <CardDescription>
            In this browser only, on this device. Casa Papel has no server. Export a file now and then so a cleared browser cannot take your history with it.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={persisted ? 'secondary' : 'outline'}>{persisted ? 'Persistent storage granted' : persisted === false ? 'Storage may be evicted' : 'Storage status unknown'}</Badge>
            {usage && <Badge variant="outline">{usage}</Badge>}
            {isDemoMode() && <Badge>Demo sandbox</Badge>}
            {!persisted && (
              <Button size="sm" variant="outline" onClick={requestPersist}>Ask the browser to keep my data</Button>
            )}
          </div>
          <p className="text-muted-foreground">
            History entries: {eventCount ?? 0} · since last export: {since} · last export: {lastExport}
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Export</CardTitle>
          <CardDescription>One JSON file with every table and the full change history. Keep it anywhere you like.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-2">
          <Button onClick={doExport} disabled={!h}>Export now</Button>
          {nag && <span className="text-sm text-amber-700 dark:text-amber-400">You have unsaved changes since your last export.</span>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Import</CardTitle>
          <CardDescription>Restore an export, or merge a copy of the same household from another device.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <input ref={fileRef} type="file" accept="application/json,.json" className="hidden" onChange={onPickFile} />
          <Button variant="outline" onClick={() => fileRef.current?.click()}>Choose a file…</Button>
          {pending && (
            <div className="rounded-md border p-3 text-sm space-y-2">
              <p>
                <strong>{pending.name}</strong> · exported {new Date(pending.file.exportedAt).toLocaleString()} · {pending.file.tables.household[0]?.name ?? 'unnamed household'} · {pending.file.events.length} history entries
              </p>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" onClick={() => applyImport('merge')}>Merge into this device</Button>
                <Button size="sm" variant="destructive" onClick={() => applyImport('replace')}>Replace everything here</Button>
                <Button size="sm" variant="ghost" onClick={() => setPending(null)}>Cancel</Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Demo household</CardTitle>
          <CardDescription>
            {isDemoMode()
              ? 'You are in the demo sandbox. Loading the demo never touches your real data.'
              : 'Loads a fictional household into this store, replacing what is here. Prefer the sandbox at ?demo=1.'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant={isDemoMode() ? 'default' : 'outline'} onClick={() => void loadDemo(store)}>Load demo household</Button>
        </CardContent>
      </Card>

      <Separator />

      <Card className="border-destructive/40">
        <CardHeader>
          <CardTitle>Danger zone</CardTitle>
          <CardDescription>Remove everything from this browser. Export first. Type WIPE to enable the button.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-2">
          <Input className="max-w-40" value={wipeWord} onChange={(e) => setWipeWord(e.target.value)} placeholder="WIPE" aria-label="Type WIPE to confirm" />
          <Button variant="destructive" disabled={wipeWord !== 'WIPE'} onClick={doWipe}>Wipe this device</Button>
        </CardContent>
      </Card>
    </div>
  )
}
