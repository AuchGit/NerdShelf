import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Custom port to avoid clashing with other Tauri/Vite projects also running on
// the default 5173. Keep in sync with `src-tauri/tauri.conf.json` → devUrl.
const DEV_PORT = 5283

// PWA is opt-in via `vite build --mode pwa` (see `npm run build:web`).
// Tauri's `beforeBuildCommand` runs `npm run build` (no mode), so the desktop
// build is byte-identical to before — no service worker, no manifest injection.
// https://vite.dev/config/
export default defineConfig(async ({ mode }) => {
  const plugins = [react()]

  if (mode === 'pwa') {
    const { VitePWA } = await import('vite-plugin-pwa')
    plugins.push(
      VitePWA({
        registerType: 'autoUpdate',
        injectRegister: 'auto',
        includeAssets: ['favicon.svg', 'icons/*.png'],
        workbox: {
          globPatterns: ['**/*.{js,css,html,svg,png,ico,json,woff2}'],
          // Don't precache the bulky JSON datasets in /public/data — let them
          // be runtime-cached on first access instead.
          globIgnores: ['**/data/**'],
          runtimeCaching: [
            {
              urlPattern: ({ url }) => url.pathname.startsWith('/data/'),
              handler: 'StaleWhileRevalidate',
              options: { cacheName: 'nerdshelf-data' },
            },
            {
              // Supabase REST/Realtime should always go to network, but cache
              // last successful GET so the shell still loads offline.
              urlPattern: ({ url }) => url.hostname.endsWith('.supabase.co'),
              handler: 'NetworkFirst',
              options: {
                cacheName: 'supabase-api',
                networkTimeoutSeconds: 5,
                expiration: { maxEntries: 100, maxAgeSeconds: 60 * 60 * 24 },
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
          start_url: '/',
          scope: '/',
          icons: [
            { src: '/favicon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
            { src: '/icons/icon-128.png', sizes: '128x128', type: 'image/png' },
            { src: '/icons/icon-256.png', sizes: '256x256', type: 'image/png' },
            { src: '/icons/icon-310.png', sizes: '310x310', type: 'image/png' },
          ],
        },
      })
    )
  }

  return {
    plugins,
    server: {
      port: DEV_PORT,
      strictPort: true,
    },
  }
})
