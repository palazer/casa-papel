import { useCallback, useId, useState, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { useStore } from '@/app/store'
import type { ExportFile } from '@/model'
import { importMerge, importReplace, parseExportFile } from '@/store'

type Pending = { file: ExportFile; name: string }

/**
 * Pick an export file and bring it in. On the Data screen the file can be merged or can replace everything here; on an
 * empty device (`emptyDevice`, the welcome screen) there is nothing to merge with, so one button restores it. `trigger`
 * renders the control that opens the picker; the default is the Data screen's "Choose a file…". The pending panel is
 * `basis-full`, so inside a flex row of links it wraps onto a line of its own.
 */
export function ImportPanel({ trigger, onMessage, onError, emptyDevice = false }: {
  trigger?: (open: () => void) => ReactNode
  onMessage: (m: string) => void
  onError: (m: string) => void
  emptyDevice?: boolean
}) {
  const store = useStore()
  const inputId = useId()
  const [pending, setPending] = useState<Pending | null>(null)
  const open = useCallback(() => document.getElementById(inputId)?.click(), [inputId])

  async function onPickFile(ev: React.ChangeEvent<HTMLInputElement>) {
    const f = ev.target.files?.[0]
    if (!f) return
    try {
      const text = await f.text()
      const file = parseExportFile(JSON.parse(text))
      setPending({ file, name: f.name })
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Could not read that file.')
    } finally {
      ev.target.value = ''
    }
  }

  async function applyImport(mode: 'replace' | 'merge') {
    if (!pending) return
    try {
      if (mode === 'replace') {
        await importReplace(store, pending.file)
        onMessage(emptyDevice ? `Restored ${pending.name}.` : `Replaced everything with ${pending.name}.`)
      } else {
        const r = await importMerge(store, pending.file)
        onMessage(`Merged ${pending.name}: ${r.applied} records updated, ${r.kept} kept, ${r.newEvents} new history entries.`)
      }
      setPending(null)
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Import failed.')
    }
  }

  return (
    <>
      <input id={inputId} type="file" accept="application/json,.json" className="hidden" onChange={onPickFile} />
      {trigger ? trigger(open) : <Button size="sm" variant="outline" onClick={open}>Choose a file…</Button>}
      {pending && (
        <div className="basis-full space-y-2 rounded-md border p-3 text-xs">
          <p>
            <strong>{pending.name}</strong> · exported {new Date(pending.file.exportedAt).toLocaleString()} · {pending.file.tables.household[0]?.name ?? 'unnamed household'} · {pending.file.events.length} history entries
          </p>
          <div className="flex flex-wrap gap-2">
            {emptyDevice ? (
              <Button size="xs" onClick={() => applyImport('replace')}>Restore this file</Button>
            ) : (
              <>
                <Button size="xs" onClick={() => applyImport('merge')}>Merge into this device</Button>
                <Button size="xs" variant="destructive" onClick={() => applyImport('replace')}>Replace everything here</Button>
              </>
            )}
            <Button size="xs" variant="ghost" onClick={() => setPending(null)}>Cancel</Button>
          </div>
        </div>
      )}
    </>
  )
}
