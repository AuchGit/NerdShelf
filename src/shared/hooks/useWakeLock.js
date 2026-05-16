// src/shared/hooks/useWakeLock.js
//
// Keep the screen awake for as long as `active` stays true. Wraps the
// Screen Wake Lock API (https://w3c.github.io/screen-wake-lock/) and
// handles the two real-world quirks the spec leaves to implementers:
//
//   • The browser auto-releases the lock when the document becomes
//     hidden (tab backgrounded, screen turned off, phone call, …).
//     We re-acquire on the next `visibilitychange` so resuming the app
//     puts the lock straight back in place.
//   • Some platforms refuse the lock when the battery is critical or
//     when running in low-power mode. The promise rejects; we swallow
//     it (no point spamming a toast — the user can't do anything about
//     it) and the next visibility change tries again.
//
// Browser support: Chromium >= 84, Safari >= 16.4, Firefox behind a
// flag. Anything else silently no-ops, which is the correct fallback —
// the screen simply turns off as the OS would normally schedule.
//
//   useWakeLock(true);                              // always-on
//   useWakeLock(!!match && match.status !== 'ended'); // conditional

import { useEffect } from 'react';

export default function useWakeLock(active) {
  useEffect(() => {
    if (!active) return undefined;
    if (typeof navigator === 'undefined' || !('wakeLock' in navigator)) {
      return undefined;
    }

    let sentinel = null;
    let cancelled = false;

    const acquire = async () => {
      if (cancelled || sentinel) return;
      try {
        sentinel = await navigator.wakeLock.request('screen');
        // Track auto-release so we can re-acquire on the next visibility
        // event. The spec emits this event from inside the sentinel.
        sentinel.addEventListener?.('release', () => {
          if (sentinel) sentinel = null;
        });
      } catch {
        // Platform refused (battery saver, OS policy, etc.) — silent fail.
      }
    };

    const onVisibility = () => {
      if (document.visibilityState === 'visible') acquire();
    };

    acquire();
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisibility);
      if (sentinel) {
        sentinel.release().catch(() => { /* ignore */ });
        sentinel = null;
      }
    };
  }, [active]);
}
