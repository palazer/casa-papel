import type { Page, Route } from '@playwright/test'

/** Must match .env.e2e. The browser never reaches it: every request is answered here. */
export const SUPABASE_URL = 'https://sync.e2e.test'

interface User { id: string; email: string; password: string | null }
interface Member { household_id: string; user_id: string; role: string; wrapped_key: unknown; recovery: unknown; recovery_verifier: string | null; kdf: unknown }
interface Snapshot { version: number; schema_version: number; cipher: string; device_id: string; updated_at: string }
interface Invite { code: string; created_by: string; created_at: string; expires_at: string; used_by: string | null; used_at: string | null }

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
  'Access-Control-Expose-Headers': '*',
}

/**
 * Just enough of Supabase for the app: password auth, the tables and RPCs of supabase/migrations/0001_sync.sql,
 * and the `account` function. Ciphertext passes through untouched, so the browser does the real crypto.
 */
export class FakeSupabase {
  users: User[] = []
  members: Member[] = []
  households: Array<{ id: string; owner_id: string }> = []
  snapshots = new Map<string, Snapshot>()
  invites: Invite[] = []
  admins = new Set<string>()
  log: string[] = []

  /** `password: null` accepts the first password it sees and keeps it, like a dashboard-created user with a temporary password. */
  addUser(email: string, password: string | null = null): User {
    const u = { id: `00000000-0000-4000-8000-${String(this.users.length + 1).padStart(12, '0')}`, email, password }
    this.users.push(u)
    return u
  }

  async install(page: Page): Promise<void> {
    await page.route(`${SUPABASE_URL}/**`, (route) => this.handle(route))
  }

  private async handle(route: Route): Promise<void> {
    const req = route.request()
    const url = new URL(req.url())
    const method = req.method()
    const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
      route.fulfill({ status, headers: { ...CORS, 'Content-Type': 'application/json', ...headers }, body: body === undefined ? '' : JSON.stringify(body) })
    if (method === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS })
    this.log.push(`${method} ${url.pathname}${url.search}`)
    let body: Record<string, unknown> = {}
    try {
      body = (req.postDataJSON() as Record<string, unknown>) ?? {}
    } catch {
      /* no body */
    }
    const auth = this.userFromAuth(req.headers()['authorization'])
    const path = url.pathname

    // ---------- auth ----------
    if (path === '/auth/v1/token' && method === 'POST') {
      if (url.searchParams.get('grant_type') === 'refresh_token') {
        const u = this.users.find((x) => `r-${x.id}` === body.refresh_token)
        return u ? json(this.session(u)) : json({ error: 'invalid_grant', error_description: 'Invalid Refresh Token', msg: 'Invalid Refresh Token' }, 400)
      }
      const u = this.users.find((x) => x.email === String(body.email).toLowerCase())
      if (!u) return json({ error: 'invalid_grant', error_description: 'Invalid login credentials', msg: 'Invalid login credentials', code: 'invalid_credentials' }, 400)
      if (u.password === null) u.password = String(body.password)
      if (u.password !== body.password) return json({ error: 'invalid_grant', error_description: 'Invalid login credentials', msg: 'Invalid login credentials', code: 'invalid_credentials' }, 400)
      return json(this.session(u))
    }
    if (path === '/auth/v1/user' && method === 'GET') return auth ? json(this.userJson(auth)) : json({ msg: 'Not signed in' }, 401)
    if (path === '/auth/v1/user' && method === 'PUT') {
      if (!auth) return json({ msg: 'Not signed in' }, 401)
      if (typeof body.password === 'string') auth.password = body.password
      return json(this.userJson(auth))
    }
    if (path === '/auth/v1/logout') return route.fulfill({ status: 204, headers: CORS })

    // ---------- account function ----------
    if (path === '/functions/v1/account' && method === 'POST') {
      try {
        if (body.action === 'redeem') {
          const inv = this.invites.find((i) => i.code === body.code && !i.used_at && Date.parse(i.expires_at) > Date.now())
          if (!inv) throw new Error('This invite link is not valid any more.')
          const email = String(body.email).toLowerCase()
          if (this.users.some((u) => u.email === email)) throw new Error('An account with this email already exists. Sign in instead.')
          const u = this.addUser(email, String(body.authKey))
          inv.used_at = new Date().toISOString()
          inv.used_by = u.id
          return json({ ok: true })
        }
        if (body.action === 'reset') {
          const u = this.users.find((x) => x.email === String(body.email).toLowerCase())
          const m = u && this.members.find((x) => x.user_id === u.id)
          if (!u || !m || !m.recovery_verifier || m.recovery_verifier !== body.verifier) throw new Error('The recovery code does not match this account.')
          u.password = String(body.newAuthKey)
          return json({ ok: true })
        }
        throw new Error('Unknown action')
      } catch (e) {
        return json({ error: e instanceof Error ? e.message : 'Something went wrong.' }, 400)
      }
    }

    // ---------- rpc ----------
    const rpc = path.match(/^\/rest\/v1\/rpc\/(\w+)$/)
    if (rpc) {
      const name = rpc[1]
      const fail = (message: string) => json({ code: 'P0001', message, details: null, hint: null }, 400)
      switch (name) {
        case 'ping': return json('pong')
        case 'invite_valid': return json(this.invites.some((i) => i.code === body.p_code && !i.used_at && Date.parse(i.expires_at) > Date.now()))
        case 'is_admin': return json(!!auth && this.admins.has(auth.id))
        case 'create_household': {
          if (!auth) return fail('not signed in')
          if (this.members.some((m) => m.user_id === auth.id)) return fail('already a member of a household')
          const id = `hh-${this.households.length + 1}`
          this.households.push({ id, owner_id: auth.id })
          this.members.push({ household_id: id, user_id: auth.id, role: 'owner', wrapped_key: body.p_wrapped_key, recovery: body.p_recovery, recovery_verifier: body.p_recovery_verifier as string | null, kdf: body.p_kdf })
          return json(id)
        }
        case 'push_snapshot': {
          const hid = String(body.p_household)
          if (!auth || !this.members.some((m) => m.household_id === hid && m.user_id === auth.id)) return fail('not a member')
          const cur = this.snapshots.get(hid)
          if ((cur?.version ?? 0) !== Number(body.p_expected)) return fail('conflict')
          if (cur && Number(body.p_schema_version) < cur.schema_version) return fail('stale_schema')
          const version = (cur?.version ?? 0) + 1
          this.snapshots.set(hid, { version, schema_version: Number(body.p_schema_version), cipher: String(body.p_cipher), device_id: String(body.p_device_id), updated_at: new Date().toISOString() })
          return json(version)
        }
        case 'delete_household': {
          const hid = String(body.p_household)
          if (!auth || !this.households.some((h) => h.id === hid && h.owner_id === auth.id)) return fail('only the owner can delete the cloud copy')
          this.households = this.households.filter((h) => h.id !== hid)
          this.members = this.members.filter((m) => m.household_id !== hid)
          this.snapshots.delete(hid)
          return json(null, 204)
        }
        default: return fail(`unknown function ${name}`)
      }
    }

    // ---------- tables ----------
    const table = path.match(/^\/rest\/v1\/(\w+)$/)?.[1]
    if (table) {
      if (!auth) return json({ message: 'JWT required' }, 401)
      const filters = [...url.searchParams.entries()].filter(([k]) => !['select', 'order', 'limit', 'offset'].includes(k))
      const matches = (row: Record<string, unknown>) => filters.every(([k, v]) => {
        if (v === 'is.null') return row[k] == null
        if (v.startsWith('eq.')) return String(row[k]) === v.slice(3)
        return true
      })
      const wantsObject = (req.headers()['accept'] ?? '').includes('vnd.pgrst.object')
      const reply = (rows: unknown[]) => (wantsObject ? (rows.length === 1 ? json(rows[0]) : json({ code: 'PGRST116', message: 'The result contains 0 rows' }, 406)) : json(rows))
      if (table === 'members') {
        const mine = this.members.filter((m) => m.user_id === auth.id).filter((m) => matches(m as unknown as Record<string, unknown>))
        if (method === 'GET') return reply(mine)
        if (method === 'PATCH') {
          for (const m of mine) Object.assign(m, body)
          return json(wantsObject ? mine[0] : mine, 200)
        }
      }
      if (table === 'snapshots' && method === 'GET') {
        const rows = [...this.snapshots.entries()]
          .filter(([hid]) => this.members.some((m) => m.household_id === hid && m.user_id === auth.id))
          .map(([hid, s]) => ({ household_id: hid, ...s }))
          .filter((r) => matches(r as unknown as Record<string, unknown>))
        return reply(rows)
      }
      if (table === 'invites') {
        if (!this.admins.has(auth.id)) return json([], 200)
        if (method === 'GET') return reply(this.invites.filter((i) => matches(i as unknown as Record<string, unknown>)))
        if (method === 'POST') {
          const inv: Invite = { code: String(body.code), created_by: auth.id, created_at: new Date().toISOString(), expires_at: new Date(Date.now() + 7 * 86_400_000).toISOString(), used_by: null, used_at: null }
          this.invites.push(inv)
          return reply([inv])
        }
        if (method === 'DELETE') {
          this.invites = this.invites.filter((i) => !matches(i as unknown as Record<string, unknown>))
          return json(null, 204)
        }
      }
      return json({ message: `unhandled ${method} ${table}` }, 404)
    }
    return json({ message: `unhandled ${method} ${path}` }, 404)
  }

  private userFromAuth(header: string | undefined): User | null {
    const token = header?.replace(/^Bearer\s+/i, '')
    if (!token || token === 'e2e-anon-key') return null
    try {
      const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()) as { sub: string }
      return this.users.find((u) => u.id === payload.sub) ?? null
    } catch {
      return null
    }
  }

  private session(u: User) {
    const now = Math.floor(Date.now() / 1000)
    const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url')
    const token = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: u.id, email: u.email, role: 'authenticated', aud: 'authenticated', iat: now, exp: now + 3600, session_id: `s-${u.id}` })}.e2e`
    return { access_token: token, token_type: 'bearer', expires_in: 3600, expires_at: now + 3600, refresh_token: `r-${u.id}`, user: this.userJson(u) }
  }

  private userJson(u: User) {
    const t = new Date().toISOString()
    return { id: u.id, aud: 'authenticated', role: 'authenticated', email: u.email, email_confirmed_at: t, app_metadata: { provider: 'email', providers: ['email'] }, user_metadata: {}, identities: [], created_at: t, updated_at: t }
  }
}
