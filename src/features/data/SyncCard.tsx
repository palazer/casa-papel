import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Island } from '@/components/ui/island'
import { isDemoMode } from '@/app/store'
import { AccountDialog, type AccountStep } from '@/features/sync/AccountDialog'
import { describeSync } from '@/features/sync/syncText'
import { useSyncEngine, useSyncView } from '@/sync/useSync'
import { errorText } from '@/app/saveError'
import { txt } from '@/i18n'
import { sentence } from '@/lib/sentence'

const T = txt.data.sync

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
    return <Island air title={T.cloudSync} help="sync.privacy" description={isDemoMode() ? T.syncIsOffIn : T.syncIsNotSet} />
  }

  const signedIn = view.status !== 'off'
  const act = (fn: () => Promise<unknown>, done?: string) => () => void fn().then(() => done && onMessage(done)).catch((e) => onError(errorText(e, txt.common.somethingWentWrong)))

  return (
    <Island
      air title={T.cloudSync} help="sync.privacy"
      description={signedIn
        ? sentence(T.signedInAs(<strong>{view.email}</strong>))
        : T.keepAnEncryptedCopy}
    >
      <div className="space-y-3">
        {signedIn && <p role="status" data-testid="sync-status">{describeSync(view)}</p>}
        <div className="flex flex-wrap gap-2">
          {!signedIn && (
            <>
              <Button size="sm" onClick={() => setDialog('signin')}>{txt.common.signIn}</Button>
              <Button size="sm" variant="outline" onClick={() => setDialog('join')}>{txt.common.haveInvite}</Button>
            </>
          )}
          {signedIn && view.status === 'locked' && <Button size="sm" onClick={() => setDialog('locked')}>{T.unlock}</Button>}
          {signedIn && view.status === 'choose' && <Button size="sm" onClick={() => setDialog('choose')}>{T.decideWhichDataTo}</Button>}
          {signedIn && view.status !== 'locked' && view.status !== 'choose' && (
            <>
              <Button size="xs" variant="outline" onClick={act(() => engine.syncNow())} disabled={view.status === 'syncing'}>{T.syncNow}</Button>
              <Button size="xs" variant="outline" onClick={() => setDialog('change-password')}>{T.changePassword}</Button>
              <Button size="xs" variant="outline" onClick={() => setDialog('new-recovery')}>{T.newRecoveryCode}</Button>
            </>
          )}
          {signedIn && <Button size="xs" variant="ghost" onClick={act(() => engine.signOut(), T.signedOutYourData)}>{T.signOut}</Button>}
        </div>
        {signedIn && <p className="text-muted-foreground">{T.signOutKeepsEverything}</p>}
      </div>
      {dialog && <AccountDialog initial={dialog} hasLocalData={hasLocalData} onClose={close} />}
    </Island>
  )
}
