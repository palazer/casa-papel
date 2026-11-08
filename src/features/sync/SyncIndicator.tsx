import { Cloud, CloudAlert, CloudOff, CloudUpload, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useScreen } from '@/app/screens'
import { useSyncView } from '@/sync/useSync'
import { describeSync } from './syncText'

/** Small cloud at the end of every page header's toolbar: what sync is doing, one click to the Data screen. Hidden when sync is not in use. */
export function SyncIndicator({ onOpen, className }: { onOpen?: () => void; className?: string }) {
  const view = useSyncView()
  const { go } = useScreen()
  if (!view || view.status === 'off') return null
  const label = describeSync(view)
  const Icon =
    view.status === 'syncing' ? RefreshCw
    : view.status === 'offline' ? CloudOff
    : view.status === 'idle' ? (view.pending ? CloudUpload : Cloud)
    : CloudAlert
  const tone = view.status === 'idle' || view.status === 'syncing' ? 'text-muted-foreground' : view.status === 'offline' ? 'text-partial' : 'text-expense'
  return (
    <Button variant="ghost" size="icon-xs" className={className} aria-label={`Sync: ${label}`} title={label} onClick={onOpen ?? (() => go('data'))}>
      <Icon className={cn(tone, view.status === 'syncing' && 'animate-spin')} />
    </Button>
  )
}
