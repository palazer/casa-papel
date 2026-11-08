/** Supabase connection for the optional cloud sync. Absent in forks and local builds without a .env.local. */
export interface SyncConfig {
  url: string
  anonKey: string
}

export function syncConfig(): SyncConfig | null {
  const url = import.meta.env.VITE_SUPABASE_URL
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY
  return url && anonKey ? { url, anonKey } : null
}
