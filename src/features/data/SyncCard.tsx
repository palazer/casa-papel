import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { isDemoMode } from '@/app/store'
import { AccountDialog, type AccountStep } from '@/features/sync/AccountDialog'
import { describeSync } from '@/features/sync/syncText'
import { useSyncEngine, useSyncView } from '@/sync/useSync'

interface Props {
  hasLocalData: boolean
  onMessage: (m: string) => void
  onError: (m: string) => void
}

/** Cloud sync on the Data screen: sign in, status, and the account actions. */
export function SyncCard({ hasLocalData, onMessage, onError }: Props) {
  const engine = useSyncEngine()
  const view = useSyncView()
  const [dialog, setDialog] = useState<AccountStep | null>(null)

  const close = (message?: string) => {
    setDialog(null)
    if (message) onMessage(message)
  }

  if (!engine || !view) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Cloud sync</CardTitle>
          <CardDescription>{isDemoMode() ? 'Sync is off in the demo sandbox.' : 'Sync is not set up in this build.'}</CardDescription>
        </CardHeader>
      </Card>
    )
  }

  const signedIn = view.status !== 'off'
  const act = (fn: () => Promise<unknown>, done?: string) => () => void fn().then(() => done && onMessage(done)).catch((e) => onError(e instanceof Error ? e.message : 'Something went wrong.'))

  return (
    <Card>
      <CardHeader>
        <CardTitle>Cloud sync</CardTitle>
        <CardDescription>
          {signedIn
            ? <>Signed in as <strong>{view.email}</strong>. The household is stored encrypted on Supabase in the EU; only your password opens it.</>
            : 'Keep an encrypted copy in the cloud and use the same household on your phone and laptop. Only your password can open it; nobody else, not even the person who runs this app. Accounts are by invitation.'}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {signedIn && <p role="status" data-testid="sync-status">{describeSync(view)}</p>}
        <div className="flex flex-wrap gap-2">
          {!signedIn && (
            <>
              <Button onClick={() => setDialog('signin')}>Sign in</Button>
              <Button variant="outline" onClick={() => setDialog('join')}>I have an invite</Button>
            </>
          )}
          {signedIn && view.status === 'locked' && <Button onClick={() => setDialog('locked')}>Unlock…</Button>}
          {signedIn && view.status === 'choose' && <Button onClick={() => setDialog('choose')}>Decide which data to keep…</Button>}
          {signedIn && view.status !== 'locked' && view.status !== 'choose' && (
            <>
              <Button variant="outline" onClick={act(() => engine.syncNow())} disabled={view.status === 'syncing'}>Sync now</Button>
              <Button variant="outline" onClick={() => setDialog('change-password')}>Change password…</Button>
              <Button variant="outline" onClick={() => setDialog('new-recovery')}>New recovery code…</Button>
            </>
          )}
          {signedIn && <Button variant="ghost" onClick={act(() => engine.signOut(), 'Signed out. Your data stays on this device.')}>Sign out</Button>}
        </div>
        {signedIn && <p className="text-xs text-muted-foreground">Sign out keeps everything on this device and only stops syncing. To clear a shared device, use "Sign out and wipe" in the danger zone.</p>}
      </CardContent>
      {dialog && <AccountDialog initial={dialog} hasLocalData={hasLocalData} onClose={close} />}
    </Card>
  )
}
