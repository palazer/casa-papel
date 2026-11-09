import { describe, expect, it } from 'vitest'
import { withDeadline } from '@/lib/deadline'

/** A fetch that never answers on its own; like the real one it rejects when its signal aborts. */
function hanging(seen: { signal?: AbortSignal } = {}): typeof fetch {
  return ((_input: RequestInfo | URL, init?: RequestInit) =>
    new Promise<Response>((_resolve, reject) => {
      const signal = init?.signal ?? undefined
      seen.signal = signal
      signal?.addEventListener('abort', () => reject(signal.reason))
    })) as typeof fetch
}

describe('a fetch with a deadline', () => {
  it('passes a prompt answer through', async () => {
    const f = withDeadline((async () => new Response('ok')) as typeof fetch, 50)
    expect(await (await f('https://example.test')).text()).toBe('ok')
  })

  it('aborts the request and rejects with an AbortError when no answer comes', async () => {
    const seen: { signal?: AbortSignal } = {}
    const f = withDeadline(hanging(seen), 20)
    await expect(f('https://example.test')).rejects.toMatchObject({ name: 'AbortError', message: 'The request timed out.' })
    expect(seen.signal?.aborted).toBe(true)
  })

  it('gives up even when the fetch ignores its signal', async () => {
    const deaf = (() => new Promise<Response>(() => {})) as typeof fetch
    await expect(withDeadline(deaf, 20, 'Too slow.')('https://example.test')).rejects.toMatchObject({ name: 'AbortError', message: 'Too slow.' })
  })

  it('keeps the caller’s own signal working', async () => {
    const mine = new AbortController()
    const p = withDeadline(hanging(), 5_000)('https://example.test', { signal: mine.signal })
    mine.abort(new Error('changed my mind'))
    await expect(p).rejects.toThrow('changed my mind')
  })

  it('passes other failures through unchanged', async () => {
    const failing = (async () => { throw new TypeError('Failed to fetch') }) as typeof fetch
    await expect(withDeadline(failing, 50)('https://example.test')).rejects.toThrow('Failed to fetch')
  })
})
