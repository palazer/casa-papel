import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Island } from '@/components/ui/island'
import { inviteLink } from '@/app/url'
import type { Invite } from '@/sync/remote'
import { useSyncEngine, useSyncView } from '@/sync/useSync'

/** Admins only: one-time links that let someone create an account. */
export function InviteCard({ onError }: { onError: (m: string) => void }) {
  const engine = useSyncEngine()
  const view = useSyncView()
  const signedIn = !!view && view.status !== 'off' && view.status !== 'locked'
  const [admin, setAdmin] = useState(false)
  const [invites, setInvites] = useState<Invite[]>([])
  const [latest, setLatest] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!engine || !signedIn) return
    let alive = true
    void engine.isAdmin().then(async (a) => {
      if (!alive) return
      setAdmin(a)
      if (a) setInvites(await engine.listInvites())
    }).catch(() => undefined)
    return () => {
      alive = false
    }
  }, [engine, signedIn])

  if (!engine || !signedIn || !admin) return null

  const refresh = () => engine.listInvites().then(setInvites)
  const create = () => void engine.createInvite().then(async (inv) => {
    setLatest(inv.code)
    setCopied(false)
    await refresh()
  }).catch((e) => onError(e instanceof Error ? e.message : 'Could not create the invite.'))
  const revoke = (code: string) => void engine.revokeInvite(code).then(refresh).catch((e) => onError(e instanceof Error ? e.message : 'Could not revoke the invite.'))
  const copy = (code: string) => {
    void navigator.clipboard?.writeText(inviteLink(code))
    setCopied(true)
  }

  return (
    <Island air title="Invite someone" description="Only you can make these. A link creates one account, works once, and expires after seven days. Send it by message; nothing is emailed.">
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" onClick={create}>Invite someone</Button>
          {latest && (
            <>
              <code className="break-all rounded bg-muted px-2 py-1" data-testid="invite-link">{inviteLink(latest)}</code>
              <Button size="xs" variant="outline" onClick={() => copy(latest)}>{copied ? 'Copied' : 'Copy link'}</Button>
            </>
          )}
        </div>
        {invites.length > 0 && (
          <ul className="space-y-1">
            {invites.map((i) => (
              <li key={i.code} className="flex flex-wrap items-center gap-2">
                <code>{i.code}</code>
                <span className="text-muted-foreground">valid until {new Date(i.expiresAt).toLocaleDateString()}</span>
                <Button size="xs" variant="ghost" onClick={() => copy(i.code)}>Copy link</Button>
                <Button size="xs" variant="ghost" onClick={() => revoke(i.code)}>Revoke</Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Island>
  )
}
