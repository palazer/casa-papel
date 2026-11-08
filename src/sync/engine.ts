import { liveQuery, type Subscription } from 'dexie'
import { SCHEMA_VERSION, type ExportFile, type Meta, type SyncState } from '@/model'
import { importReplace, mergeTables, parseExportFile, wipeAll, type Store } from '@/store'
import {
  KDF_PARAMS, decryptSnapshot, deriveKeys, encryptSnapshot, exportHouseholdKey, generateHouseholdKey, generateInviteCode, generateRecoveryCode, importHouseholdKey,
  normalizeEmail, recoveryKeys, snapshotAad, unwrapHouseholdKey, wrapHouseholdKey,
} from './crypto'
import { OfflineError, StaleSchemaError, SyncConflictError, describeRemoteError, type Invite, type Membership, type SyncRemote } from './remote'
import { buildSyncPayload } from './snapshot'

export type SyncStatus = 'off' | 'idle' | 'syncing' | 'offline' | 'error' | 'locked' | 'choose' | 'stale'

export interface SyncView {
  status: SyncStatus
  email: string | null
  owner: boolean
  /** A local change is waiting to be pushed. */
  pending: boolean
  lastPullAt: number | null
  lastPushAt: number | null
  error: string | null
  failingSince: number | null
  /** The two sides hold different households; the user must choose (see finishFirstSync). */
  choice: { localName: string; cloudName: string } | null
}

/** What signing in found. */
export type SignInResult =
  | { kind: 'ok' }
  | { kind: 'created'; recoveryCode: string }
  | { kind: 'locked' }
  | { kind: 'choose' }

export interface EngineOptions {
  /** Push this long after the last local change. */
  debounceMs?: number
  /** Ask the server for a newer version this often while running. 0 disables. */
  pollMs?: number
  now?: () => number
  /** Fewer KDF rounds for tests. */
  kdfIterations?: number
}

const MIN_PASSWORD = 12

/**
 * Keeps this device and the household's cloud copy in step: encrypted whole-household snapshots,
 * merged record by record with last-write-wins. One instance per store; start() after sign-in.
 */
export class SyncEngine {
  private listeners = new Set<() => void>()
  private view: SyncView = emptyView()
  private key: CryptoKey | null = null
  private sync: SyncState | null = null
  private deviceId = ''
  private running = false
  /** Serialises pulls and pushes; `active` counts sections still running. */
  private chain: Promise<void> = Promise.resolve()
  private active = 0
  private inFlight: Promise<void> | null = null
  private debounceTimer: ReturnType<typeof setTimeout> | null = null
  private pollTimer: ReturnType<typeof setInterval> | null = null
  private metaSub: Subscription | null = null
  private pendingWrapKey: CryptoKey | null = null
  private pendingCloud: { file: ExportFile; version: number } | null = null
  private offline = false
  private stale = false
  private readonly debounceMs: number
  private readonly pollMs: number
  private readonly now: () => number
  private readonly kdfIterations: number | undefined
  private readonly onVisible = () => { if (typeof document === 'undefined' || document.visibilityState === 'visible') void this.syncNow() }

  readonly store: Store
  readonly remote: SyncRemote

  constructor(store: Store, remote: SyncRemote, opts: EngineOptions = {}) {
    this.store = store
    this.remote = remote
    this.debounceMs = opts.debounceMs ?? 2500
    this.pollMs = opts.pollMs ?? 120_000
    this.now = opts.now ?? (() => Date.now())
    this.kdfIterations = opts.kdfIterations
  }

  // ---------- observation ----------

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn)
    return () => {
      this.listeners.delete(fn)
    }
  }

  getView(): SyncView {
    return this.view
  }

  private async refreshView(patch: Partial<SyncView> = {}): Promise<void> {
    const meta = await this.store.meta()
    const s = meta.sync
    const status: SyncStatus =
      !s ? 'off'
      : !this.key ? 'locked'
      : this.pendingCloud ? 'choose'
      : this.active > 0 ? 'syncing'
      : this.stale ? 'stale'
      : this.offline ? 'offline'
      : s.lastError ? 'error'
      : 'idle'
    this.view = {
      status,
      email: s?.email ?? null,
      owner: s?.owner ?? false,
      pending: meta.localRevision > meta.pushedRevision,
      lastPullAt: s?.lastPullAt ?? null,
      lastPushAt: s?.lastPushAt ?? null,
      error: s?.lastError ?? null,
      failingSince: s?.failingSince ?? null,
      choice: this.view.choice,
      ...patch,
    }
    for (const l of this.listeners) l()
  }

  // ---------- lifecycle ----------

  /** Resume from the stored sync state (app start). Does nothing when this device is not signed in. */
  async start(): Promise<void> {
    const meta = await this.store.meta()
    this.deviceId = meta.deviceId
    this.sync = meta.sync
    if (!this.sync) return void (await this.refreshView())
    const user = await this.remote.currentUser().catch(() => null)
    if (!user) {
      // the session expired or was cleared: keep the data, forget the link
      await this.saveSync(null)
      return void (await this.refreshView())
    }
    this.key = this.sync.keyB64 ? await importHouseholdKey(this.sync.keyB64) : null
    await this.run()
  }

  /**
   * Every open tab syncs. Tabs share the database, so once one tab claims a revision the others see
   * nothing pending; if two race, the versioned push turns the loser into a harmless pull.
   */
  private async run(): Promise<void> {
    if (this.running) return
    this.running = true
    this.metaSub = liveQuery(() => this.store.db.meta.get('meta')).subscribe({
      next: (m) => {
        if (m && (m.localRevision ?? 0) > (m.pushedRevision ?? 0)) this.schedulePush()
        void this.refreshView()
      },
    })
    if (typeof window !== 'undefined') {
      document.addEventListener('visibilitychange', this.onVisible)
      window.addEventListener('online', this.onVisible)
      if (this.pollMs > 0) this.pollTimer = setInterval(() => void this.syncNow(), this.pollMs)
    }
    await this.refreshView()
    void this.syncNow()
  }

  stop(): void {
    this.running = false
    this.metaSub?.unsubscribe()
    this.metaSub = null
    if (this.debounceTimer) clearTimeout(this.debounceTimer)
    if (this.pollTimer) clearInterval(this.pollTimer)
    this.debounceTimer = null
    this.pollTimer = null
    if (typeof window !== 'undefined') {
      document.removeEventListener('visibilitychange', this.onVisible)
      window.removeEventListener('online', this.onVisible)
    }
  }

  private schedulePush(): void {
    // after a failure, wait for a trigger (online, visible, poll, syncNow) instead of retrying every few seconds
    if (!this.running || !this.key || this.offline || this.sync?.lastError) return
    if (this.debounceTimer) clearTimeout(this.debounceTimer)
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null
      void this.push().catch(() => undefined)
    }, this.debounceMs)
  }

  /** Push what is pending and wait until nothing is running (tests, and before showing a recovery code). Stops after a failed push. */
  async flush(): Promise<void> {
    for (let i = 0; i < 5; i++) {
      if (this.debounceTimer) {
        clearTimeout(this.debounceTimer)
        this.debounceTimer = null
      }
      await this.inFlight
      await this.chain
      const meta = await this.store.meta()
      if (!this.sync || !this.key || meta.localRevision <= meta.pushedRevision) break
      try {
        await this.push()
      } catch {
        break
      }
    }
    await this.chain
    await this.refreshView()
  }

  /** Pull what is new, then push what is pending. Safe to call any time. */
  syncNow(): Promise<void> {
    if (!this.sync || !this.key || this.pendingCloud) return Promise.resolve()
    if (this.inFlight) return this.inFlight
    this.inFlight = (async () => {
      try {
        await this.pull()
        await this.push()
      } catch {
        /* recorded in the view */
      } finally {
        this.inFlight = null
        await this.refreshView()
      }
    })()
    return this.inFlight
  }

  /** Run `fn` after everything queued before it; pulls and pushes never overlap. */
  private exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.chain.then(fn, fn)
    this.chain = run.then(() => undefined, () => undefined)
    this.active++
    void this.refreshView()
    return run.finally(() => {
      this.active--
      void this.refreshView()
    })
  }

  // ---------- pull / push ----------

  private async pull(): Promise<void> {
    const s = this.sync
    if (!s || !this.key) return
    return this.exclusive(async () => {
      try {
        const version = await this.remote.getVersion(s.householdId)
        if (version <= s.lastVersion) return void (await this.recordOk({ lastPullAt: this.now() }))
        const row = await this.remote.getSnapshot(s.householdId)
        if (!row || row.version <= s.lastVersion) return
        if (row.deviceId === this.deviceId) {
          // my own push that completed after this tab lost track of it
          await this.saveSync({ ...s, lastVersion: row.version, lastPullAt: this.now() })
          return
        }
        if (row.schemaVersion > SCHEMA_VERSION) throw new StaleSchemaError()
        const raw = await decryptSnapshot<unknown>(this.key!, snapshotAad(s.householdId, row.version), row.cipher)
        const file = parseExportFile(raw)
        const local = await this.store.db.household.filter((h) => !h.deletedAt).first()
        const cloud = file.tables.household.find((h) => !h.deletedAt)
        if (local && cloud && local.id !== cloud.id) {
          this.pendingCloud = { file, version: row.version }
          await this.refreshView({ choice: { localName: local.name, cloudName: cloud.name } })
          return
        }
        const before = await this.store.meta()
        await mergeTables(this.store, file.tables, file.events)
        if (before.localRevision === before.pushedRevision) {
          // nothing of ours was waiting: the merged state is the cloud state, no echo push
          const after = await this.store.meta()
          await this.store.db.meta.update('meta', { pushedRevision: after.localRevision })
        }
        await this.saveSync({ ...s, lastVersion: row.version, lastPullAt: this.now(), lastError: null, failingSince: null })
        this.offline = false
        this.stale = false
      } catch (e) {
        await this.recordFailure(e)
        throw e
      }
    })
  }

  private async push(attempt = 0): Promise<void> {
    if (!this.sync || !this.key || this.pendingCloud) return
    try {
      await this.exclusive(() => this.pushOnce())
    } catch (e) {
      if (e instanceof SyncConflictError && attempt < 3) {
        // someone else pushed first: take their changes, then try again with the merged state
        await this.pull()
        if (this.pendingCloud) return
        return this.push(attempt + 1)
      }
      throw e
    }
  }

  private async pushOnce(): Promise<void> {
    const s = this.sync
    if (!s || !this.key) return
    const meta = await this.store.meta()
    if (meta.localRevision <= meta.pushedRevision) return
    const previousPushed = meta.pushedRevision
    // claim the revision before reading, so a change that lands during the push stays pending
    await this.store.db.meta.update('meta', { pushedRevision: meta.localRevision })
    try {
      const payload = await buildSyncPayload(this.store, this.deviceId, this.now())
      const nextVersion = s.lastVersion + 1
      const cipher = await encryptSnapshot(this.key, snapshotAad(s.householdId, nextVersion), payload)
      const version = await this.remote.pushSnapshot(s.householdId, s.lastVersion, cipher, SCHEMA_VERSION, this.deviceId)
      await this.saveSync({ ...s, lastVersion: version, lastPushAt: this.now(), lastError: null, failingSince: null })
      this.offline = false
      this.stale = false
    } catch (e) {
      await this.store.db.meta.update('meta', { pushedRevision: previousPushed })
      if (!(e instanceof SyncConflictError)) await this.recordFailure(e)
      throw e
    }
  }

  private async recordOk(patch: Partial<SyncState>): Promise<void> {
    if (!this.sync) return
    this.offline = false
    await this.saveSync({ ...this.sync, ...patch, lastError: null, failingSince: null })
  }

  private async recordFailure(e: unknown): Promise<void> {
    if (!this.sync) return
    this.offline = e instanceof OfflineError
    this.stale = e instanceof StaleSchemaError
    const message = describeRemoteError(e)
    await this.saveSync({ ...this.sync, lastError: this.offline ? null : message, failingSince: this.sync.failingSince ?? this.now() })
  }

  private async saveSync(s: SyncState | null): Promise<void> {
    this.sync = s
    await this.store.db.meta.update('meta', { sync: s })
    await this.refreshView()
  }

  // ---------- account flows ----------

  /** Sign in on this device. May create the household (first device of this account) or need a decision. */
  async signIn(email: string, password: string): Promise<SignInResult> {
    const normalized = normalizeEmail(email)
    const { authKey, wrapKey } = await deriveKeys(normalized, password, this.kdfIterations)
    await this.remote.signIn(normalized, authKey)
    const meta = await this.store.meta()
    this.deviceId = meta.deviceId
    const membership = await this.remote.getMembership()
    if (!membership) {
      const recoveryCode = await this.createHousehold(normalized, wrapKey)
      return { kind: 'created', recoveryCode }
    }
    return this.adopt(normalized, membership, wrapKey)
  }

  /** Create the account from an invite link and set this device up. Returns the recovery code to show once. */
  async join(code: string, email: string, password: string): Promise<{ recoveryCode: string }> {
    checkPassword(password)
    const normalized = normalizeEmail(email)
    if (!(await this.remote.inviteValid(code))) throw new Error('This invite link is not valid any more. Ask for a new one.')
    const { authKey, wrapKey } = await deriveKeys(normalized, password, this.kdfIterations)
    await this.remote.redeemInvite(code, normalized, authKey)
    await this.remote.signIn(normalized, authKey)
    const meta = await this.store.meta()
    this.deviceId = meta.deviceId
    const recoveryCode = await this.createHousehold(normalized, wrapKey)
    return { recoveryCode }
  }

  private async createHousehold(email: string, wrapKey: CryptoKey): Promise<string> {
    const householdKey = await generateHouseholdKey()
    const recoveryCode = generateRecoveryCode()
    const { recoveryKey, verifier } = await recoveryKeys(recoveryCode)
    const { householdId } = await this.remote.createHousehold({
      wrappedKey: await wrapHouseholdKey(householdKey, wrapKey),
      recovery: await wrapHouseholdKey(householdKey, recoveryKey),
      recoveryVerifier: verifier,
      kdf: { ...KDF_PARAMS, iterations: this.kdfIterations ?? KDF_PARAMS.iterations },
    })
    this.key = householdKey
    await this.saveSync({ householdId, email, keyB64: await exportHouseholdKey(householdKey), owner: true, lastVersion: 0, lastPullAt: null, lastPushAt: null, lastError: null, failingSince: null })
    await this.store.db.meta.update('meta', { pushedRevision: 0 })
    await this.run()
    await this.flush()
    return recoveryCode
  }

  /** Attach this device to an existing household: unwrap the key, then pull or push depending on which side has data. */
  private async adopt(email: string, membership: Membership, wrapKey: CryptoKey): Promise<SignInResult> {
    const base: SyncState = { householdId: membership.householdId, email, keyB64: null, owner: membership.role === 'owner', lastVersion: 0, lastPullAt: null, lastPushAt: null, lastError: null, failingSince: null }
    try {
      this.key = await unwrapHouseholdKey(membership.wrappedKey, wrapKey)
    } catch {
      this.pendingWrapKey = wrapKey
      this.key = null
      await this.saveSync(base)
      return { kind: 'locked' }
    }
    await this.saveSync({ ...base, keyB64: await exportHouseholdKey(this.key) })
    const hasLocal = (await this.store.db.household.filter((h) => !h.deletedAt).count()) > 0
    // local data and no cloud copy yet: push everything; otherwise pull first
    await this.store.db.meta.update('meta', { pushedRevision: hasLocal ? 0 : (await this.store.meta()).localRevision })
    await this.run()
    await this.flush()
    return this.pendingCloud ? { kind: 'choose' } : { kind: 'ok' }
  }

  /** After a 'choose' result: keep this device's data (overwrite the cloud copy) or take the cloud copy (replace this device). */
  async finishFirstSync(choice: 'keep-local' | 'take-cloud'): Promise<void> {
    const pending = this.pendingCloud
    const s = this.sync
    if (!pending || !s || !this.key) return
    this.pendingCloud = null
    this.view = { ...this.view, choice: null }
    if (choice === 'take-cloud') {
      await importReplace(this.store, pending.file)
      const meta = await this.store.meta()
      await this.store.db.meta.update('meta', { pushedRevision: meta.localRevision })
      await this.saveSync({ ...s, lastVersion: pending.version, lastPullAt: this.now() })
    } else {
      await this.saveSync({ ...s, lastVersion: pending.version })
      const meta = await this.store.meta()
      await this.store.db.meta.update('meta', { pushedRevision: 0, localRevision: meta.localRevision + 1 })
      await this.push()
    }
    await this.refreshView()
  }

  /** Locked after a password reset elsewhere: the recovery code unlocks the household key and re-wraps it for the password just typed. */
  async unlockWithRecovery(code: string): Promise<void> {
    const s = this.sync
    if (!s || !this.pendingWrapKey) throw new Error('Sign in first.')
    const membership = await this.remote.getMembership()
    if (!membership?.recovery) throw new Error('This household has no recovery code on file.')
    const { recoveryKey } = await recoveryKeys(code)
    let householdKey: CryptoKey
    try {
      householdKey = await unwrapHouseholdKey(membership.recovery, recoveryKey)
    } catch {
      throw new Error('That recovery code does not open this household.')
    }
    await this.remote.updateMember(s.householdId, { wrappedKey: await wrapHouseholdKey(householdKey, this.pendingWrapKey) })
    this.key = householdKey
    this.pendingWrapKey = null
    await this.saveSync({ ...s, keyB64: await exportHouseholdKey(householdKey) })
    await this.run()
    await this.flush()
  }

  /** Locked and no recovery code: start over with a fresh key and this device's data. Returns the new recovery code. */
  async replaceCloudWithLocal(): Promise<string> {
    const s = this.sync
    if (!s || !this.pendingWrapKey) throw new Error('Sign in first.')
    const householdKey = await generateHouseholdKey()
    const recoveryCode = generateRecoveryCode()
    const { recoveryKey, verifier } = await recoveryKeys(recoveryCode)
    await this.remote.updateMember(s.householdId, {
      wrappedKey: await wrapHouseholdKey(householdKey, this.pendingWrapKey),
      recovery: await wrapHouseholdKey(householdKey, recoveryKey),
      recoveryVerifier: verifier,
    })
    this.key = householdKey
    this.pendingWrapKey = null
    const version = await this.remote.getVersion(s.householdId)
    await this.saveSync({ ...s, keyB64: await exportHouseholdKey(householdKey), lastVersion: version })
    const meta = await this.store.meta()
    await this.store.db.meta.update('meta', { pushedRevision: 0, localRevision: meta.localRevision + 1 })
    await this.run()
    await this.flush()
    return recoveryCode
  }

  /** Forgot the password: the recovery code proves the account, sets a new password and re-wraps the key. */
  async resetWithRecovery(email: string, code: string, newPassword: string): Promise<SignInResult> {
    checkPassword(newPassword)
    const normalized = normalizeEmail(email)
    const { recoveryKey, verifier } = await recoveryKeys(code)
    const { authKey, wrapKey } = await deriveKeys(normalized, newPassword, this.kdfIterations)
    await this.remote.resetWithRecovery(normalized, verifier, authKey)
    await this.remote.signIn(normalized, authKey)
    const membership = await this.remote.getMembership()
    if (!membership?.recovery) throw new Error('This household has no recovery code on file.')
    const householdKey = await unwrapHouseholdKey(membership.recovery, recoveryKey)
    const wrappedKey = await wrapHouseholdKey(householdKey, wrapKey)
    await this.remote.updateMember(membership.householdId, { wrappedKey })
    const meta = await this.store.meta()
    this.deviceId = meta.deviceId
    return this.adopt(normalized, { ...membership, wrappedKey }, wrapKey)
  }

  async changePassword(oldPassword: string, newPassword: string): Promise<void> {
    checkPassword(newPassword)
    const s = this.sync
    if (!s || !this.key) throw new Error('Sign in first.')
    const old = await deriveKeys(s.email, oldPassword, this.kdfIterations)
    const membership = await this.remote.getMembership()
    if (!membership) throw new Error('No household on the server.')
    try {
      await unwrapHouseholdKey(membership.wrappedKey, old.wrapKey)
    } catch {
      throw new Error('The current password is wrong.')
    }
    const fresh = await deriveKeys(s.email, newPassword, this.kdfIterations)
    await this.remote.updatePassword(fresh.authKey)
    await this.remote.updateMember(s.householdId, { wrappedKey: await wrapHouseholdKey(this.key, fresh.wrapKey) })
  }

  /** Make a new recovery code; the old one stops working. */
  async newRecoveryCode(): Promise<string> {
    const s = this.sync
    if (!s || !this.key) throw new Error('Sign in first.')
    const code = generateRecoveryCode()
    const { recoveryKey, verifier } = await recoveryKeys(code)
    await this.remote.updateMember(s.householdId, { recovery: await wrapHouseholdKey(this.key, recoveryKey), recoveryVerifier: verifier })
    return code
  }

  /** Forget the cloud link on this device. Data stays unless `wipe`. */
  async signOut(opts: { wipe?: boolean } = {}): Promise<void> {
    this.stop()
    await this.remote.signOut().catch(() => undefined)
    this.key = null
    this.pendingWrapKey = null
    this.pendingCloud = null
    this.view = { ...this.view, choice: null }
    await this.saveSync(null)
    if (opts.wipe) await wipeAll(this.store)
    await this.refreshView()
  }

  /** Owner only: remove the household from the server, then sign this device out (data stays here). */
  async deleteCloudCopy(): Promise<void> {
    const s = this.sync
    if (!s) return
    await this.remote.deleteHousehold(s.householdId)
    await this.signOut()
  }

  // ---------- invites (admins) ----------

  isAdmin(): Promise<boolean> {
    return this.remote.isAdmin()
  }

  createInvite(): Promise<Invite> {
    return this.remote.createInvite(generateInviteCode())
  }

  listInvites(): Promise<Invite[]> {
    return this.remote.listInvites()
  }

  revokeInvite(code: string): Promise<void> {
    return this.remote.revokeInvite(code)
  }
}

export function checkPassword(password: string): void {
  if (password.length < MIN_PASSWORD) throw new Error(`Use at least ${MIN_PASSWORD} characters. A few words you will remember work well.`)
}

function emptyView(): SyncView {
  return { status: 'off', email: null, owner: false, pending: false, lastPullAt: null, lastPushAt: null, error: null, failingSince: null, choice: null }
}

export type { Meta }
