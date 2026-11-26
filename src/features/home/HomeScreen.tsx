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
import { lower, txt } from '@/i18n'
import { sentence } from '@/lib/sentence'

const T = txt.home.welcome

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
        ? <Button size="xs" variant="ghost" onClick={leaveDemoSandbox}>{T.leaveTheDemo}</Button>
        : <Button size="xs" variant="ghost" onClick={openDemoSandbox}>{T.lookAtTheDemo}</Button>}
      <Button size="xs" variant="ghost" onClick={() => go('guide')}>{T.howItWorks}</Button>
      <ImportPanel emptyDevice trigger={(open) => <Button size="xs" variant="ghost" onClick={open}>{T.importAFile}</Button>} onMessage={setMessage} onError={setError} />
    </div>
  )

  const description = demo
    ? T.youAreInThe
    : syncAvailable
      ? T.everythingStaysOnThis
      : T.everythingStaysOnThis2

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <PageHeader title={txt.common.appName} subline={T.yourHouseholdBudgetAs} controls={false}>
        {status && <p role="status" className="basis-full text-muted-foreground">{status}</p>}
        {error && <p role="alert" className="basis-full text-destructive">{error}</p>}
      </PageHeader>

      {blocked && view ? (
        <Island air title={T.welcomeToCasaPapel} description={describeSync(view)}>
          <ul className="divide-y divide-border/60">
            <Path label={T.openData} primary onClick={onOpenData}>
              {T.unlockTheCloudCopy}
            </Path>
          </ul>
        </Island>
      ) : showSetup ? (
        <>
          <SetupStart
            onCreated={onCreated}
            onBack={signedIn ? undefined : () => setMode('choose')}
            notice={signedIn && view ? sentence(T.signedInAs(<strong>{view.email}</strong>, view.status !== 'idle' && view.status !== 'syncing' ? lower(describeSync(view)) : null)) : undefined}
          />
          {signedIn && links}
        </>
      ) : (
        <Island air title={T.welcomeToCasaPapel} description={description}>
          <ul className="divide-y divide-border/60">
            {demo && (
              <Path label={T.loadTheDemoHousehold} primary onClick={() => void loadDemo(store)}>
                {T.aMadeUpHousehold}
              </Path>
            )}
            <Path label={T.startOnThisDevice} primary={!demo} onClick={() => setMode('setup')}>
              {syncAvailable
                ? T.setUpYourHousehold
                : T.setUpYourHousehold2}
            </Path>
            {syncAvailable && !demo && (
              <>
                <Path label={txt.common.signIn} onClick={() => onSignIn?.()}>
                  {T.useYourHouseholdsEmail}
                </Path>
                <Path label={txt.common.haveInvite} onClick={() => onJoin?.()}>
                  {T.someoneInvitedYouPick}
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
