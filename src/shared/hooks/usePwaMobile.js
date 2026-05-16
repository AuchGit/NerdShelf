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

function readSnapshot() {
  if (typeof window === 'undefined') {
    return { isMobile: false, isTouch: false, isStandalone: false, isPwaMobile: false };
  }
  const isMobile = window.matchMedia(MQ_MOBILE).matches;
  const isTouch  = window.matchMedia(MQ_TOUCH).matches;
  const isStandalone =
    window.matchMedia(MQ_STANDALONE).matches
    // iOS Safari predates the standard display-mode query; navigator.standalone
    // is the platform-specific fallback for "Add to Home Screen" launches.
    || !!window.navigator?.standalone;
  const isPwaMobile = isStandalone || (isMobile && isTouch);
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
