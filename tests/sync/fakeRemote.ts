import { OfflineError, StaleSchemaError, SyncConflictError, type Invite, type MemberKeys, type Membership, type RemoteUser, type SnapshotRow, type SyncRemote } from '@/sync/remote'

interface FakeUser extends RemoteUser {
  authKey: string
}

/** In-memory stand-in for Supabase: one shared server, one client session per instance. */
export class FakeServer {
  users = new Map<string, FakeUser>()
  members: Array<Membership & { userId: string; owner: string }> = []
  snapshots = new Map<string, SnapshotRow>()
  invites: Invite[] = []
  admins = new Set<string>()
  pushes = 0
  pulls = 0

  addUser(email: string, authKey: string): FakeUser {
    const u = { userId: `u-${this.users.size + 1}`, email, authKey }
    this.users.set(email, u)
    return u
  }
}

export class FakeRemote implements SyncRemote {
  user: FakeUser | null = null
  offline = false

  constructor(readonly server: FakeServer) {}

  private online(): void {
    if (this.offline) throw new OfflineError()
  }

  async currentUser() {
    return this.user
  }

  async signIn(email: string, authKey: string) {
    this.online()
    const u = this.server.users.get(email)
    if (!u || u.authKey !== authKey) throw new Error('Invalid login credentials')
    this.user = u
    return u
  }

  async signOut() {
    this.user = null
  }

  async updatePassword(newAuthKey: string) {
    this.online()
    if (!this.user) throw new Error('Not signed in')
    this.user.authKey = newAuthKey
  }

  async redeemInvite(code: string, email: string, authKey: string) {
    this.online()
    const inv = this.server.invites.find((i) => i.code === code)
    if (!inv || inv.usedAt || inv.expiresAt < Date.now()) throw new Error('This invite link is not valid any more.')
    if (this.server.users.has(email)) throw new Error('An account with this email already exists.')
    inv.usedAt = Date.now()
    this.server.addUser(email, authKey)
  }

  async resetWithRecovery(email: string, verifier: string, newAuthKey: string) {
    this.online()
    const u = this.server.users.get(email)
    const m = u && this.server.members.find((x) => x.userId === u.userId)
    if (!u || !m || m.recoveryVerifier !== verifier) throw new Error('The recovery code does not match this account.')
    u.authKey = newAuthKey
  }

  async inviteValid(code: string) {
    this.online()
    const inv = this.server.invites.find((i) => i.code === code)
    return !!inv && !inv.usedAt && inv.expiresAt > Date.now()
  }

  async getMembership() {
    this.online()
    if (!this.user) throw new Error('Not signed in')
    const m = this.server.members.find((x) => x.userId === this.user!.userId)
    return m ? { ...m } : null
  }

  async createHousehold(input: MemberKeys) {
    this.online()
    if (!this.user) throw new Error('Not signed in')
    const householdId = `h-${this.server.members.length + 1}`
    this.server.members.push({ householdId, role: 'owner', userId: this.user.userId, owner: this.user.userId, ...input })
    return { householdId }
  }

  async updateMember(householdId: string, patch: Partial<MemberKeys>) {
    this.online()
    const m = this.server.members.find((x) => x.householdId === householdId && x.userId === this.user?.userId)
    if (!m) throw new Error('Not a member')
    Object.assign(m, patch)
  }

  async deleteHousehold(householdId: string) {
    this.online()
    this.server.members = this.server.members.filter((m) => m.householdId !== householdId)
    this.server.snapshots.delete(householdId)
  }

  async getVersion(householdId: string) {
    this.online()
    return this.server.snapshots.get(householdId)?.version ?? 0
  }

  async getSnapshot(householdId: string) {
    this.online()
    this.server.pulls++
    const s = this.server.snapshots.get(householdId)
    return s ? { ...s } : null
  }

  async pushSnapshot(householdId: string, expectedVersion: number, cipher: string, schemaVersion: number, deviceId: string) {
    this.online()
    this.server.pushes++
    const current = this.server.snapshots.get(householdId)
    if ((current?.version ?? 0) !== expectedVersion) throw new SyncConflictError()
    if (current && schemaVersion < current.schemaVersion) throw new StaleSchemaError()
    const version = expectedVersion + 1
    this.server.snapshots.set(householdId, { version, schemaVersion, cipher, deviceId, updatedAt: Date.now() })
    return version
  }

  async isAdmin() {
    this.online()
    return !!this.user && this.server.admins.has(this.user.userId)
  }

  async createInvite(code: string) {
    this.online()
    const inv: Invite = { code, createdAt: Date.now(), expiresAt: Date.now() + 7 * 86_400_000, usedAt: null }
    this.server.invites.push(inv)
    return inv
  }

  async listInvites() {
    this.online()
    return this.server.invites.filter((i) => !i.usedAt)
  }

  async revokeInvite(code: string) {
    this.online()
    this.server.invites = this.server.invites.filter((i) => i.code !== code)
  }
}
