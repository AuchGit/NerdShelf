// src/shared/hooks/useBackGuard.js
//
// The phone's back gesture (and the browser's Back button) should close
// whatever sits on top — a full-screen card, an action sheet, a dialog —
// before it leaves the page. Without this, Back on a card in the deck
// viewer drops the user out of the deck entirely.
//
// A component that owns such an overlay calls this hook while the overlay
// is open. It pushes one history entry at the SAME url, so the next Back
// pops that entry instead of navigating away, and runs `onBack`.
//
// Closing the overlay any other way (a ✕ button, a backdrop tap) unmounts
// the guard, which removes the entry again — so Back never has to be
// pressed twice for the step the user already took.
//
// The url never changes, so react-router's location stays put and the app
// keeps exactly one "real" history entry per route: Back always means one
// step back inside the app, and on the first page it leaves the app.
//
// Not armed in the Tauri desktop app: that window has no Back affordance
// at all, so the entry would only be dead weight.

import { useEffect, useRef } from 'react';

const STATE_KEY = '__nsBack';
let seq = 0;

// Popping our own entry (on cleanup) fires popstate just like a real Back
// press would. React's StrictMode mounts effects twice in development, so
// that self-inflicted pop lands in the freshly mounted listener and would
// close the overlay the instant it opened. Count the backs we cause and
// let the next popstate pass through untouched.
let suppress = 0;

function hasBackAffordance() {
  if (typeof window === 'undefined' || !window.history) return false;
  return !('__TAURI_INTERNALS__' in window || '__TAURI__' in window);
}

/**
 * @param {boolean} active     true while the overlay is open
 * @param {() => void} onBack  called when Back was pressed for this overlay
 */
export default function useBackGuard(active, onBack) {
  // Kept in a ref so a new handler identity doesn't re-push the entry.
  const cb = useRef(onBack);
  useEffect(() => { cb.current = onBack; }, [onBack]);

  useEffect(() => {
    if (!active || !hasBackAffordance()) return undefined;

    const id = ++seq;
    // Our own entry is gone once popstate fired; the cleanup must not
    // then pop somebody else's.
    let armed = true;
    try {
      // Spread the current state so react-router's own bookkeeping (idx)
      // survives — we only add a marker, we don't change the url.
      window.history.pushState({ ...(window.history.state || {}), [STATE_KEY]: id }, '');
    } catch {
      return undefined; // no history access — Back keeps its default behaviour
    }

    const onPop = () => {
      if (suppress > 0) { suppress -= 1; return; }
      armed = false;
      cb.current?.();
    };
    window.addEventListener('popstate', onPop);

    return () => {
      window.removeEventListener('popstate', onPop);
      if (!armed) return;
      // Closed from inside the app: drop the entry we pushed, otherwise the
      // next Back would be swallowed doing nothing.
      try {
        if (window.history.state?.[STATE_KEY] === id) {
          suppress += 1;
          window.history.back();
        }
      } catch { /* ignore */ }
    };
  }, [active]);
}
