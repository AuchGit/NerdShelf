// src/shared/pwa/registerSWStub.js
//
// Stand-in for `virtual:pwa-register` outside the PWA build (desktop app,
// dev server): no service worker, nothing to update. Wired up as an alias
// in vite.config.js.

export function registerSW() {
  return () => Promise.resolve();
}
