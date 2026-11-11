import { useMemo, useState } from 'react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { InfoTip } from '@/components/InfoTip'
import { MonthField } from '@/components/MonthField'
import { formatMonth } from '@/app/format'
import { useStore } from '@/app/store'
import { useSave } from '@/features/grid/RowDialogs'
import type { Household, MonthKey, Tables } from '@/model'
import { archiveMonthProblem, archiveThing, describeRemoval, removeThing, type Impact, type RemovalTarget } from '@/store'

interface Props {
  target: RemovalTarget
  tables: Tables
  household: Household
  onClose: () => void
  /** After the archive or delete went through (the dialog has closed). */
  onDone?: () => void
}

/**
 * The one way anything is removed (DESIGN.md §8): a row, an account, a virtual account, a person or thing, a schedule,
 * a goal or a category. It says what archiving from a month does and what deleting removes, lists what else changes
 * and what has to be resolved first, and offers only what is possible: a thing with amounts in a closed month can be
 * archived but not deleted. Everything it does is one undoable commit.
 */
export function RemoveDialog({ target, tables, household, onClose, onDone }: Props) {
  const store = useStore()
  const { locale } = household
  const [from, setFrom] = useState<MonthKey | null>(null)
  const { impact, failure } = useMemo(() => {
    try {
      return { impact: describeRemoval(tables, target, { locale, archiveFrom: from ?? undefined }), failure: null }
    } catch (e) {
      return { impact: null, failure: e instanceof Error ? e.message : 'Something went wrong.' }
    }
  }, [tables, target, locale, from])
  const { error, busy, save } = useSave(() => {
    onClose()
    onDone?.()
  })

  if (!impact) {
    return (
      <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
        <DialogContent className="sm:max-w-md" aria-describedby={undefined}>
          <DialogHeader><DialogTitle>Nothing to remove</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground" role="alert">{failure}</p>
          <DialogFooter><Button variant="outline" onClick={onClose}>Close</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    )
  }

  const month = impact.archiveFrom
  const problem = archiveMonthProblem(impact, month, locale)
  const kindWord = impact.kindLabel.toLowerCase()
  const showDelete = !impact.closedHistory

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{impact.kindLabel} "{impact.subject}"</DialogTitle>
          <DialogDescription>{impact.canArchive ? 'Archive it or delete it. You can undo this right after.' : 'You can undo this right after.'}</DialogDescription>
        </DialogHeader>
        <div className="space-y-5 text-sm">
          {impact.canArchive && (
            <section className="space-y-2" aria-labelledby="rm-archive">
              <h3 id="rm-archive" className="flex items-center gap-1 font-medium">Archive <InfoTip help="remove.archiveFrom" /></h3>
              <div className="space-y-1.5">
                <Label>Archive from</Label>
                <MonthField label="Archive from" value={month} onChange={setFrom} locale={locale} />
                {problem && <p className="text-xs text-destructive" role="alert">{problem}</p>}
              </div>
              <Lines items={impact.archiveChanges} />
              <p className="text-xs text-muted-foreground">Earlier months stay exactly as they are. Restore any time under Household.</p>
            </section>
          )}
          <section className="space-y-2" aria-labelledby="rm-delete">
            {impact.canArchive && <h3 id="rm-delete" className="font-medium">Delete</h3>}
            {impact.closedHistory ? (
              <p className="text-muted-foreground">"{impact.subject}" has amounts in closed months ({impact.closedHistory}), so it cannot be deleted. Archive it instead.</p>
            ) : (
              <>
                <p className="text-xs text-muted-foreground">Deleting removes</p>
                <Lines items={impact.loses.length ? impact.loses : [`Only the ${kindWord} itself`]} />
                {impact.changes.length > 0 && (
                  <>
                    <p className="text-xs text-muted-foreground">Also changes</p>
                    <Lines items={impact.changes} />
                  </>
                )}
                {impact.note && <p className="text-xs text-muted-foreground">{impact.note}</p>}
                {impact.blockers.length > 0 && (
                  <Alert variant="destructive">
                    <AlertTitle>Resolve these first</AlertTitle>
                    <AlertDescription>
                      <ul className="list-disc space-y-1 pl-4">
                        {impact.blockers.map((b) => (
                          <li key={b.text}>{b.text}. <span className="text-muted-foreground">{b.where}</span></li>
                        ))}
                      </ul>
                    </AlertDescription>
                  </Alert>
                )}
              </>
            )}
          </section>
          {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          {impact.canArchive && (
            <Button variant={showDelete ? 'outline' : 'default'} disabled={busy || !!problem} onClick={() => void save(() => archiveThing(store, target, month))}>
              Archive from {formatMonth(month, locale)}
            </Button>
          )}
          {showDelete && (
            <Button variant="destructive" disabled={busy || !impact.canDelete} onClick={() => void save(() => removeThing(store, target))}>Delete</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function Lines({ items }: { items: Impact['loses'] }) {
  if (items.length === 0) return null
  return (
    <ul className="list-disc space-y-0.5 pl-5">
      {items.map((t) => <li key={t}>{t}</li>)}
    </ul>
  )
}
