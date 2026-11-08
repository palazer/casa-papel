import { Cloud, CloudAlert, CloudOff, CloudUpload, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useSyncView } from '@/sync/useSync'
import { describeSync } from './syncText'

/** Small cloud in the header: what sync is doing, one click to the Data screen. Hidden when sync is not in use. */
export function SyncIndicator({ onOpen }: { onOpen: () => void }) {
  const view = useSyncView()
  if (!view || view.status === 'off') return null
  const label = describeSync(view)
  const Icon =
    view.status === 'syncing' ? RefreshCw
    : view.status === 'offline' ? CloudOff
    : view.status === 'idle' ? (view.pending ? CloudUpload : Cloud)
    : CloudAlert
  const tone = view.status === 'idle' || view.status === 'syncing' ? 'text-muted-foreground' : view.status === 'offline' ? 'text-partial' : 'text-expense'
  return (
    <Button variant="ghost" size="icon" aria-label={`Sync: ${label}`} title={label} onClick={onOpen}>
      <Icon className={`${tone} ${view.status === 'syncing' ? 'animate-spin' : ''}`} />
    </Button>
  )
}
