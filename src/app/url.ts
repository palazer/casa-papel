/** Read `?invite=CODE` once and drop it from the address bar, keeping everything else (`?demo=1` picks the database). */
export function takeInviteFromUrl(): string | null {
  if (typeof window === 'undefined') return null
  const params = new URLSearchParams(window.location.search)
  const code = params.get('invite')?.trim()
  if (!code) return null
  params.delete('invite')
  const qs = params.toString()
  window.history.replaceState(null, '', `${window.location.pathname}${qs ? `?${qs}` : ''}${window.location.hash}`)
  return code
}

/** The link an invited person opens. */
export function inviteLink(code: string): string {
  return `${window.location.origin}${import.meta.env.BASE_URL}?invite=${encodeURIComponent(code)}`
}
