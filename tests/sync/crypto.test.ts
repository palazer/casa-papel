import { describe, expect, it } from 'vitest'
import {
  decryptSnapshot, deriveKeys, encryptSnapshot, exportHouseholdKey, generateHouseholdKey, generateInviteCode, generateRecoveryCode, importHouseholdKey,
  normalizeEmail, normalizeRecoveryCode, recoveryKeys, snapshotAad, unwrapHouseholdKey, wrapHouseholdKey,
} from '@/sync/crypto'

// few iterations: tests check wiring, not cost
const FAST = 1000

describe('sync crypto', () => {
  it('derives the same auth key for the same email and password, and a different one otherwise', async () => {
    const a = await deriveKeys('Sam@Example.com ', 'correct horse battery', FAST)
    const b = await deriveKeys('sam@example.com', 'correct horse battery', FAST)
    const c = await deriveKeys('sam@example.com', 'correct horse battery!', FAST)
    const d = await deriveKeys('alex@example.com', 'correct horse battery', FAST)
    expect(a.authKey).toBe(b.authKey)
    expect(a.authKey).toHaveLength(43)
    expect(a.authKey).not.toBe(c.authKey)
    expect(a.authKey).not.toBe(d.authKey)
    expect(normalizeEmail('  Ｓam@Example.com ')).toBe('sam@example.com')
  })

  it('wraps and unwraps the household key with the password key and with the recovery code', async () => {
    const { wrapKey } = await deriveKeys('sam@example.com', 'correct horse battery', FAST)
    const hk = await generateHouseholdKey()
    const wrapped = await wrapHouseholdKey(hk, wrapKey)
    const back = await unwrapHouseholdKey(wrapped, wrapKey)
    expect(await exportHouseholdKey(back)).toBe(await exportHouseholdKey(hk))

    const code = generateRecoveryCode()
    expect(code).toMatch(/^[0-9A-Z]{5}-[0-9A-Z]{5}-[0-9A-Z]{5}-[0-9A-Z]{5}-[0-9A-Z]{6}$/)
    const r1 = await recoveryKeys(code)
    const r2 = await recoveryKeys(code.toLowerCase().replace(/-/g, ' ').replace(/0/g, 'o'))
    expect(r1.verifier).toBe(r2.verifier)
    const byRecovery = await wrapHouseholdKey(hk, r1.recoveryKey)
    expect(await exportHouseholdKey(await unwrapHouseholdKey(byRecovery, r2.recoveryKey))).toBe(await exportHouseholdKey(hk))

    const wrong = await deriveKeys('sam@example.com', 'wrong password!!', FAST)
    await expect(unwrapHouseholdKey(wrapped, wrong.wrapKey)).rejects.toThrow()
    expect(normalizeRecoveryCode('abcde-fghjk')).toBe('ABCDEFGHJK')
    await expect(recoveryKeys('too-short')).rejects.toThrow(/26/)
  })

  it('encrypts a snapshot bound to household and version; the wrong binding or key fails', async () => {
    const hk = await generateHouseholdKey()
    const payload = { format: 'casa-papel-sync', tables: { rows: [{ id: 'x', name: 'Rent' }] }, big: 'a'.repeat(20_000) }
    const cipher = await encryptSnapshot(hk, snapshotAad('h1', 3), payload)
    expect(cipher.length).toBeLessThan(5_000) // gzip did its job
    expect(await decryptSnapshot(hk, snapshotAad('h1', 3), cipher)).toEqual(payload)
    await expect(decryptSnapshot(hk, snapshotAad('h1', 4), cipher)).rejects.toThrow()
    await expect(decryptSnapshot(hk, snapshotAad('h2', 3), cipher)).rejects.toThrow()
    const other = await importHouseholdKey(await exportHouseholdKey(await generateHouseholdKey()))
    await expect(decryptSnapshot(other, snapshotAad('h1', 3), cipher)).rejects.toThrow()
  })

  it('makes invite codes of 20 Crockford characters', () => {
    const code = generateInviteCode()
    expect(code).toMatch(/^[0-9A-HJKMNP-TV-Z]{20}$/)
    expect(generateInviteCode()).not.toBe(code)
  })
})
