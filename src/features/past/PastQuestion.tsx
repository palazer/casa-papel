import { useEffect, useState, type ReactNode } from 'react'
import { formatMonth } from '@/app/format'
import { useStore } from '@/app/store'
import { InfoTip } from '@/components/InfoTip'
import { Button } from '@/components/ui/button'
import { DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogLayers, DialogOver, DialogTitle } from '@/components/ui/dialog'
import { listMonths } from '@/features/grid/followingText'
import { changeLineText, moreText, pastGuard, type PastAnswer, type PastQuestion } from '@/store'

interface Asked {
  question: PastQuestion
  resolve: (answer: PastAnswer) => void
}

/**
 * Rule T4 on screen (DESIGN.md §8): installs the store's question before a change alters a month that is over, and
 * shows it over whatever dialog the save came from. One question at a time, in the order they were asked. The save
 * waits until it is answered: "Cancel" leaves the dialog as it was, "Save anyway" saves, "Only from <Month> on" saves
 * the version that leaves the past alone where the save has one.
 */
export function PastQuestionHost({ children }: { children: ReactNode }) {
  const store = useStore()
  const [queue, setQueue] = useState<Asked[]>([])
  useEffect(() => {
    store.setGuard(pastGuard(store, (question) => new Promise<PastAnswer>((resolve) => setQueue((q) => [...q, { question, resolve }]))))
    return () => store.setGuard(null)
  }, [store])
  const current = queue[0] ?? null
  const answer = (a: PastAnswer) => {
    current?.resolve(a)
    setQueue((q) => q.slice(1))
  }
  return <DialogLayers over={current ? <PastQuestionDialog question={current.question} onAnswer={answer} /> : null}>{children}</DialogLayers>
}

function PastQuestionDialog({ question, onAnswer }: { question: PastQuestion; onAnswer: (a: PastAnswer) => void }) {
  const { changes, fromNow, locale } = question
  const more = moreText(changes.more)
  return (
    <DialogOver open onOpenChange={(open) => { if (!open) onAnswer('cancel') }}>
      <DialogContent showCloseButton={false} className="sm:max-w-md" data-testid="past-question">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-1.5">This changes months that are over <InfoTip help="past.question" /></DialogTitle>
          <DialogDescription>{listMonths(changes.months, locale)} {changes.months.length === 1 ? 'changes' : 'change'}:</DialogDescription>
        </DialogHeader>
        <ul className="space-y-1 text-sm tabular-nums" aria-label="What changes">
          {changes.lines.map((line, i) => <li key={i}>{changeLineText(line, locale)}</li>)}
          {more && <li className="text-muted-foreground">{more}</li>}
        </ul>
        <DialogFooter>
          <Button variant="outline" onClick={() => onAnswer('cancel')}>Cancel</Button>
          {fromNow && <Button variant="outline" onClick={() => onAnswer('from-now')}>Only from {formatMonth(fromNow, locale, 'long')} on</Button>}
          <Button onClick={() => onAnswer('save')}>Save anyway</Button>
        </DialogFooter>
      </DialogContent>
    </DialogOver>
  )
}
