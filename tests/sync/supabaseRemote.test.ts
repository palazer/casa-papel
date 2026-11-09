import { afterEach, describe, expect, it, vi } from 'vitest'
import { OfflineError } from '@/sync/remote'
import { SupabaseRemote } from '@/sync/supabaseRemote'

const cfg = { url: 'https://example.supabase.co', anonKey: 'anon' }

afterEach(() => vi.unstubAllGlobals())

describe('the Supabase remote: a request that never gets an answer', () => {
  it('gives up at the deadline and counts as offline, so the next trigger tries again', async () => {
    // the worst case: a connection that neither answers nor reacts to being aborted
    const fetchFn = vi.fn(() => new Promise<Response>(() => {}))
    vi.stubGlobal('fetch', fetchFn)
    const remote = new SupabaseRemote(cfg, 30)
    await expect(remote.getVersion('household')).rejects.toBeInstanceOf(OfflineError)
    // once, not four times: the client retries reads that fail, but not a request that was aborted
    expect(fetchFn).toHaveBeenCalledTimes(1)
    await expect(remote.pushSnapshot('household', 0, 'cipher', 4, 'device')).rejects.toBeInstanceOf(OfflineError)
  })

  it('still answers when the server does', async () => {
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ version: 7 }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    expect(await new SupabaseRemote(cfg, 30).getVersion('household')).toBe(7)
  })
})
