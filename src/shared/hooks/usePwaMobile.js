// src/shared/hooks/usePwaMobile.js
//
// Detect the device/runtime profile so feature UIs can adapt without polluting
// every component with media-query plumbing. Returns a small flag object:
//
//   { isMobile, isTouch, isStandalone, isPwaMobile }
//
// - isMobile     — viewport ≤ 768 px (matches the existing useWindowWidth
//                   'hidden' breakpoint, so detection stays consistent across
//                   the app)
// - isTouch      — coarse pointer + no hover; reliably true on phones/tablets,
//                   false on desktops and the Tauri shell
// - isStandalone — running as an installed PWA (display-mode: standalone), or
//                   the iOS-specific navigator.standalone flag
// - isPwaMobile  — the actual "phone in your hand" signal: either running
//                   as a PWA OR (mobile viewport AND touch input).
//                   This is what gates all mobile-only UX everywhere in the
//                   app. When true, `document.body` is also marked with
//                   `data-pwa-mobile="true"` so CSS rules (and any non-React
//                   code) can target the mode without re-checking media
//                   queries on every paint.

import { useEffect, useState } from 'react';

const MQ_MOBILE     = '(max-width: 768px)';
const MQ_TOUCH      = '(hover: none) and (pointer: coarse)';
const MQ_STANDALONE = '(display-mode: standalone)';

// Override key. Set via URL ?pwaMobile=1 / 0 / reset. In dev mode the
// choice persists across reloads (handy for iterating on the layout on
// a desktop); in production builds it's a one-shot — the URL param
// applies for that page load only and is NEVER persisted, so a phone
// PWA can't accidentally end up stuck in desktop mode after a stray
// debug visit.
const OVERRIDE_KEY = 'nerdshelf:pwaMobileOverride';
const IS_DEV = typeof import.meta !== 'undefined' && import.meta.env?.DEV;

function readOverride() {
  if (typeof window === 'undefined') return null;

  let urlValue = null;
  try {
    const url = new URL(window.location.href);
    const param = url.searchParams.get('pwaMobile');
    if (param === '1' || param === 'true')   urlValue = true;
    else if (param === '0' || param === 'false') urlValue = false;
    else if (param === 'reset' || param === 'clear') {
      try { localStorage.removeItem(OVERRIDE_KEY); } catch { /* ignore */ }
      return null;
    }
  } catch { /* ignore */ }

  if (!IS_DEV) {
    // Production: defensively clear any stale dev-override that may have
    // slipped into localStorage from a previous dev session, and only
    // honour the in-URL flag for this page load.
    try { localStorage.removeItem(OVERRIDE_KEY); } catch { /* ignore */ }
    return urlValue;
  }

  // Dev mode: persist URL param so reloads keep the mode, then fall back
  // to whatever was previously stored.
  if (urlValue !== null) {
    try { localStorage.setItem(OVERRIDE_KEY, urlValue ? '1' : '0'); } catch { /* ignore */ }
    return urlValue;
  }
  try {
    const stored = localStorage.getItem(OVERRIDE_KEY);
    if (stored === '1') return true;
    if (stored === '0') return false;
  } catch { /* ignore */ }
  return null;
}

/** Detect the Tauri desktop shell by the globals it injects into the
 *  webview. Both Tauri 1.x (`__TAURI__`) and 2.x (`__TAURI_INTERNALS__`)
 *  are covered. The shell reports display-mode: standalone like a PWA,
 *  so we need this explicit check to avoid mis-routing it into the
 *  mobile layout. */
function isTauriShell() {
  if (typeof window === 'undefined') return false;
  return ('__TAURI_INTERNALS__' in window) || ('__TAURI__' in window);
}

function readSnapshot() {
  if (typeof window === 'undefined') {
    return { isMobile: false, isTouch: false, isStandalone: false, isPwaMobile: false };
  }
  const isMobile = window.matchMedia(MQ_MOBILE).matches;
  const isTouch  = window.matchMedia(MQ_TOUCH).matches;
  const isStandalone =
    window.matchMedia(MQ_STANDALONE).matches
    // iOS Safari predates the standard display-mode query;
    // navigator.standalone is the platform-specific fallback for
    // "Add to Home Screen" launches.
    || !!window.navigator?.standalone;
  const tauri = isTauriShell();

  // Manual override (dev-friendly) always wins so testers can flip into
  // / out of mobile mode regardless of the device.
  const override = readOverride();
  if (override !== null) {
    return { isMobile, isTouch, isStandalone, isPwaMobile: override };
  }

  // Detection. The product brief is "PWA → mobile, desktop binary →
  // desktop"; in practice that means:
  //
  //   • Tauri shell           → desktop UI (false), never mobile, even
  //                             though it reports display-mode standalone.
  //   • Installed PWA         → mobile UI (true). Touch isn't required —
  //                             some Android browsers under-report
  //                             pointer-coarse when a Bluetooth mouse is
  //                             paired, and installing the app is itself
  //                             a strong signal the user wants mobile UX.
  //   • Browser, narrow phone → mobile UI (true), via the viewport +
  //                             touch fallback.
  //   • Browser, desktop      → desktop UI (false).
  const isPwaMobile = !tauri && (isStandalone || (isMobile && isTouch));
  return { isMobile, isTouch, isStandalone, isPwaMobile };
}

// Sync a single source of truth onto <body> so CSS selectors (and any
// non-React module that wants to branch behaviour) can read it cheaply.
function syncBodyAttribute(snapshot) {
  if (typeof document === 'undefined') return;
  const body = document.body;
  if (!body) return;
  if (snapshot.isPwaMobile) {
    body.setAttribute('data-pwa-mobile', 'true');
  } else {
    body.removeAttribute('data-pwa-mobile');
  }
  if (snapshot.isStandalone) {
    body.setAttribute('data-pwa-standalone', 'true');
  } else {
    body.removeAttribute('data-pwa-standalone');
  }
}

export default function usePwaMobile() {
  const [state, setState] = useState(readSnapshot);

  useEffect(() => {
    syncBodyAttribute(state);
  }, [state]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    // matchMedia changes when the viewport resizes (rotating the phone, the
    // user installing the PWA mid-session, …). Subscribing to all three
    // queries keeps the snapshot fresh without a resize handler.
    const queries = [MQ_MOBILE, MQ_TOUCH, MQ_STANDALONE].map(q => window.matchMedia(q));
    const handler = () => setState(readSnapshot());
    for (const q of queries) {
      // Older Safari uses addListener/removeListener; modern uses addEventListener.
      if (q.addEventListener) q.addEventListener('change', handler);
      else q.addListener?.(handler);
    }
    return () => {
      for (const q of queries) {
        if (q.removeEventListener) q.removeEventListener('change', handler);
        else q.removeListener?.(handler);
      }
    };
  }, []);

  return state;
}

// Re-export the raw matcher so non-hook code can read the current state
// without going through React. Useful for one-off branches in services.
export function readPwaMobile() {
  return readSnapshot();
}
