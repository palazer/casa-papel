/**
 * A fetch that gives up. Without a deadline a request that never gets an answer (a dropped
 * connection, a laptop waking up) stays pending for as long as the browser cares to wait, and
 * everything queued behind it waits too.
 *
 * At the deadline the request is aborted and rejects with an `AbortError` carrying `message`; the
 * abort also ends a response body that is still being read. `AbortError` is what the Supabase client
 * expects from a cancelled request: it reports it at once instead of retrying it three more times.
 * A `signal` the caller passed keeps working.
 */
export function withDeadline(fetchFn: typeof fetch, ms: number, message = 'The request timed out.'): typeof fetch {
  return (input, init) => {
    const controller = new AbortController()
    const outer = init?.signal
    if (outer?.aborted) controller.abort(outer.reason)
    else outer?.addEventListener('abort', () => controller.abort(outer.reason), { once: true })
    return new Promise<Response>((resolve, reject) => {
      // not cleared when the headers arrive: the body counts against the same deadline
      const timer = setTimeout(() => {
        const timeout = new DOMException(message, 'AbortError')
        controller.abort(timeout)
        reject(timeout)
      }, ms)
      fetchFn(input, { ...init, signal: controller.signal }).then(resolve, (e: unknown) => {
        clearTimeout(timer)
        reject(e)
      })
    })
  }
}
