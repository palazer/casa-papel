/** Per-viewer conveniences only. Never used for household data. */
export function readPref<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(`casa.${key}`)
    return raw == null ? fallback : (JSON.parse(raw) as T)
  } catch {
    return fallback
  }
}

export function writePref<T>(key: string, value: T): void {
  try {
    window.localStorage.setItem(`casa.${key}`, JSON.stringify(value))
  } catch {
    /* storage unavailable */
  }
}
