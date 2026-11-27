import { useCallback, useId, useState, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { useStore } from '@/app/store'
import type { ExportFile } from '@/model'
import { changeLineText, checkFile, importMerge, importReplace, moreText, otherText, parseExportFile, type FileCheck, type FileChoice } from '@/store'
import { errorText } from '@/app/saveError'
import { deviceLocale, txt } from '@/i18n'

const T = txt.data.importPanel

type Pending = { file: ExportFile; name: string }

/** What one way of bringing the file in would change here: the amounts and balances, then how many other records. */
function ChoiceList({ title, choice, check }: { title: string; choice: FileChoice; check: FileCheck }) {
  const lines = choice.changes?.lines ?? []
  const more = moreText(choice.changes?.more ?? 0)
  const other = otherText(choice.other)
  return (
    <section aria-label={title} className="space-y-1">
      <p className="font-medium">{title}</p>
      {lines.length === 0 && !other ? (
        <p className="text-muted-foreground">{T.nothing}</p>
      ) : (
        <ul className="space-y-0.5 tabular-nums">
          {lines.map((l, i) => <li key={i}>{changeLineText(l, check.locale, { planEnd: check.planEnd })}</li>)}
          {more && <li className="text-muted-foreground">{more}</li>}
          {other && <li className="text-muted-foreground">{other}</li>}
        </ul>
      )}
    </section>
  )
}

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
  /** What each way of bringing the file in would change here, worked out once it is picked (rule T4, finding F9). */
  const [check, setCheck] = useState<FileCheck | null>(null)
  const open = useCallback(() => document.getElementById(inputId)?.click(), [inputId])

  async function onPickFile(ev: React.ChangeEvent<HTMLInputElement>) {
    const f = ev.target.files?.[0]
    if (!f) return
    try {
      const text = await f.text()
      const file = parseExportFile(JSON.parse(text))
      setPending({ file, name: f.name })
      setCheck(null)
      // on an empty device there is nothing to change: the file is simply restored
      if (!emptyDevice) setCheck(await checkFile(store, file))
    } catch (e) {
      onError(errorText(e, T.couldNotReadThat))
    } finally {
      ev.target.value = ''
    }
  }

  async function applyImport(mode: 'replace' | 'merge') {
    if (!pending) return
    try {
      if (mode === 'replace') {
        await importReplace(store, pending.file)
        onMessage(emptyDevice ? T.restored(pending.name) : T.replacedEverythingWith(pending.name))
      } else {
        const r = await importMerge(store, pending.file)
        onMessage(T.mergedRecordsUpdatedKept(pending.name, r.applied, r.kept, r.newEvents))
      }
      setPending(null)
      setCheck(null)
    } catch (e) {
      onError(errorText(e, T.importFailed))
    }
  }

  return (
    <>
      <input id={inputId} type="file" accept="application/json,.json" className="hidden" onChange={onPickFile} />
      {trigger ? trigger(open) : <Button size="sm" variant="outline" onClick={open}>{T.chooseAFile}</Button>}
      {pending && (
        <div className="basis-full space-y-2 rounded-md border p-3 text-xs">
          <p>
            <strong>{pending.name}</strong> {T.exportedLine(new Date(pending.file.exportedAt).toLocaleString(deviceLocale()), pending.file.tables.household[0]?.name, pending.file.events.length)}
          </p>
          {!emptyDevice && (check ? (
            <div className="grid gap-3 sm:grid-cols-2" data-testid="file-check">
              <ChoiceList title={T.mergingItWouldChange} choice={check.merge} check={check} />
              <ChoiceList title={T.replacingEverythingWouldChange} choice={check.replace} check={check} />
            </div>
          ) : (
            <p className="text-muted-foreground">{T.lookingAtWhatIt}</p>
          ))}
          <div className="flex flex-wrap gap-2">
            {emptyDevice ? (
              <Button size="xs" onClick={() => applyImport('replace')}>{T.restoreThisFile}</Button>
            ) : (
              <>
                <Button size="xs" onClick={() => applyImport('merge')}>{T.mergeIntoThisDevice}</Button>
                <Button size="xs" variant="destructive" onClick={() => applyImport('replace')}>{T.replaceEverythingHere}</Button>
              </>
            )}
            <Button size="xs" variant="ghost" onClick={() => { setPending(null); setCheck(null) }}>{txt.common.cancel}</Button>
          </div>
        </div>
      )}
    </>
  )
}
