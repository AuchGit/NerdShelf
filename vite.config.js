import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Custom port to avoid clashing with other Tauri/Vite projects also running on
// the default 5173. Keep in sync with `src-tauri/tauri.conf.json` → devUrl.
const DEV_PORT = 5283

// PWA is opt-in via `vite build --mode pwa` (see `npm run build:web`).
// Tauri's `beforeBuildCommand` runs `npm run build` (no mode), so the desktop
// build is byte-identical to before — no service worker, no manifest injection.
// https://vite.dev/config/
// PWA is deployed to GitHub Pages at https://<user>.github.io/NerdShelf/, so
// asset URLs must be prefixed with the repo name. Override via PWA_BASE if
// hosting elsewhere (e.g. PWA_BASE=/ for a custom apex domain or Netlify).
const PWA_BASE = process.env.PWA_BASE ?? '/NerdShelf/'

export default defineConfig(async ({ mode }) => {
  const plugins = [react()]
  const isPwa = mode === 'pwa'

  if (isPwa) {
    const { VitePWA } = await import('vite-plugin-pwa')
    plugins.push(
      VitePWA({
        registerType: 'autoUpdate',
        injectRegister: 'auto',
        includeAssets: ['favicon.svg', 'icons/*.png'],
        workbox: {
          // Der Haupt-Chunk ist mit dem VTT >2 MiB (Workbox-Default-Limit)
          // gewachsen — ohne höheres Limit bricht der PWA-Build ab.
          maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
          globPatterns: ['**/*.{js,css,html,svg,png,ico,json,woff2}'],
          // Don't precache the bulky JSON datasets in /public/data — let them
          // be runtime-cached on first access instead.
          globIgnores: ['**/data/**'],
          // SPA fallback so deep links resolve to index.html offline.
          navigateFallback: `${PWA_BASE}index.html`,
          runtimeCaching: [
            {
              urlPattern: ({ url }) => url.pathname.includes('/data/'),
              handler: 'StaleWhileRevalidate',
              options: { cacheName: 'nerdshelf-data' },
            },
            {
              // Supabase REST GETs use StaleWhileRevalidate so the UI gets
              // an instant response from cache and the network update lands
              // silently in the background. Writes (POST/PATCH/DELETE) +
              // realtime always bypass the cache (workbox SWR only matches
              // GETs by default).
              //
              // Trade-off: on first paint after data has changed on the
              // server, the user sees the previous response for one
              // request-cycle before the background fetch updates the
              // cache. Acceptable for dashboards / lists; realtime
              // subscriptions catch HP / conditions / notes updates
              // separately and react in-app.
              urlPattern: ({ url, request }) =>
                url.hostname.endsWith('.supabase.co') && request.method === 'GET',
              handler: 'StaleWhileRevalidate',
              options: {
                cacheName: 'supabase-api',
                expiration: { maxEntries: 200, maxAgeSeconds: 60 * 60 * 24 },
              },
            },
          ],
        },
        manifest: {
          name: 'NerdShelf',
          short_name: 'NerdShelf',
          description: 'NerdShelf – tabletop RPG & MTG companion.',
          theme_color: '#1a1a1a',
          background_color: '#1a1a1a',
          display: 'standalone',
          start_url: PWA_BASE,
          scope: PWA_BASE,
          icons: [
            { src: 'favicon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
            { src: 'icons/icon-128.png', sizes: '128x128', type: 'image/png' },
            { src: 'icons/icon-256.png', sizes: '256x256', type: 'image/png' },
            { src: 'icons/icon-310.png', sizes: '310x310', type: 'image/png' },
          ],
        },
      })
    )
  }

  return {
    // Tauri loads from `tauri://localhost`, so it MUST stay at '/'. PWA on
    // GitHub Pages needs the repo subpath prefix.
    base: isPwa ? PWA_BASE : '/',
    // Emit build assets into `dist/static/` instead of the default `dist/assets/`.
    // The VTT ships SVGs under `public/Assets/` (capital A); on case-INSENSITIVE
    // filesystems (Windows/macOS) `dist/Assets` and `dist/assets` collide into one
    // folder, so the bundled webview can't find `/assets/*.js` and Tauri returns
    // index.html → "MIME text/html" module-load failure → white screen. A distinct
    // dir avoids the clash.
    build: { assetsDir: 'static' },
    plugins,
    server: {
      port: DEV_PORT,
      strictPort: true,
    },
  }
})
