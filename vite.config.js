import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// App version (bumped by the release script) — scopes the PWA data cache so
// a new version never shows the previous version's datasets.
const APP_VERSION = JSON.parse(
  readFileSync(new URL('./src-tauri/tauri.conf.json', import.meta.url), 'utf8')
).version

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
        // The app decides when to switch to a new version (see
        // src/core/updater/PwaUpdater.jsx): right away when it's safe,
        // otherwise via a banner. It also registers the service worker.
        registerType: 'prompt',
        injectRegister: false,
        includeAssets: ['favicon.svg', 'icons/*.png'],
        workbox: {
          // Der Haupt-Chunk ist mit dem VTT >2 MiB (Workbox-Default-Limit)
          // gewachsen — ohne höheres Limit bricht der PWA-Build ab.
          maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
          globPatterns: ['**/*.{js,css,html,svg,png,ico,json,woff2}'],
          // Don't precache the bulky JSON datasets in /public/data — let them
          // be runtime-cached on first access instead.
          // Heavy, rarely used libraries (3D dice, static markup rendering)
          // aren't precached either — fetched and cached when first used —
          // so an update downloads less before it can switch over.
          globIgnores: [
            '**/data/**',
            '**/three.module-*.js',
            '**/cannon-es-*.js',
            '**/server.browser-*.js',
          ],
          // SPA fallback so deep links resolve to index.html offline.
          navigateFallback: `${PWA_BASE}index.html`,
          // …aber NICHT für das Handbuch: das ist eine eigenständige Seite in
          // public/. Ohne diese Ausnahme würde der Navigation-Fallback sie
          // durch index.html ersetzen und der „?"-Knopf öffnet die App erneut.
          navigateFallbackDenylist: [/handbuch\.html$/],
          runtimeCaching: [
            {
              urlPattern: ({ url }) => url.pathname.includes('/data/'),
              handler: 'StaleWhileRevalidate',
              // Per app version; the updater deletes older data caches.
              options: { cacheName: `nerdshelf-data-${APP_VERSION}` },
            },
            {
              // Code chunks left out of the precache (see globIgnores).
              // Hashed file names never change content → cache first.
              urlPattern: ({ url, sameOrigin }) =>
                sameOrigin && /\/static\/[^/]+\.(js|css)$/.test(url.pathname),
              handler: 'CacheFirst',
              options: {
                cacheName: 'nerdshelf-static',
                expiration: { maxEntries: 40, maxAgeSeconds: 60 * 60 * 24 * 30 },
              },
            },
            {
              // Supabase REST GETs go network-first: the app always gets
              // current data when online. The cache only answers when the
              // network is gone or slower than a few seconds (offline use).
              // Stale-while-revalidate used to hand the app the PREVIOUS
              // response, so changes only showed after reopening the app.
              // Writes (POST/PATCH/DELETE) + realtime bypass the cache.
              urlPattern: ({ url, request }) =>
                url.hostname.endsWith('.supabase.co') && request.method === 'GET',
              handler: 'NetworkFirst',
              options: {
                cacheName: 'supabase-api',
                networkTimeoutSeconds: 4,
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
          id: PWA_BASE,
          // Installed app catches links to its pages (Android, desktop
          // Chrome) instead of the browser, reusing an open window.
          launch_handler: { client_mode: ['navigate-existing', 'auto'] },
          handle_links: 'preferred',
          // Android installs need a 192 and a 512 PNG — without them Chrome
          // draws a generated letter tile instead of the app icon. The
          // maskable pair carries the safe-area padding Android crops to.
          // All of them are the desktop app's icon, so the app looks the
          // same on every device.
          icons: [
            { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
            { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
            { src: 'icons/icon-192-maskable.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
            { src: 'icons/icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
            { src: 'icons/icon-128.png', sizes: '128x128', type: 'image/png' },
            { src: 'icons/icon-256.png', sizes: '256x256', type: 'image/png' },
            { src: 'icons/icon-310.png', sizes: '310x310', type: 'image/png' },
            { src: 'favicon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
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
    define: {
      'import.meta.env.VITE_APP_VERSION': JSON.stringify(APP_VERSION),
    },
    // Only the PWA build has the service-worker plugin; the desktop build
    // and the dev server get a no-op stand-in for its register module.
    resolve: isPwa ? undefined : {
      alias: {
        'virtual:pwa-register': fileURLToPath(new URL('./src/shared/pwa/registerSWStub.js', import.meta.url)),
      },
    },
    plugins,
    server: {
      port: DEV_PORT,
      strictPort: true,
    },
  }
})
