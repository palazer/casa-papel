import { fileURLToPath, URL } from 'node:url'
import { defineConfig, loadEnv, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

const BASE = '/casa-papel/'

/**
 * The built page's content security policy. The household key and all the data live in the browser, so the page
 * only runs scripts from its own origin and only talks to the sync server and the rate service: a script that
 * should not be there (a poisoned dependency) cannot simply send the data elsewhere.
 *
 * A <meta> tag because GitHub Pages cannot send headers. Build only: the dev server needs inline scripts and a
 * websocket. Styles allow 'unsafe-inline' because a UI library inserts a <style> element at runtime.
 */
function contentSecurityPolicy(supabaseUrl: string | undefined): Plugin {
  const connect = ["'self'", 'https://api.frankfurter.dev']
  if (supabaseUrl) connect.push(new URL(supabaseUrl).origin)
  const policy = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    `connect-src ${connect.join(' ')}`,
    "worker-src 'self'",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; ')
  return {
    name: 'casa-papel-csp',
    apply: 'build',
    transformIndexHtml: () => [{ tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: policy }, injectTo: 'head-prepend' }],
  }
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // the same variable the app reads (src/sync/config.ts), so the policy always allows the server this build syncs with
  const env = loadEnv(mode, process.cwd(), 'VITE_')
  return {
    base: BASE,
    plugins: [
      react(),
      tailwindcss(),
      contentSecurityPolicy(env.VITE_SUPABASE_URL),
      VitePWA({
        registerType: 'autoUpdate',
        includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
        manifest: {
          name: 'Casa Papel',
          short_name: 'Casa Papel',
          description:
            'Local-first household budgeting. Your money as a month-by-month grid that knows what a household is.',
          theme_color: '#1c1917',
          background_color: '#fafaf9',
          display: 'standalone',
          start_url: BASE,
          scope: BASE,
          icons: [
            { src: 'pwa-192.png', sizes: '192x192', type: 'image/png' },
            { src: 'pwa-512.png', sizes: '512x512', type: 'image/png' },
            { src: 'pwa-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          ],
        },
        workbox: {
          globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'],
          navigateFallback: `${BASE}index.html`,
        },
      }),
    ],
    resolve: {
      alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
    },
  }
})
