import { Button } from '@/components/ui/button'
import { Island } from '@/components/ui/island'
import { PageHeader } from '@/components/PageHeader'
import { openDemoSandbox, useStore } from '@/app/store'
import { loadDemo } from '@/demo/loadDemo'
import { SetupWizard } from '@/features/setup/SetupWizard'
import { describeSync } from '@/features/sync/syncText'
import { useSyncView } from '@/sync/useSync'

interface Props {
  onOpenData: () => void
  onCreated: () => void
  /** This build can sync; show the account buttons. */
  syncAvailable?: boolean
  onSignIn?: () => void
  onJoin?: () => void
}

/** The first screen when no household exists yet: a welcome, the shortcuts, the setup wizard. */
export function HomeScreen({ onOpenData, onCreated, syncAvailable = false, onSignIn, onJoin }: Props) {
  const store = useStore()
  const view = useSyncView()
  const signedIn = !!view && view.status !== 'off'
  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <PageHeader title="Casa Papel" subline="Your household budget as a month-by-month grid that knows what a household is." controls={false} />
      <Island
        air title="Welcome to Casa Papel"
        description={syncAvailable
          ? 'Everything stays on this device unless you sign in, which keeps an encrypted copy in the cloud that only your password opens.'
          : 'Everything stays on this device. Casa Papel has no server.'}
      >
        <div className="space-y-3">
          {signedIn && view && (
            <p>
              Signed in as <strong>{view.email}</strong>, but this device holds no household yet ({describeSync(view).toLowerCase()}).
              If your household already lives in another browser or on another device, sign in there and it will be uploaded; this device then picks it up by itself.
              Otherwise start one below. To look around first, open the demo in its sandbox; it never syncs.
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            {syncAvailable && !signedIn && <Button size="sm" onClick={onSignIn}>Sign in</Button>}
            {syncAvailable && !signedIn && <Button size="sm" variant="outline" onClick={onJoin}>I have an invite</Button>}
            {signedIn
              ? <Button size="sm" variant="outline" onClick={openDemoSandbox}>Try the demo sandbox</Button>
              : <Button size="sm" variant="outline" onClick={() => void loadDemo(store)}>Load the demo household</Button>}
            <Button size="sm" variant="outline" onClick={onOpenData}>{signedIn ? 'Open Data' : 'Import a file'}</Button>
          </div>
        </div>
      </Island>
      <SetupWizard onCreated={onCreated} />
    </div>
  )
}
