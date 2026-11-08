/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

interface ImportMetaEnv {
  /** Supabase project URL for the optional cloud sync; unset = sync not available in this build. */
  readonly VITE_SUPABASE_URL?: string
  /** Supabase anon (public) key. Row-level security protects the data; the key itself is not a secret. */
  readonly VITE_SUPABASE_ANON_KEY?: string
}
