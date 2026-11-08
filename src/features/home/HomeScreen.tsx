import { Button } from '@/components/ui/button'
import { Island } from '@/components/ui/island'
import { PageHeader } from '@/components/PageHeader'
import { useStore } from '@/app/store'
import { loadDemo } from '@/demo/loadDemo'
import { SetupWizard } from '@/features/setup/SetupWizard'

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
  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <PageHeader title="Casa Papel" subline="Your household budget as a month-by-month grid that knows what a household is." controls={false} />
      <Island
        air title="Welcome to Casa Papel"
        description={syncAvailable
          ? 'Everything stays on this device unless you sign in, which keeps an encrypted copy in the cloud that only your password opens.'
          : 'Everything stays on this device. Casa Papel has no server.'}
      >
        <div className="flex flex-wrap gap-2">
          {syncAvailable && <Button size="sm" onClick={onSignIn}>Sign in</Button>}
          {syncAvailable && <Button size="sm" variant="outline" onClick={onJoin}>I have an invite</Button>}
          <Button size="sm" variant="outline" onClick={() => void loadDemo(store)}>Load the demo household</Button>
          <Button size="sm" variant="outline" onClick={onOpenData}>Import a file</Button>
        </div>
      </Island>
      <SetupWizard onCreated={onCreated} />
    </div>
  )
}
