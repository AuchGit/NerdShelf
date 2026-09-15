// src/shared/lazyWithReload.js
//
// React.lazy with one automatic reload when a code chunk can't be loaded.
// After an update, the previous version's files are gone from the server;
// a page still running that version fails to load a section it hasn't
// opened yet. Reloading picks up the new version. Guarded so a real outage
// doesn't end in a reload loop.

import { lazy } from 'react';

const KEY = 'nerdshelf:chunk-reload-at';
const MIN_GAP_MS = 30000;

export default function lazyWithReload(load) {
  return lazy(() => load().catch((err) => {
    let last = 0;
    try { last = Number(sessionStorage.getItem(KEY)) || 0; } catch { /* ignore */ }
    if (Date.now() - last > MIN_GAP_MS) {
      try { sessionStorage.setItem(KEY, String(Date.now())); } catch { /* ignore */ }
      window.location.reload();
      return new Promise(() => {}); // stay suspended until the reload happens
    }
    throw err;
  }));
}
