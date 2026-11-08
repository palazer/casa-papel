/**
 * Everything cryptographic for cloud sync, on WebCrypto only.
 *
 * One password gives two keys: an auth key the server receives as the account password, and a
 * wrap key that never leaves the device. A random household key encrypts every snapshot; it is
 * stored on the server only wrapped by the wrap key and by a key derived from the recovery code.
 */

const enc = new TextEncoder()
const dec = new TextDecoder()

export const KDF_ITERATIONS = 600_000
export const KDF_PARAMS = { alg: 'PBKDF2-SHA256', iterations: KDF_ITERATIONS, saltScheme: 'email-v1', v: 1 } as const
export type KdfParams = { alg: string; iterations: number; saltScheme: string; v: number }

/** Something encrypted with AES-GCM: iv and ciphertext, base64. */
export interface Wrapped {
  iv: string
  ct: string
}

export function normalizeEmail(email: string): string {
  return email.normalize('NFKC').trim().toLowerCase()
}

/** Derive the account password and the key-wrapping key from the household password. */
export async function deriveKeys(email: string, password: string, iterations: number = KDF_ITERATIONS): Promise<{ authKey: string; wrapKey: CryptoKey }> {
  const salt = await crypto.subtle.digest('SHA-256', enc.encode('casa-papel:' + normalizeEmail(email)))
  const pw = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits'])
  const master = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, pw, 256)
  const hk = await crypto.subtle.importKey('raw', master, 'HKDF', false, ['deriveBits', 'deriveKey'])
  const authBits = await crypto.subtle.deriveBits(hkdf('casa-papel/auth/v1'), hk, 256)
  const wrapKey = await crypto.subtle.deriveKey(hkdf('casa-papel/wrap/v1'), hk, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
  return { authKey: toBase64Url(new Uint8Array(authBits)), wrapKey }
}

function hkdf(info: string): HkdfParams {
  return { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: enc.encode(info) }
}

export function generateHouseholdKey(): Promise<CryptoKey> {
  return crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt'])
}

export async function exportHouseholdKey(key: CryptoKey): Promise<string> {
  return toBase64(new Uint8Array(await crypto.subtle.exportKey('raw', key)))
}

export function importHouseholdKey(b64: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', fromBase64(b64), { name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt'])
}

/** Encrypt the household key with a wrapping key (from the password or the recovery code). */
export async function wrapHouseholdKey(householdKey: CryptoKey, wrappingKey: CryptoKey): Promise<Wrapped> {
  const raw = new Uint8Array(await crypto.subtle.exportKey('raw', householdKey))
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, wrappingKey, raw)
  return { iv: toBase64(iv), ct: toBase64(new Uint8Array(ct)) }
}

/** Reverse of wrapHouseholdKey. Throws when the wrapping key is wrong. */
export async function unwrapHouseholdKey(wrapped: Wrapped, wrappingKey: CryptoKey): Promise<CryptoKey> {
  const raw = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromBase64(wrapped.iv) }, wrappingKey, fromBase64(wrapped.ct))
  return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt'])
}

// ---------- recovery code ----------

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

/** 128 random bits as 26 Crockford base32 characters, grouped for reading aloud. */
export function generateRecoveryCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  const chars = base32Encode(bytes)
  return [chars.slice(0, 5), chars.slice(5, 10), chars.slice(10, 15), chars.slice(15, 20), chars.slice(20, 26)].join('-')
}

/** Accepts the code as typed: any case, dashes or spaces, O for 0, I or L for 1. */
export function normalizeRecoveryCode(code: string): string {
  return code.toUpperCase().replace(/[^0-9A-Z]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1')
}

/** The key that wraps the household key for recovery, and a verifier the server can check without learning the code. */
export async function recoveryKeys(code: string): Promise<{ recoveryKey: CryptoKey; verifier: string }> {
  const normalized = normalizeRecoveryCode(code)
  if (normalized.length !== 26) throw new Error('A recovery code has 26 letters and digits.')
  const ikm = await crypto.subtle.importKey('raw', base32Decode(normalized), 'HKDF', false, ['deriveBits', 'deriveKey'])
  const recoveryKey = await crypto.subtle.deriveKey(hkdf('casa-papel/recovery/v1'), ikm, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
  const verifier = toBase64Url(new Uint8Array(await crypto.subtle.deriveBits(hkdf('casa-papel/recovery-verify/v1'), ikm, 256)))
  return { recoveryKey, verifier }
}

// ---------- snapshots ----------

export const SNAPSHOT_FORMAT = 'casa-papel-sync'

/** Binds a ciphertext to its household and version, so a server cannot swap or relabel snapshots. */
export function snapshotAad(householdId: string, version: number): string {
  return `${SNAPSHOT_FORMAT}|1|${householdId}|${version}`
}

/** gzip + AES-GCM. Returns base64 of iv || ciphertext. */
export async function encryptSnapshot(key: CryptoKey, aad: string, payload: unknown): Promise<string> {
  const plain = await gzip(enc.encode(JSON.stringify(payload)))
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: enc.encode(aad) }, key, plain))
  const out = new Uint8Array(iv.length + ct.length)
  out.set(iv, 0)
  out.set(ct, iv.length)
  return toBase64(out)
}

export async function decryptSnapshot<T = unknown>(key: CryptoKey, aad: string, cipherB64: string): Promise<T> {
  const bytes = fromBase64(cipherB64)
  const iv = bytes.slice(0, 12)
  const ct = bytes.slice(12)
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv, additionalData: enc.encode(aad) }, key, ct)
  return JSON.parse(dec.decode(await gunzip(new Uint8Array(plain)))) as T
}

async function gzip(bytes: Uint8Array): Promise<Uint8Array<ArrayBuffer>> {
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new CompressionStream('gzip'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

async function gunzip(bytes: Uint8Array): Promise<Uint8Array<ArrayBuffer>> {
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream('gzip'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

// ---------- encoding ----------

export function toBase64(bytes: Uint8Array): string {
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s)
}

export function fromBase64(b64: string): Uint8Array<ArrayBuffer> {
  const s = atob(b64)
  const out = new Uint8Array(new ArrayBuffer(s.length))
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i)
  return out
}

export function toBase64Url(bytes: Uint8Array): string {
  return toBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function base32Encode(bytes: Uint8Array): string {
  let bits = 0
  let value = 0
  let out = ''
  for (const b of bytes) {
    value = (value << 8) | b
    bits += 8
    while (bits >= 5) {
      out += CROCKFORD[(value >>> (bits - 5)) & 31]
      bits -= 5
    }
  }
  if (bits > 0) out += CROCKFORD[(value << (5 - bits)) & 31]
  return out
}

function base32Decode(chars: string): Uint8Array<ArrayBuffer> {
  let bits = 0
  let value = 0
  const out: number[] = []
  for (const c of chars) {
    const idx = CROCKFORD.indexOf(c)
    if (idx < 0) throw new Error(`Not a recovery code character: ${c}`)
    value = (value << 5) | idx
    bits += 5
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255)
      bits -= 8
    }
  }
  return new Uint8Array(new ArrayBuffer(out.length)).map((_, i) => out[i])
}

/** A random invite code: 20 Crockford characters, about 100 bits. */
export function generateInviteCode(): string {
  return base32Encode(crypto.getRandomValues(new Uint8Array(13))).slice(0, 20)
}
