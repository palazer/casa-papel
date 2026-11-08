import type { KdfParams, Wrapped } from './crypto'

/** Everything the sync engine and the account dialogs need from the server, behind one interface so tests can fake it. */
export interface SyncRemote {
  // ----- account -----
  /** Resolves with the user when signed in; the session is remembered by the client library. */
  currentUser(): Promise<RemoteUser | null>
  signIn(email: string, authKey: string): Promise<RemoteUser>
  signOut(): Promise<void>
  /** Change the account password (the derived auth key) while signed in. */
  updatePassword(newAuthKey: string): Promise<void>
  /** Create an account from an invite link. Public sign-ups are off; the server function checks and consumes the code. */
  redeemInvite(code: string, email: string, authKey: string): Promise<void>
  /** Set a new password with the recovery code's verifier instead of the old password. */
  resetWithRecovery(email: string, verifier: string, newAuthKey: string): Promise<void>
  inviteValid(code: string): Promise<boolean>

  // ----- household membership -----
  getMembership(): Promise<Membership | null>
  createHousehold(input: MemberKeys): Promise<{ householdId: string }>
  updateMember(householdId: string, patch: Partial<MemberKeys>): Promise<void>
  /** Owner only. Removes the household, its members and its snapshot. */
  deleteHousehold(householdId: string): Promise<void>

  // ----- snapshots -----
  /** Current snapshot version, 0 when none exists yet. */
  getVersion(householdId: string): Promise<number>
  getSnapshot(householdId: string): Promise<SnapshotRow | null>
  /** Writes when the stored version equals `expectedVersion` (0 = none yet). Returns the new version. Throws SyncConflictError otherwise. */
  pushSnapshot(householdId: string, expectedVersion: number, cipher: string, schemaVersion: number, deviceId: string): Promise<number>

  // ----- admin -----
  isAdmin(): Promise<boolean>
  createInvite(code: string): Promise<Invite>
  listInvites(): Promise<Invite[]>
  revokeInvite(code: string): Promise<void>
}

export interface RemoteUser {
  userId: string
  email: string
}

export interface MemberKeys {
  wrappedKey: Wrapped
  recovery: Wrapped | null
  recoveryVerifier: string | null
  kdf: KdfParams
}

export interface Membership extends MemberKeys {
  householdId: string
  role: 'owner' | 'member'
}

export interface SnapshotRow {
  version: number
  schemaVersion: number
  cipher: string
  deviceId: string
  updatedAt: number
}

export interface Invite {
  code: string
  createdAt: number
  expiresAt: number
  usedAt: number | null
}

/** Someone else pushed first: pull, merge, push again. */
export class SyncConflictError extends Error {
  constructor() {
    super('conflict')
    this.name = 'SyncConflictError'
  }
}

/** The cloud copy was written by a newer app than this one. */
export class StaleSchemaError extends Error {
  constructor() {
    super('Update the app to sync: the cloud copy comes from a newer version.')
    this.name = 'StaleSchemaError'
  }
}

/** No network, or the server could not be reached. */
export class OfflineError extends Error {
  constructor() {
    super('offline')
    this.name = 'OfflineError'
  }
}

/** Plain-words messages for errors the server function and the auth API return. */
export function describeRemoteError(e: unknown): string {
  if (e instanceof OfflineError) return 'You are offline. Changes will sync when you are back.'
  if (e instanceof StaleSchemaError) return e.message
  if (e instanceof Error) {
    const m = e.message
    if (/invalid login credentials/i.test(m)) return 'Email or password is wrong.'
    if (/fetch|network/i.test(m)) return 'Could not reach the sync server.'
    return m
  }
  return 'Something went wrong.'
}
