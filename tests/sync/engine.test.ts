import { describe, expect, it } from 'vitest'
import { RowSchema, newId, type Row } from '@/model'
import { CasaDb, Store, addRow, loadTables, quickCreateHousehold, renameRow, setCellValue } from '@/store'
import { SyncEngine } from '@/sync/engine'
import { deriveKeys } from '@/sync/crypto'
import { FakeRemote, FakeServer } from './fakeRemote'

const FAST = 1000
const PW = 'correct horse battery staple'

function device(server: FakeServer) {
  const store = new Store(new CasaDb(`test-${newId()}`))
  const remote = new FakeRemote(server)
  const engine = new SyncEngine(store, remote, { debounceMs: 0, pollMs: 0, kdfIterations: FAST })
  return { store, remote, engine }
}

async function withHousehold(server: FakeServer) {
  const d = device(server)
  await quickCreateHousehold(d.store, { name: 'Palace', baseCurrency: 'EUR', locale: 'en-IE', startMonth: '2026-01' })
  return d
}

const rowNames = async (store: Store) => (await loadTables(store)).rows.filter((r) => !r.deletedAt).map((r) => r.name).sort()

describe('sync engine', () => {
  it('join creates the account and household and pushes; a second device signs in and pulls; edits flow both ways', async () => {
    const server = new FakeServer()
    server.invites.push({ code: 'INVITE', createdAt: Date.now(), expiresAt: Date.now() + 1000_000, usedAt: null })
    const a = await withHousehold(server)
    const { recoveryCode } = await a.engine.join('INVITE', 'Sam@Example.com', PW)
    expect(recoveryCode).toMatch(/^[0-9A-Z-]{30}$/)
    expect(server.users.get('sam@example.com')).toBeDefined()
    expect(server.snapshots.size).toBe(1)
    expect(a.engine.getView()).toMatchObject({ status: 'idle', email: 'sam@example.com', owner: true, pending: false })
    await expect(a.engine.join('INVITE', 'other@example.com', PW)).rejects.toThrow(/not valid/)

    const b = device(server)
    const res = await b.engine.signIn('sam@example.com', PW)
    expect(res).toEqual({ kind: 'ok' })
    expect(await rowNames(b.store)).toEqual(await rowNames(a.store))
    expect((await loadTables(b.store)).household[0]?.name).toBe('Palace')

    // B edits, A pulls
    const rent = (await loadTables(b.store)).rows.find((r) => r.name === 'Rent')!
    await renameRow(b.store, rent.id, 'Rent B')
    await b.engine.flush()
    expect(server.snapshots.get('h-1')?.version).toBe(2)
    await a.engine.syncNow()
    expect((await loadTables(a.store)).rows.find((r) => r.id === rent.id)?.name).toBe('Rent B')
    // a pull with nothing of our own pending does not echo a push
    expect(server.snapshots.get('h-1')?.version).toBe(2)

    // A edits, B pulls
    await setCellValue(a.store, rent.id, '2026-02', 123400, 'from-now-on')
    await a.engine.flush()
    await b.engine.syncNow()
    expect((await loadTables(b.store)).cells.find((c) => c.rowId === rent.id && c.month === '2026-02')?.value).toBe(123400)
    a.engine.stop()
    b.engine.stop()
  })

  it('concurrent edits: the second push conflicts, pulls, merges and pushes; both sides converge', async () => {
    const server = new FakeServer()
    server.addUser('sam@example.com', (await deriveKeys('sam@example.com', PW, FAST)).authKey)
    const a = await withHousehold(server)
    expect((await a.engine.signIn('sam@example.com', PW)).kind).toBe('created')
    const b = device(server)
    await b.engine.signIn('sam@example.com', PW)

    const rows = (await loadTables(a.store)).rows
    const rent = rows.find((r) => r.name === 'Rent')!
    const groceries = rows.find((r) => r.name === 'Groceries')!
    a.remote.offline = true
    b.remote.offline = true
    await renameRow(a.store, rent.id, 'Rent from A')
    await renameRow(b.store, groceries.id, 'Groceries from B')
    await a.engine.flush()
    expect(a.engine.getView()).toMatchObject({ status: 'offline', pending: true })
    a.remote.offline = false
    b.remote.offline = false
    await a.engine.syncNow()
    expect(a.engine.getView()).toMatchObject({ status: 'idle', pending: false })
    await b.engine.syncNow() // conflict → pull → merge → push
    await a.engine.syncNow()
    expect(await rowNames(a.store)).toEqual(await rowNames(b.store))
    expect(await rowNames(a.store)).toContain('Rent from A')
    expect(await rowNames(a.store)).toContain('Groceries from B')
    a.engine.stop()
    b.engine.stop()
  })

  it('hard deletes travel, and an undo after sync wins on the other device', async () => {
    const server = new FakeServer()
    server.addUser('sam@example.com', (await deriveKeys('sam@example.com', PW, FAST)).authKey)
    const a = await withHousehold(server)
    await a.engine.signIn('sam@example.com', PW)
    const b = device(server)
    await b.engine.signIn('sam@example.com', PW)

    const extra = await addRow(a.store, { name: 'Gym', section: 'expense' })
    await a.engine.flush()
    await b.engine.syncNow()
    expect(await rowNames(b.store)).toContain('Gym')
    await a.store.commit([{ op: 'delete', table: 'rows', key: extra.id }])
    await a.engine.flush()
    await b.engine.syncNow()
    expect(await rowNames(b.store)).not.toContain('Gym')

    const rent = (await loadTables(a.store)).rows.find((r) => r.name === 'Rent')!
    await renameRow(a.store, rent.id, 'Renamed')
    await a.engine.flush()
    await b.engine.syncNow()
    await a.store.undo()
    await a.engine.flush()
    await b.engine.syncNow()
    expect((await loadTables(b.store)).rows.find((r) => r.id === rent.id)?.name).toBe('Rent')
    a.engine.stop()
    b.engine.stop()
  })

  it('a device with a different household must choose: keep local overwrites the cloud, take cloud replaces the device', async () => {
    const server = new FakeServer()
    server.addUser('sam@example.com', (await deriveKeys('sam@example.com', PW, FAST)).authKey)
    const a = await withHousehold(server)
    await a.engine.signIn('sam@example.com', PW)
    const b = device(server)
    await quickCreateHousehold(b.store, { name: 'Other place', baseCurrency: 'TRY', locale: 'tr-TR', startMonth: '2026-03' })
    expect((await b.engine.signIn('sam@example.com', PW)).kind).toBe('choose')
    expect(b.engine.getView()).toMatchObject({ status: 'choose', choice: { localName: 'Other place', cloudName: 'Palace' } })
    await b.engine.finishFirstSync('take-cloud')
    expect((await loadTables(b.store)).household.map((h) => h.name)).toEqual(['Palace'])
    expect(b.engine.getView().status).toBe('idle')

    const c = device(server)
    await quickCreateHousehold(c.store, { name: 'Third', baseCurrency: 'USD', locale: 'en-US', startMonth: '2026-05' })
    expect((await c.engine.signIn('sam@example.com', PW)).kind).toBe('choose')
    await c.engine.finishFirstSync('keep-local')
    expect(server.snapshots.get('h-1')!.version).toBeGreaterThan(1)
    // A now sees a foreign household and gets the same question
    await a.engine.syncNow()
    expect(a.engine.getView()).toMatchObject({ status: 'choose', choice: { localName: 'Palace', cloudName: 'Third' } })
    a.engine.stop(); b.engine.stop(); c.engine.stop()
  })

  it('password change keeps other devices working; a wrong old password is refused; recovery resets a forgotten password', async () => {
    const server = new FakeServer()
    server.addUser('sam@example.com', (await deriveKeys('sam@example.com', PW, FAST)).authKey)
    const a = await withHousehold(server)
    const created = await a.engine.signIn('sam@example.com', PW)
    const recoveryCode = created.kind === 'created' ? created.recoveryCode : ''
    const b = device(server)
    await b.engine.signIn('sam@example.com', PW)

    await expect(a.engine.changePassword('not the password', 'a brand new password')).rejects.toThrow(/current password/)
    await expect(a.engine.changePassword(PW, 'short')).rejects.toThrow(/12 characters/)
    await a.engine.changePassword(PW, 'a brand new password')
    const rent = (await loadTables(b.store)).rows.find((r) => r.name === 'Rent')!
    await renameRow(b.store, rent.id, 'Still syncing')
    await b.engine.flush()
    await a.engine.syncNow()
    expect((await loadTables(a.store)).rows.find((r) => r.id === rent.id)?.name).toBe('Still syncing')

    const c = device(server)
    await expect(c.engine.signIn('sam@example.com', PW)).rejects.toThrow(/Invalid login/)
    expect((await c.engine.signIn('sam@example.com', 'a brand new password')).kind).toBe('ok')

    // forgot it all: recovery code sets a new password and unlocks the data on a fresh device
    const d = device(server)
    await expect(d.engine.resetWithRecovery('sam@example.com', 'AAAAA-AAAAA-AAAAA-AAAAA-AAAAAA', 'yet another password')).rejects.toThrow(/does not match/)
    expect((await d.engine.resetWithRecovery('sam@example.com', recoveryCode, 'yet another password')).kind).toBe('ok')
    expect((await loadTables(d.store)).household[0]?.name).toBe('Palace')
    // the old wrapped key no longer opens on a device that still has the previous password: locked, recovery unlocks
    const e = device(server)
    expect((await e.engine.signIn('sam@example.com', 'yet another password')).kind).toBe('ok')
    a.engine.stop(); b.engine.stop(); c.engine.stop(); d.engine.stop(); e.engine.stop()
  })

  it('a stale wrapped key locks the device; recovery or replacing the cloud copy unlocks it', async () => {
    const server = new FakeServer()
    server.addUser('sam@example.com', (await deriveKeys('sam@example.com', PW, FAST)).authKey)
    const a = await withHousehold(server)
    const created = await a.engine.signIn('sam@example.com', PW)
    const recoveryCode = created.kind === 'created' ? created.recoveryCode : ''
    // simulate a reset done without re-wrapping: the server password changes but wrapped_key stays for the old one
    server.users.get('sam@example.com')!.authKey = (await deriveKeys('sam@example.com', 'new password for sam', FAST)).authKey

    const b = device(server)
    expect((await b.engine.signIn('sam@example.com', 'new password for sam')).kind).toBe('locked')
    expect(b.engine.getView().status).toBe('locked')
    expect(b.engine.needsPasswordToUnlock()).toBe(false)
    // after a reload the key derived at sign-in is gone: the password is asked again and checked before anything is re-wrapped
    const b2 = new SyncEngine(b.store, b.remote, { debounceMs: 0, pollMs: 0, kdfIterations: FAST })
    await b2.start()
    expect(b2.getView().status).toBe('locked')
    expect(b2.needsPasswordToUnlock()).toBe(true)
    await expect(b2.unlockWithRecovery(recoveryCode)).rejects.toThrow(/password/)
    await expect(b2.unlockWithRecovery(recoveryCode, 'not the right password')).rejects.toThrow(/Invalid login/)
    await b2.unlockWithRecovery(recoveryCode, 'new password for sam')
    expect(b2.getView().status).toBe('idle')
    b2.stop()
    await expect(b.engine.unlockWithRecovery('AAAAA-AAAAA-AAAAA-AAAAA-AAAAAA')).rejects.toThrow(/does not open/)
    await b.engine.unlockWithRecovery(recoveryCode)
    expect(b.engine.getView().status).toBe('idle')
    expect((await loadTables(b.store)).household[0]?.name).toBe('Palace')

    const c = device(server)
    server.users.get('sam@example.com')!.authKey = (await deriveKeys('sam@example.com', 'third password now', FAST)).authKey
    await quickCreateHousehold(c.store, { name: 'Fresh start', baseCurrency: 'EUR', locale: 'en-IE', startMonth: '2026-06' })
    expect((await c.engine.signIn('sam@example.com', 'third password now')).kind).toBe('locked')
    const newCode = await c.engine.replaceCloudWithLocal()
    expect(newCode).toMatch(/-/)
    expect(c.engine.getView().status).toBe('idle')
    const d = device(server)
    expect((await d.engine.signIn('sam@example.com', 'third password now')).kind).toBe('ok')
    expect((await loadTables(d.store)).household[0]?.name).toBe('Fresh start')
    a.engine.stop(); b.engine.stop(); c.engine.stop(); d.engine.stop()
  })

  it('sign out keeps the data; sign out with wipe removes it; a newer cloud schema reports stale', async () => {
    const server = new FakeServer()
    server.addUser('sam@example.com', (await deriveKeys('sam@example.com', PW, FAST)).authKey)
    const a = await withHousehold(server)
    await a.engine.signIn('sam@example.com', PW)
    await a.engine.signOut()
    expect(a.engine.getView().status).toBe('off')
    expect((await a.store.meta()).sync).toBeNull()
    expect((await loadTables(a.store)).rows.length).toBeGreaterThan(0)
    await a.engine.signIn('sam@example.com', PW)
    await a.engine.signOut({ wipe: true })
    expect((await loadTables(a.store)).rows).toHaveLength(0)
    // the same browser signs in again: a wiped device is a new device, so its own old snapshot comes back down
    expect((await a.engine.signIn('sam@example.com', PW)).kind).toBe('ok')
    expect((await loadTables(a.store)).household[0]?.name).toBe('Palace')
    expect((await loadTables(a.store)).rows.length).toBeGreaterThan(0)
    a.engine.stop()

    const b = device(server)
    await b.engine.signIn('sam@example.com', PW)
    const snap = server.snapshots.get('h-1')!
    server.snapshots.set('h-1', { ...snap, version: snap.version + 1, schemaVersion: 99, deviceId: 'someone-else' })
    await b.engine.syncNow()
    expect(b.engine.getView().status).toBe('stale')
    b.engine.stop()
  })

  it('an offline start keeps the sync link; a vanished session drops it and keeps the data', async () => {
    const server = new FakeServer()
    server.addUser('sam@example.com', (await deriveKeys('sam@example.com', PW, FAST)).authKey)
    const a = await withHousehold(server)
    await a.engine.signIn('sam@example.com', PW)
    a.engine.stop()
    // the app opens with no network and a token it cannot refresh: the session cannot be checked, nothing is forgotten
    a.remote.offline = true
    const again = new SyncEngine(a.store, a.remote, { debounceMs: 0, pollMs: 0, kdfIterations: FAST })
    await again.start()
    await again.syncNow()
    expect(again.getView().status).toBe('offline')
    expect((await a.store.meta()).sync).not.toBeNull()
    a.remote.offline = false
    await again.syncNow()
    expect(again.getView().status).toBe('idle')
    again.stop()
    // the session is really gone (signed out elsewhere, storage cleared): the link goes, the data stays
    await a.remote.signOut()
    const later = new SyncEngine(a.store, a.remote, { debounceMs: 0, pollMs: 0, kdfIterations: FAST })
    await later.start()
    expect(later.getView().status).toBe('off')
    expect((await a.store.meta()).sync).toBeNull()
    expect((await loadTables(a.store)).rows.length).toBeGreaterThan(0)
    later.stop()
  })

  it('bootstrap: a dashboard-created user signs in with the temporary password and gets the household password', async () => {
    const server = new FakeServer()
    server.addUser('sam@example.com', 'temporary-123')
    const a = await withHousehold(server)
    await expect(a.engine.bootstrap('sam@example.com', 'wrong temp', PW)).rejects.toThrow(/Invalid login/)
    await expect(a.engine.bootstrap('sam@example.com', 'temporary-123', 'short')).rejects.toThrow(/12 characters/)
    const { recoveryCode } = await a.engine.bootstrap('sam@example.com', 'temporary-123', PW)
    expect(recoveryCode).toMatch(/-/)
    expect(server.users.get('sam@example.com')!.authKey).toBe((await deriveKeys('sam@example.com', PW, FAST)).authKey)
    expect(server.snapshots.size).toBe(1)
    expect(a.engine.getView()).toMatchObject({ status: 'idle', owner: true })
    // the temporary password is gone; the household password works on another device
    const b = device(server)
    await expect(b.engine.signIn('sam@example.com', 'temporary-123')).rejects.toThrow(/Invalid login/)
    expect((await b.engine.signIn('sam@example.com', PW)).kind).toBe('ok')
    expect((await loadTables(b.store)).household[0]?.name).toBe('Palace')
    // the password was reset to a plain one in the dashboard, but the account already has a household: refused
    server.users.get('sam@example.com')!.authKey = 'temporary-456'
    const c = device(server)
    await expect(c.engine.bootstrap('sam@example.com', 'temporary-456', 'another long password')).rejects.toThrow(/already has a household/)
    a.engine.stop(); b.engine.stop(); c.engine.stop()
  })

  it('a household with no snapshot yet: sign in on an empty device, start the household, it uploads', async () => {
    const server = new FakeServer()
    server.addUser('sam@example.com', (await deriveKeys('sam@example.com', PW, FAST)).authKey)
    // the first sign-in happened on a device without data: the server has the household and keys, but nothing to show
    const a = device(server)
    expect((await a.engine.signIn('sam@example.com', PW)).kind).toBe('created')
    expect(server.members).toHaveLength(1)
    expect(server.snapshots.size).toBe(0)
    await a.engine.signOut({ wipe: true })
    // signing in again on an empty device is fine: nothing to pull, nothing to push
    const b = device(server)
    expect((await b.engine.signIn('sam@example.com', PW)).kind).toBe('ok')
    expect(b.engine.getView()).toMatchObject({ status: 'idle', owner: true, pending: false })
    expect(server.snapshots.size).toBe(0)
    // starting the household now uploads it, and a third device receives it
    await quickCreateHousehold(b.store, { name: 'Palace', baseCurrency: 'EUR', locale: 'en-IE', startMonth: '2026-01' })
    await b.engine.flush()
    expect(server.snapshots.get('h-1')?.version).toBe(1)
    const c = device(server)
    expect((await c.engine.signIn('sam@example.com', PW)).kind).toBe('ok')
    expect((await loadTables(c.store)).household[0]?.name).toBe('Palace')
    a.engine.stop(); b.engine.stop(); c.engine.stop()
  })

  it('admins create and revoke invites', async () => {
    const server = new FakeServer()
    const u = server.addUser('sam@example.com', (await deriveKeys('sam@example.com', PW, FAST)).authKey)
    server.admins.add(u.userId)
    const a = await withHousehold(server)
    await a.engine.signIn('sam@example.com', PW)
    expect(await a.engine.isAdmin()).toBe(true)
    const inv = await a.engine.createInvite()
    expect(inv.code).toMatch(/^[0-9A-HJKMNP-TV-Z]{20}$/)
    expect(await a.engine.listInvites()).toHaveLength(1)
    await a.engine.revokeInvite(inv.code)
    expect(await a.engine.listInvites()).toHaveLength(0)
    a.engine.stop()
  })
})

export const _row = (name: string): Row => RowSchema.parse({ id: newId(), createdAt: 0, updatedAt: 0, name, section: 'expense' })
