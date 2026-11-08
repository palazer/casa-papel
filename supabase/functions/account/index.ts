// Account function: creates accounts from invite codes and resets passwords with a recovery verifier.
// Runs with the service role; the app calls it with the anon key only. Deploy: supabase functions deploy account --no-verify-jwt
import { createClient } from 'npm:@supabase/supabase-js@2'

const ALLOWED_ORIGINS = ['https://palazer.github.io', 'http://localhost:5173', 'http://localhost:4173']
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const AUTH_KEY = /^[A-Za-z0-9_-]{43}$/

type Body = { action?: string; code?: string; email?: string; authKey?: string; verifier?: string; newAuthKey?: string }

Deno.serve(async (req) => {
  const origin = req.headers.get('origin') ?? ''
  const cors = {
    'Access-Control-Allow-Origin': ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    Vary: 'Origin',
  }
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false, autoRefreshToken: false } })
  let body: Body
  try {
    body = (await req.json()) as Body
  } catch {
    return json({ error: 'Bad request' }, 400)
  }

  try {
    if (body.action === 'redeem') return json(await redeem(admin, body))
    if (body.action === 'reset') return json(await reset(admin, body))
    return json({ error: 'Unknown action' }, 400)
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'Something went wrong.' }, 400)
  }
})

type Admin = ReturnType<typeof createClient>

async function redeem(admin: Admin, body: Body): Promise<{ ok: true }> {
  const code = body.code?.trim() ?? ''
  const email = body.email?.trim().toLowerCase() ?? ''
  const authKey = body.authKey ?? ''
  if (code.length < 16 || code.length > 64) throw new Error('This invite link is not valid any more.')
  if (!EMAIL.test(email)) throw new Error('That does not look like an email address.')
  if (!AUTH_KEY.test(authKey)) throw new Error('Bad request')

  // claim the code first so two people cannot use the same link
  const claim = await admin.from('invites').update({ used_at: new Date().toISOString() }).eq('code', code).is('used_at', null).gt('expires_at', new Date().toISOString()).select('code')
  if (claim.error) throw new Error('Could not check the invite. Try again.')
  if (!claim.data?.length) throw new Error('This invite link is not valid any more.')

  const created = await admin.auth.admin.createUser({ email, password: authKey, email_confirm: true })
  if (created.error || !created.data.user) {
    await admin.from('invites').update({ used_at: null }).eq('code', code)
    const msg = created.error?.message ?? ''
    if (/already|exists|registered/i.test(msg)) throw new Error('An account with this email already exists. Sign in instead.')
    throw new Error('Could not create the account. Try again.')
  }
  await admin.from('invites').update({ used_by: created.data.user.id }).eq('code', code)
  return { ok: true }
}

async function reset(admin: Admin, body: Body): Promise<{ ok: true }> {
  const email = body.email?.trim().toLowerCase() ?? ''
  const verifier = body.verifier ?? ''
  const newAuthKey = body.newAuthKey ?? ''
  if (!EMAIL.test(email) || !AUTH_KEY.test(newAuthKey) || !AUTH_KEY.test(verifier)) throw new Error('Bad request')

  const wrong = new Error('The recovery code does not match this account.')
  const found = await admin.rpc('user_id_by_email', { p_email: email })
  const userId = found.data as string | null
  if (found.error || !userId) throw wrong
  const member = await admin.from('members').select('recovery_verifier').eq('user_id', userId).maybeSingle()
  const stored = (member.data as { recovery_verifier: string | null } | null)?.recovery_verifier
  if (member.error || !stored || !timingSafeEqual(stored, verifier)) throw wrong

  const updated = await admin.auth.admin.updateUserById(userId, { password: newAuthKey })
  if (updated.error) throw new Error('Could not set the new password. Try again.')
  return { ok: true }
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}
