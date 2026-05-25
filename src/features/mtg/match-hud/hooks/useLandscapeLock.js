// src/features/mtg/match-hud/hooks/useLandscapeLock.js
//
// Lock the device orientation to landscape while the hook is mounted
// with `enabled=true`. Restores the user's default (system rotation
// setting) on cleanup.
//
// Browser support is uneven:
//   • Installed PWAs on Android (Chrome): works without fullscreen.
//   • Mobile browsers in a regular tab: usually require fullscreen
//     first; we attempt that as a fallback.
//   • iOS Safari (incl. installed PWAs): does NOT support
//     screen.orientation.lock() at all — the call is silently swallowed
//     and the user keeps their device-level setting.
//   • Desktop: screen.orientation exists but lock() is a no-op for
//     desktop browsers — silently OK.
//
// This is intentionally best-effort: a missing lock doesn't break the
// match HUD, it just means the user might end up in portrait on iOS.

import { useEffect } from 'react'

export function useLandscapeLock(enabled) {
  useEffect(() => {
    if (!enabled) return
    if (typeof window === 'undefined') return
    const orientation = window.screen?.orientation
    if (!orientation || typeof orientation.lock !== 'function') return

    let cancelled = false

    async function tryLock() {
      try {
        // Fast path: installed PWAs accept lock() without fullscreen.
        await orientation.lock('landscape')
      } catch {
        // Slow path: regular tabs need fullscreen first. requestFullscreen
        // is gated on a user gesture in many browsers — when we hit this
        // path without one it will throw, and we silently fall through.
        try {
          if (cancelled) return
          await document.documentElement.requestFullscreen?.({ navigationUI: 'hide' })
          if (cancelled) return
          await orientation.lock('landscape')
        } catch {
          /* unsupported / blocked — keep the user's current orientation */
        }
      }
    }

    tryLock()

    return () => {
      cancelled = true
      // Release the lock so the phone returns to whatever rotation the
      // user has configured system-wide. Don't auto-exit fullscreen —
      // browsers do that automatically on page navigation, and forcing
      // it can interrupt PWA standalone mode.
      try { orientation.unlock?.() } catch { /* ignore */ }
    }
  }, [enabled])
}
