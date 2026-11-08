import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { SyncConfig } from './config'
import type { KdfParams, Wrapped } from './crypto'
import { OfflineError, StaleSchemaError, SyncConflictError, type Invite, type MemberKeys, type Membership, type RemoteUser, type SnapshotRow, type SyncRemote } from './remote'

interface MemberRow {
  household_id: string
  role: 'owner' | 'member'
  wrapped_key: Wrapped
  recovery: Wrapped | null
  recovery_verifier: string | null
  kdf: KdfParams
}

interface SnapshotDbRow {
  version: number
  schema_version: number
  cipher: string
  device_id: string
  updated_at: string
}

interface InviteRow {
  code: string
  created_at: string
  expires_at: string
  used_at: string | null
}

/** The real server: Supabase auth, PostgREST tables, RPCs and the `account` function. */
export class SupabaseRemote implements SyncRemote {
  readonly client: SupabaseClient

  constructor(cfg: SyncConfig) {
    // detectSessionInUrl off: no email links exist, and the app owns its URL handling
    this.client = createClient(cfg.url, cfg.anonKey, { auth: { detectSessionInUrl: false, persistSession: true, autoRefreshToken: true } })
  }

  async currentUser(): Promise<RemoteUser | null> {
    const { data } = await this.client.auth.getSession()
    const u = data.session?.user
    return u?.email ? { userId: u.id, email: u.email } : null
  }

  async signIn(email: string, authKey: string): Promise<RemoteUser> {
    let res: Awaited<ReturnType<SupabaseClient['auth']['signInWithPassword']>>
    try {
      res = await this.client.auth.signInWithPassword({ email, password: authKey })
    } catch (e) {
      throw toRemoteError(e)
    }
    if (res.error) throw toRemoteError(new Error(res.error.message))
    const u = res.data.user
    if (!u?.email) throw new Error('Sign-in did not return a user.')
    return { userId: u.id, email: u.email }
  }

  async signOut(): Promise<void> {
    await this.client.auth.signOut({ scope: 'local' })
  }

  async updatePassword(newAuthKey: string): Promise<void> {
    let res: Awaited<ReturnType<SupabaseClient['auth']['updateUser']>>
    try {
      res = await this.client.auth.updateUser({ password: newAuthKey })
    } catch (e) {
      throw toRemoteError(e)
    }
    if (res.error) throw toRemoteError(new Error(res.error.message))
  }

  redeemInvite(code: string, email: string, authKey: string): Promise<void> {
    return this.account({ action: 'redeem', code, email, authKey })
  }

  resetWithRecovery(email: string, verifier: string, newAuthKey: string): Promise<void> {
    return this.account({ action: 'reset', email, verifier, newAuthKey })
  }

  private async account(body: Record<string, string>): Promise<void> {
    let res: { data: unknown; error: { message: string; context?: Response } | null }
    try {
      res = await this.client.functions.invoke('account', { body })
    } catch (e) {
      throw toRemoteError(e)
    }
    if (res.error) {
      let message = res.error.message
      try {
        const payload = (await res.error.context?.json()) as { error?: string } | undefined
        if (payload?.error) message = payload.error
      } catch {
        /* not JSON */
      }
      throw toRemoteError(new Error(message))
    }
    const data = res.data as { error?: string } | null
    if (data?.error) throw new Error(data.error)
  }

  async inviteValid(code: string): Promise<boolean> {
    return (await call(this.client.rpc('invite_valid', { p_code: code }))) === true
  }

  async getMembership(): Promise<Membership | null> {
    const row = await call(this.client.from('members').select('household_id, role, wrapped_key, recovery, recovery_verifier, kdf').maybeSingle<MemberRow>())
    if (!row) return null
    return { householdId: row.household_id, role: row.role, wrappedKey: row.wrapped_key, recovery: row.recovery, recoveryVerifier: row.recovery_verifier, kdf: row.kdf }
  }

  async createHousehold(input: MemberKeys): Promise<{ householdId: string }> {
    const householdId = await call(this.client.rpc('create_household', {
      p_wrapped_key: input.wrappedKey, p_recovery: input.recovery, p_recovery_verifier: input.recoveryVerifier, p_kdf: input.kdf,
    }))
    return { householdId: householdId as string }
  }

  async updateMember(householdId: string, patch: Partial<MemberKeys>): Promise<void> {
    const uid = await this.uid()
    const row: Record<string, unknown> = { updated_at: new Date().toISOString() }
    if (patch.wrappedKey) row.wrapped_key = patch.wrappedKey
    if (patch.recovery !== undefined) row.recovery = patch.recovery
    if (patch.recoveryVerifier !== undefined) row.recovery_verifier = patch.recoveryVerifier
    if (patch.kdf) row.kdf = patch.kdf
    await call(this.client.from('members').update(row).eq('household_id', householdId).eq('user_id', uid))
  }

  async deleteHousehold(householdId: string): Promise<void> {
    await call(this.client.rpc('delete_household', { p_household: householdId }))
  }

  async getVersion(householdId: string): Promise<number> {
    const row = await call(this.client.from('snapshots').select('version').eq('household_id', householdId).maybeSingle<{ version: number }>())
    return row?.version ?? 0
  }

  async getSnapshot(householdId: string): Promise<SnapshotRow | null> {
    const row = await call(this.client.from('snapshots').select('version, schema_version, cipher, device_id, updated_at').eq('household_id', householdId).maybeSingle<SnapshotDbRow>())
    return row ? { version: row.version, schemaVersion: row.schema_version, cipher: row.cipher, deviceId: row.device_id, updatedAt: Date.parse(row.updated_at) } : null
  }

  async pushSnapshot(householdId: string, expectedVersion: number, cipher: string, schemaVersion: number, deviceId: string): Promise<number> {
    const version = await call(this.client.rpc('push_snapshot', {
      p_household: householdId, p_expected: expectedVersion, p_cipher: cipher, p_schema_version: schemaVersion, p_device_id: deviceId,
    }))
    return Number(version)
  }

  async isAdmin(): Promise<boolean> {
    return (await call(this.client.rpc('is_admin'))) === true
  }

  async createInvite(code: string): Promise<Invite> {
    const uid = await this.uid()
    const row = await call(this.client.from('invites').insert({ code, created_by: uid }).select('code, created_at, expires_at, used_at').single<InviteRow>())
    if (!row) throw new Error('The invite was not saved.')
    return toInvite(row)
  }

  async listInvites(): Promise<Invite[]> {
    const rows = await call(this.client.from('invites').select('code, created_at, expires_at, used_at').is('used_at', null).order('created_at', { ascending: false }).returns<InviteRow[]>())
    return (rows ?? []).map(toInvite)
  }

  async revokeInvite(code: string): Promise<void> {
    await call(this.client.from('invites').delete().eq('code', code))
  }

  private async uid(): Promise<string> {
    const { data } = await this.client.auth.getSession()
    const id = data.session?.user.id
    if (!id) throw new Error('Not signed in.')
    return id
  }
}

function toInvite(r: InviteRow): Invite {
  return { code: r.code, createdAt: Date.parse(r.created_at), expiresAt: Date.parse(r.expires_at), usedAt: r.used_at ? Date.parse(r.used_at) : null }
}

/** Unwrap a supabase-js `{ data, error }` result, turning failures into the engine's error types. */
async function call<T>(p: PromiseLike<{ data: T; error: { message: string } | null }>): Promise<T> {
  let res: { data: T; error: { message: string } | null }
  try {
    res = await p
  } catch (e) {
    throw toRemoteError(e)
  }
  if (res.error) throw toRemoteError(new Error(res.error.message))
  return res.data
}

function toRemoteError(e: unknown): Error {
  const message = e instanceof Error ? e.message : String(e)
  if (/\bconflict\b/.test(message)) return new SyncConflictError()
  if (/stale_schema/.test(message)) return new StaleSchemaError()
  if (/Failed to fetch|NetworkError|Load failed|fetch failed|Failed to send/i.test(message) || (typeof navigator !== 'undefined' && navigator.onLine === false)) return new OfflineError()
  return e instanceof Error ? e : new Error(message)
}
