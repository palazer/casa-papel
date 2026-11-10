import { useState, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { Island } from '@/components/ui/island'
import { PageHeader } from '@/components/PageHeader'
import { useScreen } from '@/app/screens'
import { isDemoMode, leaveDemoSandbox, openDemoSandbox, useStore } from '@/app/store'
import { loadDemo } from '@/demo/loadDemo'
import { ImportPanel } from '@/features/data/ImportPanel'
import { SetupStart } from '@/features/setup/SetupStart'
import { describeSync } from '@/features/sync/syncText'
import { useSyncView } from '@/sync/useSync'

interface Props {
  onOpenData: () => void
  onCreated: () => void
  /** This build can sync; show the account paths. */
  syncAvailable?: boolean
  onSignIn?: () => void
  onJoin?: () => void
  /** What the account dialog said when it closed (signed in, household created…); shown as a status line. */
  notice?: string | null
}

/**
 * The first screen when no household exists yet (DESIGN.md §2 "Welcome"): three ways to start, each explained in one
 * sentence, quiet links beneath, and the first setup screen once a path is chosen. In the demo sandbox the first path
 * loads the demo. Signed in with nothing on the device, that screen shows at once with a note that it uploads; a locked or
 * undecided cloud copy sends the user to Data instead, so no second household is started under it.
 */
export function HomeScreen({ onOpenData, onCreated, syncAvailable = false, onSignIn, onJoin, notice = null }: Props) {
  const store = useStore()
  const { go } = useScreen()
  const view = useSyncView()
  const [mode, setMode] = useState<'choose' | 'setup'>('choose')
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const signedIn = !!view && view.status !== 'off'
  const blocked = !!view && (view.status === 'locked' || view.status === 'choose')
  const demo = isDemoMode()
  // the dialog's words only make sense while the account is still signed in; after "Sign out and wipe" they go
  const status = message ?? (signedIn ? notice : null)
  const showSetup = !blocked && (signedIn || mode === 'setup')

  const links = (
    <div className="flex flex-wrap items-center gap-2">
      {demo
        ? <Button size="xs" variant="ghost" onClick={leaveDemoSandbox}>Leave the demo</Button>
        : <Button size="xs" variant="ghost" onClick={openDemoSandbox}>Look at the demo first</Button>}
      <Button size="xs" variant="ghost" onClick={() => go('guide')}>How it works</Button>
      <ImportPanel emptyDevice trigger={(open) => <Button size="xs" variant="ghost" onClick={open}>Import a file</Button>} onMessage={setMessage} onError={setError} />
    </div>
  )

  const description = demo
    ? 'You are in the demo sandbox: its own store, never synced. Leave it any time to get back to your own household.'
    : syncAvailable
      ? 'Everything stays on this device unless you sign in, which keeps an encrypted copy in the cloud that only your password opens.'
      : 'Everything stays on this device. Casa Papel has no server.'

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <PageHeader title="Casa Papel" subline="Your household budget as a month-by-month grid that knows what a household is." controls={false}>
        {status && <p role="status" className="basis-full text-muted-foreground">{status}</p>}
        {error && <p role="alert" className="basis-full text-destructive">{error}</p>}
      </PageHeader>

      {blocked && view ? (
        <Island air title="Welcome to Casa Papel" description={describeSync(view)}>
          <ul className="divide-y divide-border/60">
            <Path label="Open Data" primary onClick={onOpenData}>
              Unlock the cloud copy, or decide which data to keep, under Data. This device starts no new household until then.
            </Path>
          </ul>
        </Island>
      ) : showSetup ? (
        <>
          <SetupStart
            onCreated={onCreated}
            onBack={signedIn ? undefined : () => setMode('choose')}
            notice={signedIn && view ? <>Signed in as <strong>{view.email}</strong>{view.status !== 'idle' && view.status !== 'syncing' ? ` (${describeSync(view).toLowerCase()})` : ''}. This household is uploaded to your account when you finish.</> : undefined}
          />
          {signedIn && links}
        </>
      ) : (
        <Island air title="Welcome to Casa Papel" description={description}>
          <ul className="divide-y divide-border/60">
            {demo && (
              <Path label="Load the demo household" primary onClick={() => void loadDemo(store)}>
                A made-up household with two adults, a child, a dog and a car, so you can click around. Nothing here touches your own data.
              </Path>
            )}
            <Path label="Start on this device" primary={!demo} onClick={() => setMode('setup')}>
              {syncAvailable
                ? 'Set up your household here. Everything stays in this browser; you can sign in later from Data to keep an encrypted copy in the cloud.'
                : 'Set up your household here. Everything stays in this browser.'}
            </Path>
            {syncAvailable && !demo && (
              <>
                <Path label="Sign in" onClick={() => onSignIn?.()}>
                  Use your household's email and password. A household already in your account appears here; otherwise you set one up next and it is uploaded when you finish.
                </Path>
                <Path label="I have an invite" onClick={() => onJoin?.()}>
                  Someone invited you. Pick your own email and password; your household gets its own cloud copy.
                </Path>
              </>
            )}
          </ul>
          <div className="mt-3">{links}</div>
        </Island>
      )}
    </div>
  )
}

/** One way to start: the button, then the one sentence that says what it does. Lime on the recommended path only. */
function Path({ label, primary = false, onClick, children }: { label: string; primary?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 first:pt-0 last:pb-0">
      <Button size="sm" variant={primary ? 'default' : 'outline'} className="min-w-44" onClick={onClick}>{label}</Button>
      <span className="min-w-0 flex-1 basis-60 text-xs text-muted-foreground">{children}</span>
    </li>
  )
}
