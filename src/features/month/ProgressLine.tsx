import { Switch } from '@/components/ui/switch'
import { InfoTip } from '@/components/InfoTip'

/** The Month view's header line: how much is done and what is still open, with the switch that hides done lines. */
export function ProgressLine({ text, hideDone, onHideDone }: { text: string; hideDone: boolean; onHideDone: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between gap-3 text-xs">
      <p role="status" className="flex min-w-0 items-center gap-1 text-muted-foreground">
        <span>{text}</span>
        <InfoTip help="month.progress" />
      </p>
      <span className="flex shrink-0 items-center gap-2">
        <Switch size="sm" checked={hideDone} onCheckedChange={(v) => onHideDone(v)} aria-label="Hide done" />
        <span aria-hidden>Hide done</span>
      </span>
    </div>
  )
}
